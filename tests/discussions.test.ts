import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { discussionClient } from './helpers.js';

test('start returns the chosen settings and retains completion before RPC response', async t => {
  const { service, rpc } = discussionClient(t);
  const started = await service.start({ message: 'early answer', model: 'alpha', effort: 'high' });
  assert.equal(started.model, 'alpha');
  assert.equal(started.effort, 'high');
  const read = await service.read({ discussionId: started.discussionId });
  assert.equal(read.status, 'completed');
  assert.equal(read.messages.filter(item => item.role === 'assistant')[0]?.text, 'Codex answer');
  const requests = await rpc.request<Array<{ method: string; params: Record<string, unknown> }>>('test/requests', {});
  const start = requests.find(request => request.method === 'thread/start')!;
  assert.equal(start.params.sandbox, 'read-only');
  assert.equal(start.params.approvalPolicy, 'never');
  assert.deepEqual(start.params.config, {
    'features.apps': false, 'features.plugins': false,
    'mcp_servers."discussion.recursive".enabled': false,
    'mcp_servers."other".enabled': false,
  });
  const turn = requests.find(request => request.method === 'turn/start')!;
  assert.equal(turn.params.model, 'alpha');
  assert.equal(turn.params.effort, 'high');
});

test('reply preserves defaults and resets effort when the model changes', async t => {
  const { service } = discussionClient(t);
  const first = await service.start({ message: 'early', effort: 'high' });
  const second = await service.reply({ discussionId: first.discussionId, message: 'early again' });
  assert.equal(second.effort, 'high');
  const third = await service.reply({ discussionId: first.discussionId, message: 'early different', model: 'beta' });
  assert.equal(third.model, 'beta');
  assert.equal(third.effort, 'medium');
});

