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
    mcp_servers: { 'discussion.recursive': { enabled: false }, other: { enabled: false } },
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
  await rpc.request('test/armReadNotification', { threadId: first.discussionId, turnId: first.turnId, itemId: 'partial', delta: 'new output' });
  const before = performance.now();
  const result = await service.read({ discussionId: first.discussionId, waitMs: 1000 });
  assert.ok(performance.now() - before < 750, 'Output received during backend freshness checks must wake the read');
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

test('successful completion clears a transient inference error', async t => {
  const { service, rpc } = discussionClient(t);
  const first = await service.start({ message: 'hold' });
  await rpc.request('test/event', { method: 'error', params: {
    threadId: first.discussionId, turnId: first.turnId,
    error: { message: 'Transient provider issue' }, willRetry: true,
  } });
  await rpc.request('test/complete', { threadId: first.discussionId });
  const read = await service.read({ discussionId: first.discussionId });
  assert.equal(read.status, 'completed');
  assert.equal(read.error, undefined);
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
  assert.equal(requests.find(request => request.method === 'thread/turns/list')?.params.itemsView, 'notLoaded');
});

test('invalid project directory or unknown turn is rejected explicitly', async t => {
  const { service } = discussionClient(t);
  await assert.rejects(service.start({ message: 'hello', cwd: 'relative/path' }), /absolute/i);
  await assert.rejects(service.start({ message: 'hello', cwd: '/path/that/does/not/exist' }), /directory/i);
  const first = await service.start({ message: 'early' });
  await assert.rejects(service.read({ discussionId: first.discussionId, turnId: 'missing' }), /turn.*found/i);
});

test('cached reads detect foreign activity and refresh the latest persisted turn after it ends', async t => {
  const { service, rpc } = discussionClient(t);
  const first = await service.start({ message: 'early' });
  assert.equal((await service.read({ discussionId: first.discussionId })).status, 'completed');
  const external = await rpc.request<{ turnId: string }>('test/externalStart', { threadId: first.discussionId });
  await assert.rejects(service.read({ discussionId: first.discussionId }), error => {
    assert.equal((error as { code: string }).code, 'DISCUSSION_BUSY');
    return true;
  });
  await rpc.request('test/externalComplete', { threadId: first.discussionId });
  const latest = await service.read({ discussionId: first.discussionId });
  assert.equal(latest.turnId, external.turnId);
  assert.equal(latest.status, 'completed');
  assert.ok(latest.messages.some(message => message.text === 'External answer'));
  assert.deepEqual(latest.threadDefaults, { model: 'beta', effort: 'medium' });
  const old = await service.read({ discussionId: first.discussionId, turnId: first.turnId });
  assert.equal(old.turnId, first.turnId);
  assert.ok(old.messages.some(message => message.text === 'Codex answer'));
});

test('completed local output remains readable after the backend connection is lost', async t => {
  const { service, rpc } = discussionClient(t);
  const first = await service.start({ message: 'early' });
  await assert.rejects(rpc.request('test/exit', {}));
  const read = await service.read({ discussionId: first.discussionId });
  assert.equal(read.status, 'completed');
  assert.ok(read.messages.some(message => message.text === 'Codex answer'));
});

test('freshness checks fall back when a new live thread has no paginated history yet', async t => {
  const { service, rpc } = discussionClient(t, ['--no-live-history']);
  const first = await service.start({ message: 'hold' });
  assert.equal((await service.read({ discussionId: first.discussionId })).status, 'inProgress');
  await rpc.request('test/complete', { threadId: first.discussionId });
  assert.equal((await service.read({ discussionId: first.discussionId })).status, 'completed');
  const external = await rpc.request<{ turnId: string }>('test/externalStart', { threadId: first.discussionId });
  await assert.rejects(service.read({ discussionId: first.discussionId }), /active|pending/i);
  await rpc.request('test/externalComplete', { threadId: first.discussionId });
  const latest = await service.read({ discussionId: first.discussionId });
  assert.equal(latest.turnId, external.turnId);
  assert.ok(latest.messages.some(message => message.text === 'External answer'));
});

for (const submission of ['start', 'reply']) {
  test(`reads survive all startup RPC failures after ${submission} without replaying inference`, async t => {
    const { service, rpc } = discussionClient(t, ['--startup-read-errors']);
    let active = await service.start({ message: 'hold' });
    if (submission === 'reply') {
      await rpc.request('test/complete', { threadId: active.discussionId });
      await rpc.request('test/readErrors', { threadId: active.discussionId, errors: [] });
      active = await service.reply({ discussionId: active.discussionId, message: 'hold' });
    }
    const first = await service.read({ discussionId: active.discussionId, turnId: active.turnId });
    assert.equal(first.status, 'inProgress');
    assert.equal(first.messages[0]?.text, 'hold');

    // Output arriving during freshness checks must remain visible even when the
    // paginated read and its inline-history fallback both fail.
    await rpc.request('test/armReadNotification', {
      threadId: active.discussionId, turnId: active.turnId,
      itemId: `assistant-${active.turnId}`, delta: 'Partial answer',
    });
    const partial = await service.read({ discussionId: active.discussionId, waitMs: 20_000 });
    assert.equal(partial.status, 'inProgress');
    assert.ok(partial.messages.some(message => message.text === 'Partial answer'));
    await rpc.request('test/complete', { threadId: active.discussionId, text: 'Full authoritative answer' });
    const completed = await service.read({ discussionId: active.discussionId });
    assert.equal(completed.status, 'completed');
    assert.deepEqual(completed.messages.filter(message => message.role === 'assistant').map(message => message.text), ['Full authoritative answer']);
    const requests = await rpc.request<Array<{ method: string }>>('test/requests', {});
    assert.equal(requests.filter(request => request.method === 'turn/start').length, submission === 'start' ? 1 : 2);

    await rpc.request('test/externalStart', { threadId: active.discussionId });
    await assert.rejects(service.read({ discussionId: active.discussionId }), { code: 'DISCUSSION_BUSY' });
  });
}

