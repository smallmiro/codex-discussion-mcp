import assert from 'node:assert/strict';
import { spawn, execFile as execFileCallback } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { record } from '../src/protocol.js';

const execFile = promisify(execFileCallback);
const entry = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/app-server.mjs', import.meta.url));
const args = ['--import', 'tsx', entry, '--codex-command', process.execPath, '--codex-arg', fixture];

async function connection(t: TestContext) {
  const transport = new StdioClientTransport({ command: process.execPath, args, stderr: 'pipe' });
  const client = new Client({ name: 'discussion-mcp-test', version: '1.0.0' }, { capabilities: {} });
  t.after(() => client.close());
  await client.connect(transport);
  return client;
}

test('CLI help and version work without starting Codex', async () => {
  const help = await execFile(process.execPath, ['--import', 'tsx', entry, '--help', '--codex-command', '/nonexistent/codex']);
  assert.match(help.stdout, /codex-discussion-mcp/);
  const version = await execFile(process.execPath, ['--import', 'tsx', entry, '--version']);
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  assert.equal(version.stdout.trim(), pkg.version);
});

test('MCP discovery exposes five tools with dynamic model and effort strings', async t => {
  const client = await connection(t);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name).sort(), ['discussion_cancel', 'discussion_read', 'discussion_reply', 'discussion_start', 'models_list']);
  const start = tools.find(tool => tool.name === 'discussion_start')!;
  const model = record(record(start.inputSchema.properties).model);
  assert.equal(model.type, 'string');
  assert.equal(model.enum, undefined);
});

test('MCP caller discovers models and discusses with independently selected model and effort', async t => {
  const client = await connection(t);
  const catalog = await client.callTool({ name: 'models_list', arguments: {} });
  assert.equal((record(catalog.structuredContent).models as unknown[]).length, 2);
  const first = record((await client.callTool({ name: 'discussion_start', arguments: { message: 'early', model: 'alpha', effort: 'high' } })).structuredContent);
  assert.equal(first.effort, 'high');
  const read = record((await client.callTool({ name: 'discussion_read', arguments: { discussionId: first.discussionId } })).structuredContent);
  assert.equal(read.status, 'completed');
  assert.ok((read.messages as Array<{ text: string }>).some(message => message.text === 'Codex answer'));
  const second = record((await client.callTool({ name: 'discussion_reply', arguments: { discussionId: first.discussionId, message: 'early rebuttal', model: 'beta', effort: 'new-future-effort' } })).structuredContent);
  assert.equal(second.model, 'beta');
  assert.equal(second.effort, 'new-future-effort');
});

test('MCP tool failures are structured and a valid call still works afterward', async t => {
  const client = await connection(t);
  const invalid = await client.callTool({ name: 'discussion_start', arguments: { message: 'hello', model: 'missing' } });
  assert.equal(invalid.isError, true);
  assert.equal(record(record(invalid.structuredContent).error).code, 'INVALID_MODEL');
  const first = record((await client.callTool({ name: 'discussion_start', arguments: { message: 'hold' } })).structuredContent);
  const busy = await client.callTool({ name: 'discussion_reply', arguments: { discussionId: first.discussionId, message: 'hello again' } });
  assert.equal(busy.isError, true);
  assert.equal(record(record(busy.structuredContent).error).code, 'DISCUSSION_BUSY');
  await client.callTool({ name: 'discussion_cancel', arguments: { discussionId: first.discussionId, turnId: first.turnId } });
  const final = record((await client.callTool({ name: 'discussion_read', arguments: { discussionId: first.discussionId } })).structuredContent);
  assert.equal(final.status, 'interrupted');
});

test('invalid schema inputs are rejected before inference', async t => {
  const client = await connection(t);
  for (const [name, input] of [
    ['discussion_start', { message: '   ' }],
    ['discussion_read', { discussionId: 'thread-1', waitMs: 20001 }],
  ] as const) {
    const result = await client.callTool({ name, arguments: input });
    assert.equal(result.isError, true);
  }
});

for (const shutdown of ['stdin', 'SIGTERM'] as const) {
  test(`legacy 2025-03-26 host is supported and ${shutdown} stops the owned Codex process`, { timeout: 10_000 }, async t => {
    const dir = await mkdtemp(join(tmpdir(), 'codex-mcp-lifecycle-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const pidFile = join(dir, 'pid');
    const child = spawn(process.execPath, [...args, `--codex-arg=--pid-file=${pidFile}`], { stdio: ['pipe', 'pipe', 'pipe'] });
    t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
    const pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>();
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    child.on('exit', () => {
      for (const item of pending.values()) item.reject(new Error(`MCP child exited: ${stderr}`));
      pending.clear();
    });
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
      const message = JSON.parse(line);
      pending.get(message.id)?.resolve(message);
      pending.delete(message.id);
    });
    let sequence = 0;
    const request = (method: string, params: Record<string, unknown>) => new Promise<Record<string, unknown>>((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
    const initialized = await request('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'legacy-test', version: '1.0.0' } });
    assert.equal(record(initialized.result).protocolVersion, '2025-03-26');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    await request('tools/call', { name: 'models_list', arguments: {} });
    const pid = Number(await readFile(pidFile, 'utf8'));
    const exited = once(child, 'exit');
    if (shutdown === 'stdin') child.stdin.end(); else child.kill(shutdown);
    await exited;
    assert.throws(() => process.kill(pid, 0), /ESRCH/);
  });
}
