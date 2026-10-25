#!/usr/bin/env node
import { stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { AppServer } from './app-server.js';
import { DiscussionService } from './discussions.js';
import { ModelCatalog } from './models.js';
import { createServer } from './server.js';
import { version } from './version.js';

async function main() {
  const { values } = parseArgs({
    options: {
      help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' },
      cwd: { type: 'string' }, 'codex-command': { type: 'string' },
      'codex-arg': { type: 'string', multiple: true },
    },
    strict: true, allowPositionals: false,
  });
  if (values.help) {
    process.stdout.write(`codex-discussion-mcp ${version}\n\nUsage: codex-discussion-mcp [options]\n\n  --cwd <absolute-path>  Default project directory\n  --codex-command <path> Codex executable (default: CODEX_DISCUSSION_CODEX_PATH or codex)\n  --codex-arg <value>    Override app-server arguments; repeat for each argument\n  --help, -h            Show this help\n  --version, -v         Show version\n\nUses stdio MCP. Requires Node >=22.14 and a logged-in Codex CLI.\nFirst call models_list, then discussion_start/reply and discussion_read.\n`);
    return;
  }
  if (values.version) { process.stdout.write(`${version}\n`); return; }
  const cwd = values.cwd ?? process.cwd();
  if (!isAbsolute(cwd) || !(await stat(cwd)).isDirectory()) throw new Error('--cwd must be an existing absolute directory.');
  const rpc = new AppServer({
    command: values['codex-command'] ?? process.env.CODEX_DISCUSSION_CODEX_PATH ?? 'codex',
    args: values['codex-arg'], cwd: resolve(cwd),
  });
  const catalog = new ModelCatalog(rpc);
  const service = new DiscussionService(rpc, catalog, { cwd: resolve(cwd) });
  const handle = serveStdio(() => createServer(service, catalog), {
    onerror: error => { process.stderr.write(`MCP protocol error: ${error.message}\n`); },
  });
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await service.close();
    await handle.close();
    process.exit(0);
  };
  process.once('SIGINT', () => { void shutdown(); });
  process.once('SIGTERM', () => { void shutdown(); });
  process.stdin.once('end', () => { void shutdown(); });
  process.stdin.once('close', () => { void shutdown(); });
}

main().catch(error => {
  process.stderr.write(`codex-discussion-mcp: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