const emptyRollout = 'failed to read thread: thread-store internal error: failed to read session metadata /tmp/session.jsonl: rollout at /tmp/session.jsonl is empty';
const noTurns = { method: 'thread/turns/list', code: -32601, message: 'list_turns is not supported yet' };
const inlineNoTurns = { method: 'thread/read', includeTurns: true, code: -32601, message: 'list_turns is not supported yet' };

test('owned running turns tolerate an unavailable inline-history fallback', async t => {
  const { service, rpc } = discussionClient(t);
  const active = await service.start({ message: 'hold' });
  await rpc.request('test/readErrors', { threadId: active.discussionId, errors: [noTurns, inlineNoTurns] });
  const read = await service.read({ discussionId: active.discussionId });
  assert.equal(read.status, 'inProgress');
  assert.equal(read.messages[0]?.text, 'hold');
});

test('owned running turns still report non-transient read errors', async t => {
  const { service, rpc } = discussionClient(t);
  const active = await service.start({ message: 'hold' });
  for (const failure of [
    { method: 'thread/read', includeTurns: false, code: -32603, message: 'Authentication failed' },
    { method: 'thread/read', includeTurns: false, code: -32603, message: 'failed to read thread: permission denied' },
    { method: 'thread/read', includeTurns: false, code: -32601, message: 'Unknown method thread/read' },
    { method: 'thread/read', includeTurns: false, code: -32001, message: emptyRollout },
    { method: 'thread/turns/list', code: -32603, message: 'Provider unavailable' },
    { method: 'thread/read', includeTurns: true, code: -32603, message: 'Invalid session metadata' },
  ]) {
    await rpc.request('test/readErrors', {
      threadId: active.discussionId, errors: failure.includeTurns ? [noTurns, failure] : [failure],
    });
    await assert.rejects(service.read({ discussionId: active.discussionId }), {
      code: 'APP_SERVER_ERROR', message: failure.message, details: { rpcCode: failure.code },
    });
  }
});

test('a startup error in the inline fallback does not hide an unknown listing failure', async t => {
  const { service, rpc } = discussionClient(t);
  const active = await service.start({ message: 'hold' });
  await rpc.request('test/readErrors', { threadId: active.discussionId, errors: [
    { method: 'thread/turns/list', code: -32601, message: 'Unknown method thread/turns/list' }, inlineNoTurns,
  ] });
  await assert.rejects(service.read({ discussionId: active.discussionId }), {
    code: 'APP_SERVER_ERROR', message: 'Unknown method thread/turns/list', details: { rpcCode: -32601 },
  });
  // An unsupported paginated API must still be allowed to use working inline history.
  await rpc.request('test/readErrors', { threadId: active.discussionId, errors: [
    { method: 'thread/turns/list', code: -32601, message: 'Unknown method thread/turns/list' },
  ] });
  assert.equal((await service.read({ discussionId: active.discussionId })).status, 'inProgress');
});

test('historical reads do not inherit the startup exception from an owned running reply', async t => {
  const { service, rpc } = discussionClient(t);
  const first = await service.start({ message: 'early' });
  const page = await service.read({ discussionId: first.discussionId, limit: 1 });
  assert.ok(page.nextCursor);
  await service.reply({ discussionId: first.discussionId, message: 'hold' });
  for (const selection of [{ turnId: first.turnId }, { cursor: page.nextCursor! }]) {
    await rpc.request('test/readErrors', { threadId: first.discussionId, errors: [
      { method: 'thread/read', includeTurns: false, code: -32603, message: emptyRollout },
    ] });
    await assert.rejects(service.read({ discussionId: first.discussionId, ...selection }), {
      code: 'APP_SERVER_ERROR', message: emptyRollout, details: { rpcCode: -32603 },
    });
  }
  assert.equal((await service.read({ discussionId: first.discussionId, turnId: first.turnId })).status, 'completed');
});

test('startup errors still surface for completed local turns and resumed history', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-discussion-startup-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const args = [`--state-file=${join(dir, 'state.json')}`];
  const original = discussionClient(t, args);
  const completed = await original.service.start({ message: 'early' });
  const resumed = discussionClient(t, args);
  assert.equal((await resumed.service.read({ discussionId: completed.discussionId })).status, 'completed');
  for (const { service, rpc } of [original, resumed]) {
    for (const errors of [
      [{ method: 'thread/read', includeTurns: false, code: -32603, message: emptyRollout }],
      [noTurns, inlineNoTurns],
    ]) {
      await rpc.request('test/readErrors', { threadId: completed.discussionId, errors });
      const failure = errors.at(-1)!;
      await assert.rejects(service.read({ discussionId: completed.discussionId }), {
        code: 'APP_SERVER_ERROR', message: failure.message, details: { rpcCode: failure.code },
      });
    }
  }
});
