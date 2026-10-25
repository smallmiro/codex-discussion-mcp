import { fileURLToPath } from 'node:url';
import type { TestContext } from 'node:test';
import { AppServer } from '../src/app-server.js';
import { ModelCatalog } from '../src/models.js';
import { DiscussionService } from '../src/discussions.js';

export const fixture = fileURLToPath(new URL('./fixtures/app-server.mjs', import.meta.url));
export function discussionClient(t: TestContext, args: string[] = []) {
  const rpc = new AppServer({ command: process.execPath, args: [fixture, ...args], rpcTimeoutMs: 2000 });
  const catalog = new ModelCatalog(rpc);
  const service = new DiscussionService(rpc, catalog, { cwd: process.cwd() });
  t.after(() => service.close());
  return { rpc, service };
}
