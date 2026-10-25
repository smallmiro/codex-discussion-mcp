import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { DiscussionError } from './errors.js';
import { record, type Notification, type RpcClient } from './protocol.js';

export interface AppServerOptions {
  command?: string;
  args?: string[];
  cwd?: string;
  rpcTimeoutMs?: number;
  maxFrameBytes?: number;
}

interface Pending {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

/** A single, lazily initialized app-server connection. Mutations are never replayed. */
export class AppServer implements RpcClient {
  private child?: ChildProcessWithoutNullStreams;
  private ready?: Promise<void>;
  private closedError?: Error;
  private sequence = 0;
  private buffer = Buffer.alloc(0);
  private pending = new Map<number, Pending>();
  private notifications = new Set<(notification: Notification) => void>();
  private disconnects = new Set<(error: Error) => void>();

  constructor(private readonly options: AppServerOptions = {}) {}

  onNotification(listener: (message: Notification) => void) {
    this.notifications.add(listener);
    return () => { this.notifications.delete(listener); };
  }

  onDisconnect(listener: (error: Error) => void) {
    this.disconnects.add(listener);
    return () => { this.disconnects.delete(listener); };
  }

  async request<T = unknown>(method: string, params: Record<string, unknown>): Promise<T> {
    if (this.closedError) throw new DiscussionError('CONNECTION_LOST', 'App-server connection is closed. Start a new MCP process to reconnect.');
    this.ready ??= this.initialize();
    await this.ready;
    return this.sendRequest(method, params) as Promise<T>;
  }

  private async initialize() {
    this.child = spawn(
      this.options.command ?? 'codex',
      this.options.args ?? ['app-server', '--listen', 'stdio://'],
      { cwd: this.options.cwd, stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true },
    );
    this.child.stdout.on('data', (chunk: Buffer) => this.receive(chunk));
    // Forward diagnostics only. Never mix child stderr into the MCP stdout stream.
    this.child.stderr.on('data', (chunk: Buffer) => { process.stderr.write(chunk); });
    this.child.on('error', error => this.fail(new DiscussionError('CONNECTION_LOST', `Cannot start Codex app-server: ${error.message}. Install Codex CLI or set --codex-command.`)));
    this.child.on('exit', (code, signal) => this.fail(new DiscussionError('CONNECTION_LOST', `Codex app-server connection exited (${signal ?? code}). In-flight turns were not replayed.`)));
    this.child.stdin.on('error', error => this.fail(new DiscussionError('CONNECTION_LOST', `App-server input connection failed: ${error.message}`)));
    await this.sendRequest('initialize', {
      clientInfo: { name: 'mirolab_codex_discussion_mcp', title: 'Codex Discussion MCP', version: '0.1.0' },
    });
    this.write({ method: 'initialized', params: {} });
  }

  private sendRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.closedError) return Promise.reject(this.closedError);
    if (this.pending.size >= 256) return Promise.reject(new DiscussionError('OVERLOADED', 'Too many pending app-server requests.'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(new DiscussionError('RPC_TIMEOUT', `App-server ${method} timed out. Connection closed; the request may have been accepted and will not be replayed.`, { method, outcomeUnknown: true }));
      }, this.options.rpcTimeoutMs ?? 30_000);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ id, method, params });
    });
  }

  private write(message: unknown) {
    if (this.closedError) return;
    this.child?.stdin.write(`${JSON.stringify(message)}\n`, error => {
      if (error) this.fail(new DiscussionError('CONNECTION_LOST', `App-server write failed: ${error.message}`));
    });
  }

  private receive(chunk: Buffer) {
    if (this.closedError) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const max = this.options.maxFrameBytes ?? 8 * 1024 * 1024;
    let newline: number;
    while ((newline = this.buffer.indexOf(10)) !== -1) {
      if (newline > max) { this.fail(new DiscussionError('PROTOCOL_ERROR', 'App-server JSON frame exceeded the size limit.')); return; }
      const line = this.buffer.subarray(0, newline).toString('utf8');
      this.buffer = this.buffer.subarray(newline + 1);
      if (!line.trim()) continue;
      try {
        const message = record(JSON.parse(line));
        this.dispatch(message);
      } catch {
        this.fail(new DiscussionError('PROTOCOL_ERROR', 'Invalid JSON or protocol message from app-server.'));
        return;
      }
    }
    if (this.buffer.length > max) this.fail(new DiscussionError('PROTOCOL_ERROR', 'App-server JSON frame exceeded the size limit.'));
  }

  private dispatch(message: Record<string, unknown>) {
    if (typeof message.method === 'string') {
      const notification = { method: message.method, params: record(message.params) };
      if (typeof message.id === 'string' || typeof message.id === 'number') this.decline(message.id, notification);
      else for (const listener of this.notifications) listener(notification);
      return;
    }
    if (typeof message.id !== 'number' || (!('result' in message) && !('error' in message))) {
      throw new Error('Invalid RPC envelope');
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if ('error' in message) {
      const error = record(message.error);
      pending.reject(new DiscussionError('APP_SERVER_ERROR', String(error.message ?? 'App-server request failed'), { rpcCode: error.code }));
    } else pending.resolve(message.result);
  }

  private decline(id: string | number, { method, params }: Notification) {
    let result: unknown;
    switch (method) {
      case 'item/commandExecution/requestApproval':
      case 'item/fileChange/requestApproval': result = { decision: 'decline' }; break;
      case 'item/tool/requestUserInput': result = { answers: {} }; break;
      case 'mcpServer/elicitation/request': result = { action: 'decline' }; break;
      case 'item/tool/call':
        result = { contentItems: [{ type: 'inputText', text: 'Dynamic tools are unavailable in read-only discussion mode.' }], success: false };
        break;
      default: this.write({ id, error: { code: -32601, message: `Client does not support ${method}` } });
    }
    if (result !== undefined) this.write({ id, result });
    for (const listener of this.notifications) {
      listener({ method: 'client/requestDenied', params: { threadId: params.threadId, turnId: params.turnId, requestMethod: method } });
    }
  }

  private fail(error: Error) {
    if (this.closedError) return;
    this.closedError = error;
    for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(error); }
    this.pending.clear();
    this.buffer = Buffer.alloc(0);
    for (const listener of this.disconnects) listener(error);
    const child = this.child;
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      const killTimer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 1000);
      killTimer.unref();
      child.once('exit', () => clearTimeout(killTimer));
    }
  }

  async close() {
    const child = this.child;
    this.fail(new DiscussionError('CONNECTION_LOST', 'App-server connection closed.'));
    if (!child || child.exitCode !== null || child.signalCode !== null || !child.pid) return;
    await new Promise<void>(resolve => { child.once('exit', () => resolve()); });
  }
}
