import assert from 'node:assert/strict';
import { test } from 'node:test';
import { discussionClient } from './helpers.js';
import type { RpcClient } from '../src/protocol.js';

async function waiting(rpc: RpcClient) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await rpc.request<{ waiting: boolean }>('test/gateStatus', {})).waiting) return;
  }
  assert.fail('The expected fixture RPC did not reach its gate.');
}

test('forget releases completed local state, invalidates cursors and preserves saved history', async t => {
  const { service, rpc } = discussionClient(t);
  const first = await service.start({ message: 'early original' });
  const page = await service.read({ discussionId: first.discussionId, limit: 1 });
  assert.ok(page.nextCursor);
  assert.deepEqual(await service.forget({ discussionId: first.discussionId }), { discussionId: first.discussionId, forgotten: true });
  assert.deepEqual(await service.forget({ discussionId: first.discussionId }), { discussionId: first.discussionId, forgotten: false });
  await assert.rejects(service.read({ discussionId: first.discussionId, cursor: page.nextCursor! }), { code: 'INVALID_CURSOR' });
  const resumed = await service.read({ discussionId: first.discussionId });
  assert.equal(resumed.status, 'completed');
  assert.ok(resumed.messages.some(message => message.text === 'Codex answer'));
  await assert.rejects(service.read({ discussionId: first.discussionId, cursor: page.nextCursor! }), { code: 'INVALID_CURSOR' });
  const requests = await rpc.request<Array<{ method: string }>>('test/requests', {});
  assert.equal(requests.filter(request => request.method === 'turn/start').length, 1);
  assert.ok(!requests.some(request => /delete|archive|interrupt/.test(request.method)));
});

test('forget retains output after disconnect until explicit release', async t => {
  const { service, rpc } = discussionClient(t);
  const first = await service.start({ message: 'early original' });
  await service.forget({ discussionId: first.discussionId });
  const before = await service.read({ discussionId: first.discussionId, limit: 1 });
  await assert.rejects(rpc.request('test/exit', {}));
  assert.deepEqual(await service.read({ discussionId: first.discussionId, limit: 1 }), before);
  assert.equal((await service.forget({ discussionId: first.discussionId })).forgotten, true);
  await assert.rejects(service.read({ discussionId: first.discussionId, cursor: before.nextCursor! }), { code: 'INVALID_CURSOR' });
  await assert.rejects(service.read({ discussionId: first.discussionId }), { code: 'CONNECTION_LOST' });
  assert.equal((await service.forget({ discussionId: first.discussionId })).forgotten, false);
});

test('forget rejects active owned turns and unknown disconnect outcomes', async t => {
  const { service, rpc } = discussionClient(t);
  const active = await service.start({ message: 'hold' });
  await assert.rejects(service.forget({ discussionId: active.discussionId }), { code: 'DISCUSSION_BUSY' });
  await assert.rejects(rpc.request('test/exit', {}));
  await assert.rejects(service.forget({ discussionId: active.discussionId }), { code: 'DISCUSSION_BUSY' });
  assert.equal((await service.read({ discussionId: active.discussionId })).status, 'connectionLost');
});

for (const status of ['completed', 'failed', 'interrupted']) {
  test(`forget accepts a confirmed ${status} turn`, async t => {
    const { service, rpc } = discussionClient(t);
    const first = await service.start({ message: 'hold' });
    await rpc.request('test/complete', { threadId: first.discussionId, status });
    assert.equal((await service.forget({ discussionId: first.discussionId })).forgotten, true);
  });
}

test('forget rejects active external work and releases after it ends', async t => {
  const { service, rpc } = discussionClient(t);
  const first = await service.start({ message: 'early' });
  await rpc.request('test/externalStart', { threadId: first.discussionId });
  await assert.rejects(service.forget({ discussionId: first.discussionId }), { code: 'DISCUSSION_BUSY' });
  await rpc.request('test/externalComplete', { threadId: first.discussionId });
  assert.equal((await service.forget({ discussionId: first.discussionId })).forgotten, true);
});

for (const submissionKind of ['initial start', 'reply']) {
  test(`forget protects an uncertain ${submissionKind} that timed out before its first event`, async t => {
    const { service, rpc } = discussionClient(t);
    const previous = submissionKind === 'reply' ? await service.start({ message: 'early original' }) : undefined;
    await rpc.request('test/blockNext', { method: 'turn/start' });
    const submission = previous
      ? service.reply({ discussionId: previous.discussionId, message: 'hold follow-up' })
      : service.start({ message: 'hold initial' });
    const timedOut = assert.rejects(submission, { code: 'RPC_TIMEOUT' });
    await waiting(rpc);
    const requests = await rpc.request<Array<{ method: string; params: { threadId?: string } }>>('test/requests', {});
    const discussionId = requests.filter(request => request.method === 'turn/start').at(-1)!.params.threadId!;
    await timedOut;
    await assert.rejects(service.forget({ discussionId }), { code: 'DISCUSSION_BUSY' });
    if (previous) assert.ok((await service.read({ discussionId })).messages.some(message => message.text === 'Codex answer'));
  });
}

