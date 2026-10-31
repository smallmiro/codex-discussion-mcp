import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { AppServer } from '../src/app-server.js';

const fixture = fileURLToPath(new URL('./fixtures/app-server.mjs', import.meta.url));
function client(t: { after: (fn: () => unknown) => void }, overrides = {}) {
  const rpc = new AppServer({ command: process.execPath, args: [fixture], rpcTimeoutMs: 2000, ...overrides });
  t.after(() => rpc.close());
  return rpc;
}

test('initializes before sending requests and correlates out-of-order replies', async t => {
  const rpc = client(t);
  const [first, second] = await Promise.all([
    rpc.request('test/echo', { value: 'first', delay: 20 }),
    rpc.request('test/echo', { value: 'second', delay: 0 }),
  ]);
  assert.deepEqual(first, { value: 'first', delay: 20 });
  assert.deepEqual(second, { value: 'second', delay: 0 });
});

test('reassembles JSONL and UTF-8 characters split across stdout chunks', async t => {
  assert.deepEqual(await client(t).request('test/split', {}), { text: '한글🙂' });
});

test('preserves notifications arriving before the RPC response', async t => {
  const rpc = client(t);
  const seen: string[] = [];
  rpc.onNotification(message => seen.push(message.method));
  await rpc.request('test/notify', {});
  assert.deepEqual(seen, ['item/agentMessage/delta']);
});

test('child exit rejects pending requests and notifies connection loss', async t => {
  const rpc = client(t);
  let lost = false;
  rpc.onDisconnect(() => { lost = true; });
  await assert.rejects(rpc.request('test/exit', {}), /connection|exited/i);
  assert.equal(lost, true);
});

test('fixture preserves its last saved history when a state write is interrupted', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-fixture-save-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const stateFile = join(dir, 'state.json');
  const saved = { 'thread-1': { id: 'thread-1', status: { type: 'idle' }, turns: [] } };
  await writeFile(stateFile, JSON.stringify(saved));
  // Terminate after truncation to reproduce shutdown during a snapshot write.
  const interruptWrite = `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const write = fs.writeFileSync;
    fs.writeFileSync = (file, ...args) => {
      if (String(file).startsWith(${JSON.stringify(stateFile)})) {
        write(file, '');
        process.exit(42);
      }
      return write(file, ...args);
    };
    syncBuiltinESMExports();
  `;
  const hook = `data:text/javascript;base64,${Buffer.from(interruptWrite).toString('base64')}`;
  const rpc = client(t, { args: ['--import', hook, fixture, `--state-file=${stateFile}`] });
  await assert.rejects(rpc.request('test/externalStart', { threadId: 'thread-1' }), /connection|exited/i);
  assert.deepEqual(JSON.parse(await readFile(stateFile, 'utf8')), saved);
  const resumed = client(t, { args: [fixture, `--state-file=${stateFile}`] });
  const result = await resumed.request<{ thread: { status: { type: string } } }>('thread/read', { threadId: 'thread-1' });
  assert.equal(result.thread.status.type, 'idle');
});

test('a timed-out request closes the connection instead of replaying mutations', async t => {
  const rpc = client(t, { rpcTimeoutMs: 150 });
  await assert.rejects(rpc.request('test/hang', {}), /timed out/i);
  await assert.rejects(rpc.request('test/echo', {}), /connection|closed/i);
});

for (const method of ['test/invalid', 'test/oversized']) {
  test(`${method} terminates malformed or unbounded protocol output`, async t => {
    const rpc = client(t, { maxFrameBytes: 4096 });
    await assert.rejects(rpc.request(method, {}), /JSON|frame|protocol/i);
  });
}

for (const [method, expected] of [
  ['item/commandExecution/requestApproval', { decision: 'decline' }],
  ['item/fileChange/requestApproval', { decision: 'decline' }],
  ['item/tool/requestUserInput', { answers: {} }],
  ['mcpServer/elicitation/request', { action: 'decline' }],
  ['item/tool/call', { contentItems: [{ type: 'inputText', text: 'Dynamic tools are unavailable in read-only discussion mode.' }], success: false }],
] as const) {
  test(`explicitly declines unsupported interactive request ${method}`, async t => {
    const actual = await client(t).request('test/serverRequest', { method });
    assert.deepEqual(actual, expected);
  });
}

test('unknown server requests receive an error rather than hanging', async t => {
  const actual = await client(t).request<{ code: number }>('test/serverRequest', { method: 'unknown/request' });
  assert.equal(actual.code, -32601);
});

test('unknown method errors preserve RPC details without killing a healthy connection', async t => {
  const rpc = client(t);
  await assert.rejects(rpc.request('missing', {}), /Unknown method missing/);
  assert.deepEqual(await rpc.request('test/echo', { alive: true }), { alive: true });
});
