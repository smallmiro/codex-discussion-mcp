import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { UpdateChecker, cacheFilePath, UPDATE_TTL_MS } from '../src/updates.js';

async function setup(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'discussion-updates-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, 'updates.json');
}
const response = (version: unknown) => new Response(JSON.stringify({ version }));

test('stable latest uses semantic precedence and rejects invalid version information', async t => {
  for (const [currentVersion, latest, expected] of [
    ['0.1.2', '0.1.10', 'available'], ['1.9.9', '1.10.0', 'available'],
    ['2.0.0-rc.1', '2.0.0', 'available'], ['1.2.3+old', '1.2.3+new', 'current'],
    ['1.2.3', '1.2.3', 'current'], ['2.0.0', '1.99.99', 'current'],
    ['1.2.3', '1.3.0-beta.1', 'unavailable'], ['1.2.3', '01.3.0', 'unavailable'],
    ['1.2.3', 'v1.3.0', 'unavailable'], ['1.2.3', '2.0', 'unavailable'],
    ['1.2.3', null, 'unavailable'], ['invalid', '2.0.0', 'unavailable'],
    ['1.2.3-01', '1.2.3', 'unavailable'], ['1.2.3', '2.0.0\n', 'unavailable'],
  ] as const) {
    const checker = new UpdateChecker({ currentVersion, cacheFile: await setup(t), fetch: async () => response(latest) });
    const result = await checker.check();
    assert.equal(result.status, expected, `${currentVersion} -> ${latest}`);
    assert.equal(result.currentVersion, currentVersion);
    if (expected === 'available') {
      assert.equal(result.latestVersion, latest);
      assert.equal(result.releaseNotesUrl, `https://github.com/smallmiro/codex-discussion-mcp/releases/tag/v${latest}`);
      assert.match(result.notice!, /reconnect/);
      assert.match(result.notice!, /global npm installation/);
    } else assert.equal(result.notice, undefined);
  }
});

test('checks coalesce and the 24-hour metadata cache survives checker restarts and version changes', async t => {
  const cacheFile = await setup(t);
  let now = 1_000_000;
  let calls = 0;
  const fetch = async () => { calls++; return response('1.2.4'); };
  const options = { currentVersion: '1.2.3', cacheFile, fetch, now: () => now };
  const checker = new UpdateChecker(options);
  const results = await Promise.all(Array.from({ length: 20 }, () => checker.check()));
  assert.ok(results.every(result => result.status === 'available'));
  assert.equal(calls, 1);
  assert.equal((await new UpdateChecker({ ...options, currentVersion: '1.2.4' }).check()).status, 'current');
  now += UPDATE_TTL_MS - 1;
  await checker.check();
  assert.equal(calls, 1);
  now++;
  await checker.check();
  assert.equal(calls, 2);
  assert.deepEqual(Object.keys(JSON.parse(await readFile(cacheFile, 'utf8'))).sort(), ['checkedAt', 'latestVersion', 'schemaVersion']);
});

test('offline failures are cached across restarts without claiming the package is current', async t => {
  const cacheFile = await setup(t);
  let calls = 0;
  const options = { currentVersion: '1.2.3', cacheFile, fetch: async () => { calls++; throw new Error('offline'); } };
  assert.equal((await new UpdateChecker(options).check()).status, 'unavailable');
  assert.equal((await new UpdateChecker(options).check()).status, 'unavailable');
  assert.equal(calls, 1);
});

test('malformed, HTTP error and oversized responses never produce a notice', async t => {
  for (const fetch of [
    async () => new Response('not json'),
    async () => new Response('{"version":"9.0.0"}', { status: 503 }),
    async () => new Response(' '.repeat(20_000) + '{"version":"9.0.0"}'),
    async () => new Response('{"version":"9.0.0"}', { status: 302, headers: { location: 'https://example.com' } }),
  ]) {
    assert.equal((await new UpdateChecker({ currentVersion: '1.2.3', cacheFile: await setup(t), fetch }).check()).status, 'unavailable');
  }
});

test('invalid, stale and future cache metadata triggers a fresh check', async t => {
  const cacheFile = await setup(t);
  const now = UPDATE_TTL_MS * 3;
  for (const content of [
    'bad json', JSON.stringify({ schemaVersion: 1, checkedAt: now + 1, latestVersion: '9.0.0' }),
    JSON.stringify({ schemaVersion: 1, checkedAt: now - UPDATE_TTL_MS, latestVersion: '9.0.0' }),
    JSON.stringify({ schemaVersion: 1, checkedAt: now, latestVersion: 'broken' }),
    JSON.stringify({ schemaVersion: 99, checkedAt: now, latestVersion: '9.0.0' }),
  ]) {
    await writeFile(cacheFile, content);
    let calls = 0;
    const result = await new UpdateChecker({ currentVersion: '1.2.3', cacheFile, now: () => now, fetch: async () => { calls++; return response('1.2.3'); } }).check();
    assert.equal(result.status, 'current');
    assert.equal(calls, 1);
  }
});

test('cache read/write failures retain in-memory throttling and usable results', async t => {
  const cacheFile = join(await setup(t), 'impossible.json');
  let calls = 0;
  const checker = new UpdateChecker({ currentVersion: '1.2.3', cacheFile, fetch: async () => { calls++; return response('1.2.4'); } });
  await writeFile(cacheFile.slice(0, -'/impossible.json'.length), 'not a directory');
  assert.equal((await checker.check()).status, 'available');
  assert.equal((await checker.check()).status, 'available');
  assert.equal(calls, 1);
});

test('disabled checks do not fetch or read a cached update', async t => {
  const cacheFile = await setup(t);
  await writeFile(cacheFile, JSON.stringify({ schemaVersion: 1, checkedAt: Date.now(), latestVersion: '9.0.0' }));
  const checker = new UpdateChecker({ currentVersion: '1.2.3', cacheFile, enabled: false, fetch: async () => { assert.fail('network'); } });
  assert.deepEqual(await checker.check(), { currentVersion: '1.2.3', status: 'disabled' });
});

test('deadline covers headers and stalled bodies; close aborts pending requests', async t => {
  for (const mode of ['headers', 'body', 'close'] as const) {
    let signal: AbortSignal | undefined;
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const checker = new UpdateChecker({
      currentVersion: '1.2.3', cacheFile: await setup(t), timeoutMs: 30,
      fetch: async (_url, init) => {
        signal = init?.signal ?? undefined;
        started();
        if (mode === 'body') return new Response(new ReadableStream({ start() {} }));
        return new Promise<Response>(() => {});
      },
    });
    const pending = checker.check();
    await ready;
    if (mode === 'close') checker.close();
    assert.equal((await pending).status, 'unavailable');
    assert.equal(signal?.aborted, true);
  }
});

test('cache paths use absolute user OS locations and ignore relative XDG paths', () => {
  assert.equal(cacheFilePath('linux', { XDG_CACHE_HOME: '/cache' }, '/home/test'), '/cache/codex-discussion-mcp/update.json');
  assert.equal(cacheFilePath('linux', { XDG_CACHE_HOME: './project' }, '/home/test'), '/home/test/.cache/codex-discussion-mcp/update.json');
  assert.equal(cacheFilePath('darwin', {}, '/Users/test'), '/Users/test/Library/Caches/codex-discussion-mcp/update.json');
  assert.equal(cacheFilePath('win32', { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local' }, 'C:\\Users\\test'), 'C:\\Users\\test\\AppData\\Local\\codex-discussion-mcp\\update.json');
});