test('rejects active-thread and concurrent submissions instead of queuing turns', async t => {
  const { service } = discussionClient(t);
  const first = await service.start({ message: 'early' });
  const results = await Promise.allSettled([
    service.reply({ discussionId: first.discussionId, message: 'hold' }),
    service.reply({ discussionId: first.discussionId, message: 'hold too' }),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
  assert.equal(rejected.reason.code, 'DISCUSSION_BUSY');
  await assert.rejects(service.reply({ discussionId: first.discussionId, message: 'another' }), /active|busy/i);
});

test('different discussions execute independently', async t => {
  const { service } = discussionClient(t);
  const [first, second] = await Promise.all([service.start({ message: 'hold' }), service.start({ message: 'hold' })]);
  assert.notEqual(first.discussionId, second.discussionId);
  assert.equal((await service.read({ discussionId: first.discussionId })).status, 'inProgress');
});

test('completed item replaces streaming deltas without duplicating messages', async t => {
  const { service, rpc } = discussionClient(t);
  const first = await service.start({ message: 'hold' });
  await rpc.request('test/event', { method: 'item/agentMessage/delta', params: { threadId: first.discussionId, turnId: first.turnId, itemId: `assistant-${first.turnId}`, delta: 'partial' } });
  await rpc.request('test/complete', { threadId: first.discussionId, text: 'Authoritative final answer' });
  const read = await service.read({ discussionId: first.discussionId });
  const assistants = read.messages.filter(item => item.role === 'assistant');
  assert.equal(assistants.length, 1);
  assert.equal(assistants[0]?.text, 'Authoritative final answer');
});

test('read paginates and rejects cursors used in another discussion', async t => {
  const { service } = discussionClient(t);
  const first = await service.start({ message: 'early' });
  const page = await service.read({ discussionId: first.discussionId, limit: 1 });
  assert.equal(page.messages[0]?.role, 'user');
  assert.ok(page.nextCursor);
  const next = await service.read({ discussionId: first.discussionId, cursor: page.nextCursor!, limit: 1 });
  assert.equal(next.messages[0]?.role, 'assistant');
  assert.equal(next.nextCursor, null);
  const second = await service.start({ message: 'early' });
  await assert.rejects(service.read({ discussionId: second.discussionId, cursor: page.nextCursor! }), /cursor/i);
});

test('large message text is chunked without losing content', async t => {
  const { service, rpc } = discussionClient(t);
  const first = await service.start({ message: 'hold' });
  const text = '큰'.repeat(20_001);
  await rpc.request('test/complete', { threadId: first.discussionId, text });
  let cursor: string | undefined;
  let collected = '';
  do {
    const page = await service.read({ discussionId: first.discussionId, cursor, limit: 1 });
    for (const message of page.messages) {
      assert.ok(message.text.length <= 8000);
      if (message.role === 'assistant') collected += message.text;
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  assert.equal(collected, text);
});

test('long poll wakes on new output before its wait deadline', async t => {
  const { service, rpc } = discussionClient(t);
  const first = await service.start({ message: 'hold' });
  const read = service.read({ discussionId: first.discussionId, waitMs: 1000 });
  await rpc.request('test/event', { method: 'item/agentMessage/delta', params: { threadId: first.discussionId, turnId: first.turnId, itemId: 'partial', delta: 'new output' } });
  const result = await read;
  assert.equal(result.status, 'inProgress');
  assert.ok(result.messages.some(message => message.text === 'new output'));
});

test('long poll responds to cancellation', async t => {
  const { service } = discussionClient(t);
  const first = await service.start({ message: 'hold' });
  const controller = new AbortController();
  const read = service.read({ discussionId: first.discussionId, waitMs: 1000 }, controller.signal);
  controller.abort();
  await assert.rejects(read, /cancel|abort/i);
});

test('failed inference remains failed and exposes its error', async t => {
  const { service } = discussionClient(t);
  const first = await service.start({ message: 'fail' });
  let result = await service.read({ discussionId: first.discussionId, waitMs: 1000 });
  for (let poll = 0; result.status === 'inProgress' && poll < 5; poll++) {
    result = await service.read({ discussionId: first.discussionId, waitMs: 1000 });
  }
  assert.equal(result.status, 'failed');
  assert.match(result.error?.message ?? '', /Fixture inference failed/);
});

test('process loss marks active turns connectionLost without replay', async t => {
  const { service, rpc } = discussionClient(t);
  const first = await service.start({ message: 'hold' });
  await assert.rejects(rpc.request('test/exit', {}));
  const result = await service.read({ discussionId: first.discussionId });
  assert.equal(result.status, 'connectionLost');
  assert.ok(result.error);
});

test('cancel targets the specified turn and preserves completed older turns', async t => {
  const { service } = discussionClient(t);
  const first = await service.start({ message: 'early' });
  const second = await service.reply({ discussionId: first.discussionId, message: 'hold' });
  const old = await service.cancel({ discussionId: first.discussionId, turnId: first.turnId });
  assert.equal(old.status, 'completed');
  assert.equal((await service.read({ discussionId: first.discussionId })).status, 'inProgress');
  await service.cancel({ discussionId: first.discussionId, turnId: second.turnId });
  assert.equal((await service.read({ discussionId: first.discussionId })).status, 'interrupted');
});

test('resume restores thread defaults and reads persisted public history only', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-discussion-history-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const args = [`--state-file=${join(dir, 'state.json')}`];
  const firstClient = discussionClient(t, args);
  const first = await firstClient.service.start({ message: 'early original', model: 'alpha', effort: 'high' });
  await firstClient.service.close();
  const { service, rpc } = discussionClient(t, args);
  const history = await service.read({ discussionId: first.discussionId });
  assert.equal(history.status, 'completed');
  assert.ok(history.messages.some(message => message.text === 'Codex answer'));
  assert.ok(!JSON.stringify(history).includes('private reasoning'));
  assert.equal(history.model, null, 'historic per-turn selection must not be invented from thread defaults');
  assert.deepEqual(history.threadDefaults, { model: 'alpha', effort: 'high' });
  const next = await service.reply({ discussionId: first.discussionId, message: 'early follow-up' });
  assert.equal(next.model, 'alpha');
  assert.equal(next.effort, 'high');
  const requests = await rpc.request<Array<{ method: string; params: Record<string, unknown> }>>('test/requests', {});
  assert.equal(requests.find(request => request.method === 'thread/resume')?.params.sandbox, 'read-only');
});

test('invalid project directory or unknown turn is rejected explicitly', async t => {
  const { service } = discussionClient(t);
  await assert.rejects(service.start({ message: 'hello', cwd: 'relative/path' }), /absolute/i);
  await assert.rejects(service.start({ message: 'hello', cwd: '/path/that/does/not/exist' }), /directory/i);
  const first = await service.start({ message: 'early' });
  await assert.rejects(service.read({ discussionId: first.discussionId, turnId: 'missing' }), /turn.*found/i);
});