for (const observer of ['forget', 'reply', 'read']) {
  test(`forget protects external activity observed by ${observer} before disconnect`, async t => {
    const { service, rpc } = discussionClient(t);
    const first = await service.start({ message: 'early' });
    await rpc.request('test/externalStart', { threadId: first.discussionId });
    const observe = observer === 'reply'
      ? service.reply({ discussionId: first.discussionId, message: 'hold follow-up' })
      : observer === 'read'
        ? service.read({ discussionId: first.discussionId })
        : service.forget({ discussionId: first.discussionId });
    await assert.rejects(observe, { code: 'DISCUSSION_BUSY' });
    await assert.rejects(rpc.request('test/exit', {}));
    await assert.rejects(service.forget({ discussionId: first.discussionId }), { code: 'DISCUSSION_BUSY' });
  });
}

test('forget accepts a completed turn observed before its submission response timed out', async t => {
  const { service, rpc } = discussionClient(t, ['--drop-turn-start-response']);
  const completed = new Promise<string>(resolve => {
    const unsubscribe = rpc.onNotification(event => {
      if (event.method !== 'turn/completed') return;
      unsubscribe();
      resolve(String(event.params.threadId));
    });
  });
  const failedSubmission = assert.rejects(service.start({ message: 'early original' }), { code: 'RPC_TIMEOUT' });
  const discussionId = await completed;
  await failedSubmission;
  assert.equal((await service.read({ discussionId })).status, 'completed');
  assert.equal((await service.forget({ discussionId })).forgotten, true);
});

test('forget accepts confirmed completion after observing owned activity then disconnecting', async t => {
  const { service, rpc } = discussionClient(t);
  const first = await service.start({ message: 'hold' });
  assert.equal((await service.read({ discussionId: first.discussionId })).status, 'inProgress');
  await rpc.request('test/complete', { threadId: first.discussionId });
  await assert.rejects(rpc.request('test/exit', {}));
  assert.equal((await service.forget({ discussionId: first.discussionId })).forgotten, true);
});

for (const method of ['thread/read', 'thread/items/list', 'turn/start', 'turn/interrupt']) {
  test(`forget protects a pending ${method} operation`, async t => {
    const { service, rpc } = discussionClient(t);
    const first = await service.start({ message: method === 'turn/interrupt' ? 'hold' : 'early' });
    if (method === 'thread/items/list') {
      await service.forget({ discussionId: first.discussionId });
      await service.read({ discussionId: first.discussionId });
    }
    await rpc.request('test/blockNext', { method });
    const operation = method === 'turn/start'
      ? service.reply({ discussionId: first.discussionId, message: 'early follow-up' })
      : method === 'turn/interrupt'
        ? service.cancel({ discussionId: first.discussionId, turnId: first.turnId })
        : service.read({ discussionId: first.discussionId });
    await waiting(rpc);
    try {
      await assert.rejects(service.forget({ discussionId: first.discussionId }), { code: 'DISCUSSION_BUSY' });
    } finally {
      await rpc.request('test/releaseGate', {});
      await operation;
    }
    assert.equal((await service.forget({ discussionId: first.discussionId })).forgotten, true);
  });
}

test('forget protects a pending saved-discussion load', async t => {
  const { service, rpc } = discussionClient(t);
  const first = await service.start({ message: 'early' });
  await service.forget({ discussionId: first.discussionId });
  await rpc.request('test/blockNext', { method: 'thread/resume' });
  const loading = service.read({ discussionId: first.discussionId });
  await waiting(rpc);
  try {
    await assert.rejects(service.forget({ discussionId: first.discussionId }), { code: 'DISCUSSION_BUSY' });
  } finally {
    await rpc.request('test/releaseGate', {});
    await loading;
  }
  assert.equal((await service.forget({ discussionId: first.discussionId })).forgotten, true);
});

