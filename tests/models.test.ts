import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ModelCatalog } from '../src/models.js';
import type { RpcClient } from '../src/protocol.js';

export const alpha = {
  id: 'picker-alpha', model: 'alpha', displayName: 'Alpha', description: 'Everyday coding', hidden: false, isDefault: true,
  defaultReasoningEffort: 'low', supportedReasoningEfforts: [
    { reasoningEffort: 'low', description: 'Faster' }, { reasoningEffort: 'high', description: 'Deeper' },
  ],
};
export const beta = {
  id: 'picker-beta', model: 'beta', displayName: 'Beta', description: 'Harder problems', hidden: false, isDefault: false,
  defaultReasoningEffort: 'medium', supportedReasoningEfforts: [
    { reasoningEffort: 'medium', description: 'Balanced' }, { reasoningEffort: 'new-future-effort', description: 'Future option' },
  ],
};

function source(getPage: (params: Record<string, unknown>, call: number) => unknown) {
  let count = 0;
  const rpc: Pick<RpcClient, 'request'> = {
    async request<T>(method: string, params: Record<string, unknown>) {
      assert.equal(method, 'model/list');
      return getPage(params, ++count) as T;
    },
  };
  return { catalog: new ModelCatalog(rpc), calls: () => count };
}

test('lists every page and preserves descriptions, identifiers and effort options', async () => {
  const { catalog } = source(params => params.cursor
    ? { data: [beta], nextCursor: null }
    : { data: [alpha], nextCursor: 'second' });
  const result = await catalog.list();
  assert.deepEqual(result.models, [alpha, beta]);
  assert.equal(result.accessVerified, false);
  assert.ok(!Number.isNaN(Date.parse(result.retrievedAt)));
});

test('list refreshes explicitly and honors includeHidden', async () => {
  const hidden = { ...beta, hidden: true };
  const { catalog, calls } = source(params => ({ data: params.includeHidden ? [alpha, hidden] : [alpha], nextCursor: null }));
  assert.equal((await catalog.list()).models.length, 1);
  assert.equal((await catalog.list(true)).models.length, 2);
  assert.equal(calls(), 2);
  assert.deepEqual(await catalog.select({ model: 'beta' }), { model: 'beta', effort: 'medium' });
});

test('uses advertised defaults instead of hard-coded model or effort names', async () => {
  const { catalog } = source(() => ({ data: [alpha, beta] }));
  assert.deepEqual(await catalog.select({}), { model: 'alpha', effort: 'low' });
  assert.deepEqual(await catalog.select({ model: 'beta', effort: 'new-future-effort' }), { model: 'beta', effort: 'new-future-effort' });
});

test('inherits prior selection but changing model resets omitted effort to its own default', async () => {
  const { catalog } = source(() => ({ data: [alpha, beta] }));
  assert.deepEqual(await catalog.select({}, { model: 'alpha', effort: 'high' }), { model: 'alpha', effort: 'high' });
  assert.deepEqual(await catalog.select({ model: 'beta' }, { model: 'alpha', effort: 'high' }), { model: 'beta', effort: 'medium' });
  assert.deepEqual(await catalog.select({ effort: 'low' }, { model: 'alpha', effort: 'high' }), { model: 'alpha', effort: 'low' });
});

test('rejects unknown model without silently substituting the default', async () => {
  const { catalog, calls } = source(() => ({ data: [alpha, beta] }));
  await assert.rejects(catalog.select({ model: 'missing' }), error => {
    assert.equal((error as { code: string }).code, 'INVALID_MODEL');
    assert.match(String(error), /alpha|models_list/);
    return true;
  });
  assert.equal(calls(), 2);
});

test('rejects effort not supported by the selected model and lists permitted values', async () => {
  const { catalog } = source(() => ({ data: [alpha, beta] }));
  await assert.rejects(catalog.select({ model: 'beta', effort: 'high' }), /medium.*new-future-effort/);
});

test('refreshes once when a previously cached catalog has gained a model', async () => {
  const { catalog, calls } = source((_params, call) => ({ data: call === 1 ? [alpha] : [alpha, beta] }));
  await catalog.list();
  assert.deepEqual(await catalog.select({ model: 'beta' }), { model: 'beta', effort: 'medium' });
  assert.equal(calls(), 2);
});

test('rejects repeated pagination cursors and malformed model metadata', async () => {
  const looping = source(() => ({ data: [alpha], nextCursor: 'loop' }));
  await assert.rejects(looping.catalog.list(), /cursor|pagination/i);
  const malformed = source(() => ({ data: [{ ...alpha, supportedReasoningEfforts: [] }] }));
  await assert.rejects(malformed.catalog.list(), /catalog|model|effort/i);
});

test('requires explicit model when the catalog default is ambiguous', async () => {
  const { catalog } = source(() => ({ data: [alpha, { ...beta, isDefault: true }] }));
  await assert.rejects(catalog.select({}), /explicit|default/i);
});
