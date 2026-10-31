import assert from 'node:assert/strict';
import { spawn, execFile as execFileCallback } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
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
const registry = fileURLToPath(new URL('./fixtures/update-registry.mjs', import.meta.url));
const args = ['--import', registry, '--import', 'tsx', entry, '--codex-command', process.execPath, '--codex-arg', fixture];

async function connection(t: TestContext, options: { env?: Record<string, string>; extraArgs?: string[]; onStderr?: (text: string) => void } = {}) {
  const env = { ...process.env, CODEX_DISCUSSION_UPDATE_CHECK: '0', ...options.env } as Record<string, string>;
  const transport = new StdioClientTransport({ command: process.execPath, args: [...args, ...options.extraArgs ?? []], env, stderr: 'pipe' });
  transport.stderr?.on('data', chunk => options.onStderr?.(String(chunk)));
  const client = new Client({ name: 'discussion-mcp-test', version: '1.0.0' }, { capabilities: {} });
  t.after(() => client.close());
  await client.connect(transport);
  return client;
}

test('CLI help and version work without starting Codex or requesting npm metadata', async () => {
  const help = await execFile(process.execPath, ['--import', registry, '--import', 'tsx', entry, '--help', '--codex-command', '/nonexistent/codex'], { env: { ...process.env, CODEX_DISCUSSION_UPDATE_CHECK: '1' } });
  assert.match(help.stdout, /codex-discussion-mcp/);
  assert.match(help.stdout, /--no-update-check/);
  assert.equal(help.stderr, '');
  const version = await execFile(process.execPath, ['--import', registry, '--import', 'tsx', entry, '--version'], { env: { ...process.env, CODEX_DISCUSSION_UPDATE_CHECK: '1' } });
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  assert.equal(version.stdout.trim(), pkg.version);
  assert.equal(version.stderr, '');
});

test('models_list adds update metadata in structured and text results without changing catalog semantics', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-mcp-updates-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let stderr = '';
  const client = await connection(t, { env: { CODEX_DISCUSSION_UPDATE_CHECK: '1', XDG_CACHE_HOME: dir }, onStderr: text => { stderr += text; } });
  const catalog = await client.callTool({ name: 'models_list', arguments: {} });
  const data = record(catalog.structuredContent);
  assert.equal(data.accessVerified, false);
  assert.equal((data.models as unknown[]).length, 2);
  assert.equal(typeof data.retrievedAt, 'string');
  assert.equal(record(data.update).status, 'available');
  assert.equal(record(data.update).latestVersion, '99.0.0');
  assert.match(String(record(data.update).notice), /reconnect/);
  const text = (catalog.content as Array<{ type: string; text: string }>).find(item => item.type === 'text')!.text;
  assert.deepEqual(JSON.parse(text), data);
  await client.callTool({ name: 'models_list', arguments: { includeHidden: true } });
  assert.equal(stderr.match(/\[test registry lookup\]/g)?.length, 1);
  await client.close();
  const reconnected = await connection(t, { env: { CODEX_DISCUSSION_UPDATE_CHECK: '1', XDG_CACHE_HOME: dir, TEST_REGISTRY_MODE: 'offline' }, onStderr: text => { stderr += text; } });
  const cached = record((await reconnected.callTool({ name: 'models_list', arguments: {} })).structuredContent);
  assert.deepEqual(cached.update, data.update, 'persisted metadata must survive MCP process restart');
  assert.equal(stderr.match(/\[test registry lookup\]/g)?.length, 1);
});

for (const optOut of ['environment', 'flag'] as const) {
  test(`${optOut} opt-out disables registry requests and cache writes`, async t => {
    const dir = await mkdtemp(join(tmpdir(), 'codex-mcp-disabled-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    let stderr = '';
    const client = await connection(t, {
      env: { CODEX_DISCUSSION_UPDATE_CHECK: optOut === 'environment' ? '0' : '1', XDG_CACHE_HOME: dir },
      extraArgs: optOut === 'flag' ? ['--no-update-check'] : [], onStderr: text => { stderr += text; },
    });
    const data = record((await client.callTool({ name: 'models_list', arguments: {} })).structuredContent);
    assert.equal(record(data.update).status, 'disabled');
    assert.equal(stderr, '');
    assert.deepEqual(await readdir(dir), []);
  });
}

test('cache read and write errors leave models_list and discussions usable', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-mcp-cache-errors-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'codex-discussion-mcp', 'update.json'), { recursive: true });
  const client = await connection(t, { env: { CODEX_DISCUSSION_UPDATE_CHECK: '1', XDG_CACHE_HOME: dir } });
  const data = record((await client.callTool({ name: 'models_list', arguments: {} })).structuredContent);
  assert.equal(record(data.update).status, 'available');
  assert.equal(data.accessVerified, false);
  const first = record((await client.callTool({ name: 'discussion_start', arguments: { message: 'early' } })).structuredContent);
  assert.equal(record((await client.callTool({ name: 'discussion_read', arguments: { discussionId: first.discussionId } })).structuredContent).status, 'completed');
});

for (const mode of ['offline', 'hang'] as const) {
  test(`registry ${mode} leaves submissions, polling and cancellation usable`, async t => {
    const dir = await mkdtemp(join(tmpdir(), 'codex-mcp-offline-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const client = await connection(t, { env: { CODEX_DISCUSSION_UPDATE_CHECK: '1', XDG_CACHE_HOME: dir, TEST_REGISTRY_MODE: mode } });
    let finished = false;
    const catalog = client.callTool({ name: 'models_list', arguments: {} }).then(value => { finished = true; return value; });
    const first = record((await client.callTool({ name: 'discussion_start', arguments: { message: 'hold' } })).structuredContent);
    assert.equal(first.status, 'inProgress');
    assert.equal(record((await client.callTool({ name: 'discussion_read', arguments: { discussionId: first.discussionId } })).structuredContent).status, 'inProgress');
    await client.callTool({ name: 'discussion_cancel', arguments: { discussionId: first.discussionId, turnId: first.turnId } });
    assert.equal(record((await client.callTool({ name: 'discussion_read', arguments: { discussionId: first.discussionId } })).structuredContent).status, 'interrupted');
    if (mode === 'hang') assert.equal(finished, false, 'discussion tools must not await the registry');
    const data = record((await catalog).structuredContent);
    assert.equal(record(data.update).status, 'unavailable');
    assert.equal(record(data.update).notice, undefined);
    assert.equal(data.accessVerified, false);
  });
}

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
    const child = spawn(process.execPath, [...args, `--codex-arg=--pid-file=${pidFile}`], { env: { ...process.env, CODEX_DISCUSSION_UPDATE_CHECK: '1', XDG_CACHE_HOME: dir }, stdio: ['pipe', 'pipe', 'pipe'] });
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
    const result = record((await request('tools/call', { name: 'models_list', arguments: {} })).result);
    const legacyText = (result.content as Array<{ text: string }>)[0]!.text;
    const legacyCatalog = record(JSON.parse(legacyText));
    assert.equal(legacyCatalog.accessVerified, false);
    assert.equal(record(legacyCatalog.update).status, 'available');
    assert.match(String(record(legacyCatalog.update).notice), /99\.0\.0/);
    const pid = Number(await readFile(pidFile, 'utf8'));
    const exited = once(child, 'exit');
    if (shutdown === 'stdin') child.stdin.end(); else child.kill(shutdown);
    await exited;
    assert.throws(() => process.kill(pid, 0), /ESRCH/);
  });
}