test('forget protects a registered long poll until cancellation and its read finish', async t => {
  const { service, rpc } = discussionClient(t);
  const first = await service.start({ message: 'hold' });
  const poll = service.read({ discussionId: first.discussionId, waitMs: 20_000 });
  const retained = service as unknown as { discussions: Map<string, { turns: Map<string, { waiters: Set<unknown> }> }> };
  const waiters = retained.discussions.get(first.discussionId)!.turns.get(first.turnId)!.waiters;
  for (let attempt = 0; attempt < 100 && waiters.size === 0; attempt++) await rpc.request('test/echo', {});
  assert.equal(waiters.size, 1, 'The read must be polling before release is attempted.');
  try {
    await assert.rejects(service.forget({ discussionId: first.discussionId }), { code: 'DISCUSSION_BUSY' });
  } finally {
    await service.cancel({ discussionId: first.discussionId, turnId: first.turnId });
    await poll;
  }
  assert.equal(waiters.size, 0);
  assert.equal((await service.forget({ discussionId: first.discussionId })).forgotten, true);
});

test('forget protects an initial submission before its turn-start response', async t => {
  const { service, rpc } = discussionClient(t);
  await rpc.request('test/blockNext', { method: 'turn/start' });
  const submission = service.start({ message: 'early' });
  await waiting(rpc);
  const requests = await rpc.request<Array<{ method: string; params: { threadId?: string } }>>('test/requests', {});
  const discussionId = requests.find(request => request.method === 'turn/start')!.params.threadId!;
  try {
    await assert.rejects(service.forget({ discussionId }), { code: 'DISCUSSION_BUSY' });
  } finally {
    await rpc.request('test/releaseGate', {});
    await submission;
  }
  assert.equal((await service.forget({ discussionId })).forgotten, true);
});

test('failed backend checks and reads do not leave a release or operation claim behind', async t => {
  const { service, rpc } = discussionClient(t);
  const first = await service.start({ message: 'early' });
  const error = { method: 'thread/read', includeTurns: false, code: -32001, message: 'Fixture metadata unavailable' };
  await rpc.request('test/readErrors', { threadId: first.discussionId, errors: [error] });
  await assert.rejects(service.forget({ discussionId: first.discussionId }), { code: 'APP_SERVER_ERROR' });
  assert.equal((await service.read({ discussionId: first.discussionId })).status, 'completed');
  await rpc.request('test/readErrors', { threadId: first.discussionId, errors: [error] });
  await assert.rejects(service.read({ discussionId: first.discussionId }), { code: 'APP_SERVER_ERROR' });
  assert.equal((await service.forget({ discussionId: first.discussionId })).forgotten, true);
});

test('forget claims release before checking backend freshness', async t => {
  const { service, rpc } = discussionClient(t);
  const first = await service.start({ message: 'early' });
  await rpc.request('test/blockNext', { method: 'thread/read' });
  const releasing = service.forget({ discussionId: first.discussionId });
  await waiting(rpc);
  try {
    for (const operation of [
      () => service.forget({ discussionId: first.discussionId }),
      () => service.read({ discussionId: first.discussionId }),
      () => service.reply({ discussionId: first.discussionId, message: 'early' }),
      () => service.cancel({ discussionId: first.discussionId, turnId: first.turnId }),
    ]) await assert.rejects(operation(), { code: 'DISCUSSION_BUSY' });
  } finally {
    await rpc.request('test/releaseGate', {});
    await releasing;
  }
});

test('forget rechecks local activity received during its backend check', async t => {
  const { service, rpc } = discussionClient(t);
  const first = await service.start({ message: 'early' });
  await rpc.request('test/blockNext', { method: 'thread/read' });
  const releasing = service.forget({ discussionId: first.discussionId });
  // Attach the expected rejection before the fixture can send it.
  const rejected = assert.rejects(releasing, { code: 'DISCUSSION_BUSY' });
  await waiting(rpc);
  await rpc.request('test/event', { method: 'turn/started', params: {
    threadId: first.discussionId, turn: { id: 'new-active', status: 'inProgress' },
  } });
  await rpc.request('test/releaseGate', {});
  await rejected;
});

test('forget does not retain unknown IDs or accumulate released state', async t => {
  const { service, rpc } = discussionClient(t);
  for (let index = 0; index < 20; index++) {
    assert.equal((await service.forget({ discussionId: `unknown-${index}` })).forgotten, false);
    const first = await service.start({ message: 'early' });
    await service.forget({ discussionId: first.discussionId });
  }
  // Count owned state deterministically; process RSS depends on GC scheduling.
  const retained = service as unknown as { discussions: Map<string, unknown>; loading: Map<string, unknown> };
  assert.equal(retained.discussions.size, 0);
  assert.equal(retained.loading.size, 0);
  const requests = await rpc.request<Array<{ method: string; params: { threadId?: string } }>>('test/requests', {});
  assert.ok(!requests.some(request => request.params.threadId?.startsWith('unknown-')));
});
