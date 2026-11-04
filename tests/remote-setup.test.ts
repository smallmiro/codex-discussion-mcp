import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/setup-remote-app-server.sh', import.meta.url));
const unix = { skip: process.platform === 'win32' };

async function setup(t: TestContext, supported = true) {
  const dir = await mkdtemp(join(tmpdir(), 'codex remote setup '));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const executable = join(dir, 'fake codex');
  const received = join(dir, 'arguments');
  const tokenFile = join(dir, 'token');
  // Replace only the external Codex process; token generation and filesystem writes stay real.
  await writeFile(executable, `#!/usr/bin/env bash
if [[ "$*" == 'app-server --help' ]]; then
  printf '%s\\n' '${supported ? '--listen --ws-auth --ws-token-file' : '--listen'}'
  exit 0
fi
printf '%s\\n' "$@" > "$TEST_REMOTE_CODEX_ARGS"
`, { mode: 0o700 });
  const run = (args: string[] = []) => spawnSync('bash', [script, '--codex-command', executable, '--token-file', tokenFile, ...args], {
    encoding: 'utf8', timeout: 5000, env: { ...process.env, TEST_REMOTE_CODEX_ARGS: received },
  });
  return { dir, executable, received, tokenFile, run };
}

test('remote setup creates a private token and passes authentication by file without leaking the secret', unix, async t => {
  const { run, tokenFile, received } = await setup(t);
  const result = run(['--host', '192.168.20.45', '--port', '4500']);
  assert.equal(result.status, 0, result.stderr);
  const token = await readFile(tokenFile, 'utf8');
  assert.ok(/^[a-f0-9]{64}\n$/.test(token), 'expected a 256-bit hexadecimal token');
  assert.equal((await stat(tokenFile)).mode & 0o777, 0o600);
  const args = (await readFile(received, 'utf8')).trim().split('\n');
  assert.deepEqual(args, [
    'app-server', '--listen', 'ws://192.168.20.45:4500',
    '--ws-auth', 'capability-token', '--ws-token-file', tokenFile,
    '-c', 'features.plugins=false', '-c', 'features.apps=false',
  ]);
  assert.ok(!`${result.stdout}${result.stderr}${args.join(' ')}`.includes(token.trim()), 'token must not appear in diagnostics or process arguments');
});

test('remote setup preserves an existing token across repeated runs and restricts its permissions', unix, async t => {
  const { run, tokenFile } = await setup(t);
  const saved = 'existing-transport-token-that-must-not-be-replaced\n';
  await writeFile(tokenFile, saved);
  await chmod(tokenFile, 0o644);
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(tokenFile, 'utf8'), saved);
    assert.equal((await stat(tokenFile)).mode & 0o777, 0o600);
  }
});

test('remote setup refuses symbolic-link and empty token files without replacing them', unix, async t => {
  const { dir, run, tokenFile, received } = await setup(t);
  const target = join(dir, 'untouched');
  await writeFile(target, 'unrelated contents', { mode: 0o644 });
  await symlink(target, tokenFile);
  assert.equal(run().status, 1);
  assert.equal(await readFile(target, 'utf8'), 'unrelated contents');
  assert.equal((await stat(target)).mode & 0o777, 0o644);
  await rm(tokenFile);
  await writeFile(tokenFile, '');
  assert.equal(run().status, 1);
  assert.equal(await readFile(tokenFile, 'utf8'), '');
  await assert.rejects(stat(received), { code: 'ENOENT' });
});

test('remote setup rejects unsupported Codex versions before creating a token', unix, async t => {
  const { run, tokenFile, received } = await setup(t, false);
  const result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /WebSocket authentication/i);
  await assert.rejects(stat(tokenFile), { code: 'ENOENT' });
  await assert.rejects(stat(received), { code: 'ENOENT' });
});

test('remote setup validates endpoints and required arguments before creating a token', unix, async t => {
  const { run, tokenFile } = await setup(t);
  for (const args of [
    ['--host', '192.168.20.999'], ['--host', 'ws://192.168.20.45'],
    ['--port', '0'], ['--port', '65536'], ['--port', 'abc'],
    ['--host'], ['--token-file', 'relative/token'], ['--unknown'],
  ]) {
    const result = run(args);
    assert.equal(result.status, 1, `invalid arguments did not produce a validation failure: ${args.join(' ')}`);
  }
  await assert.rejects(stat(tokenFile), { code: 'ENOENT' });
});

test('remote setup help does not require Codex or create a token', unix, async t => {
  const { tokenFile } = await setup(t);
  const result = spawnSync('bash', [script, '--help', '--codex-command', '/nonexistent/codex', '--token-file', tokenFile], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--host/);
  await assert.rejects(stat(tokenFile), { code: 'ENOENT' });
});
