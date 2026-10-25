import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const run = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));
const temp = await mkdtemp(join(tmpdir(), 'codex-discussion-package-'));
const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
let client;
try {
  const supplied = process.argv.indexOf('--tarball');
  let tarball;
  if (supplied !== -1) {
    assert.ok(process.argv[supplied + 1], '--tarball requires a file');
    tarball = resolve(process.argv[supplied + 1]);
  } else {
    const packed = await run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temp], { cwd: root });
    const [info] = JSON.parse(packed.stdout);
    const paths = info.files.map(file => file.path);
    assert.ok(paths.includes('dist/index.js'));
    assert.ok(paths.includes('LICENSE'));
    assert.ok(!paths.some(path => /^(src|tests|node_modules|\.github|\.superpowers|\.env)(\/|$)/.test(path)));
    tarball = join(temp, info.filename);
  }
  await run('npm', ['install', '--prefix', temp, '--omit=dev', '--ignore-scripts', '--no-package-lock', '--no-audit', '--no-fund', tarball], { timeout: 120_000 });
  const executable = join(temp, 'node_modules', '.bin', 'codex-discussion-mcp');
  const installed = JSON.parse(await readFile(join(temp, 'node_modules', '@mirolab', 'codex-discussion-mcp', 'package.json'), 'utf8'));
  assert.equal(installed.name, metadata.name);
  assert.equal(installed.version, metadata.version);
  const help = await run(executable, ['--help'], { cwd: temp });
  assert.match(help.stdout, /codex-discussion-mcp/);
  const version = await run(executable, ['--version'], { cwd: temp });
  assert.equal(version.stdout.trim(), metadata.version);
  const fixture = join(temp, 'fixture.mjs');
  await copyFile(join(root, 'tests', 'fixtures', 'app-server.mjs'), fixture);
  client = new Client({ name: 'packed-install-verification', version: '1.0.0' }, { capabilities: {} });
  const transport = new StdioClientTransport({ command: executable, args: ['--cwd', temp, '--codex-command', process.execPath, '--codex-arg', fixture], cwd: temp, stderr: 'pipe' });
  await client.connect(transport);
  assert.equal((await client.listTools()).tools.length, 5);
  const call = async (name, args) => {
    const result = await client.callTool({ name, arguments: args });
    assert.notEqual(result.isError, true, JSON.stringify(result));
    return result.structuredContent;
  };
  assert.equal((await call('models_list', {})).models.length, 2);
  const first = await call('discussion_start', { message: 'early packed question', model: 'alpha', effort: 'high' });
  const read = await call('discussion_read', { discussionId: first.discussionId });
  assert.equal(read.status, 'completed');
  assert.ok(read.messages.some(message => message.role === 'assistant' && message.text === 'Codex answer'));
  const reply = await call('discussion_reply', { discussionId: first.discussionId, message: 'early packed objection', model: 'beta' });
  assert.equal(reply.effort, 'medium');
  console.log(`Packed installation verified: ${installed.name}@${installed.version}; executable, MCP discovery, model selection and two-turn discussion.`);
} finally {
  await client?.close();
  await rm(temp, { recursive: true, force: true });
}
