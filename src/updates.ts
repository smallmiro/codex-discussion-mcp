import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, win32 } from 'node:path';
import { version } from './version.js';

export const UPDATE_TTL_MS = 24 * 60 * 60 * 1000;
const REGISTRY_URL = 'https://registry.npmjs.org/@mirolab%2Fcodex-discussion-mcp/latest';
const TIMEOUT_MS = 1500;

export interface UpdateInfo {
  currentVersion: string;
  status: 'available' | 'current' | 'unavailable' | 'disabled';
  checkedAt?: string;
  latestVersion?: string;
  releaseNotesUrl?: string;
  notice?: string;
}
interface Metadata { schemaVersion: 1; checkedAt: number; latestVersion: string | null }
interface Options {
  currentVersion?: string;
  enabled?: boolean;
  cacheFile?: string;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  timeoutMs?: number;
}

export function cacheFilePath(platform: string = process.platform, env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  if (platform === 'win32') {
    const base = env.LOCALAPPDATA && win32.isAbsolute(env.LOCALAPPDATA) ? env.LOCALAPPDATA : win32.join(home, 'AppData', 'Local');
    return win32.join(base, 'codex-discussion-mcp', 'update.json');
  }
  const base = platform === 'darwin' ? join(home, 'Library', 'Caches')
    : env.XDG_CACHE_HOME && isAbsolute(env.XDG_CACHE_HOME) ? env.XDG_CACHE_HOME : join(home, '.cache');
  return join(base, 'codex-discussion-mcp', 'update.json');
}

/** Strict SemVer parsing; npm latest must be stable. Build metadata has no precedence. */
function parseVersion(value: unknown) {
  if (typeof value !== 'string' || value.length > 256) return undefined;
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(value);
  if (!match || match[0] !== value) return undefined;
  const prerelease = match[4];
  if (prerelease?.split('.').some(part => /^\d+$/.test(part) && part.length > 1 && part.startsWith('0'))) return undefined;
  return { core: [BigInt(match[1]!), BigInt(match[2]!), BigInt(match[3]!)], prerelease };
}

function stable(value: unknown): value is string {
  const parsed = parseVersion(value);
  return !!parsed && !parsed.prerelease;
}

export class UpdateChecker {
  private readonly currentVersion: string;
  private readonly cacheFile: string;
  private readonly now: () => number;
  private memory?: Metadata;
  private pending?: Promise<UpdateInfo>;
  private controller?: AbortController;
  private closed = false;

  constructor(private readonly options: Options = {}) {
    this.currentVersion = options.currentVersion ?? version;
    this.cacheFile = options.cacheFile ?? cacheFilePath();
    this.now = options.now ?? Date.now;
  }

  check(): Promise<UpdateInfo> {
    if (this.options.enabled === false) return Promise.resolve({ currentVersion: this.currentVersion, status: 'disabled' });
    if (this.closed) return Promise.resolve({ currentVersion: this.currentVersion, status: 'unavailable' });
    if (!this.pending) {
      this.pending = this.load().then(metadata => this.project(metadata)).finally(() => { this.pending = undefined; });
    }
    return this.pending;
  }

  close(): void {
    this.closed = true;
    this.controller?.abort();
  }

  private fresh(metadata: Metadata): boolean {
    const age = this.now() - metadata.checkedAt;
    return age >= 0 && age < UPDATE_TTL_MS;
  }

  private async load(): Promise<Metadata> {
    if (this.memory && this.fresh(this.memory)) return this.memory;
    try {
      if ((await stat(this.cacheFile)).size > 4096) throw new Error('Oversized cache');
      const cached: unknown = JSON.parse(await readFile(this.cacheFile, 'utf8'));
      if (cached && typeof cached === 'object') {
        const data = cached as Partial<Metadata>;
        if (data.schemaVersion === 1 && typeof data.checkedAt === 'number' && Number.isFinite(data.checkedAt)
          && (data.latestVersion === null || stable(data.latestVersion))) {
          const metadata: Metadata = { schemaVersion: 1, checkedAt: data.checkedAt, latestVersion: data.latestVersion };
          if (this.fresh(metadata)) return this.memory = metadata;
        }
      }
    } catch { /* Cache access is best effort. */ }
    const latestVersion = this.closed ? null : await this.lookup();
    const metadata: Metadata = { schemaVersion: 1, checkedAt: this.now(), latestVersion };
    this.memory = metadata;
    if (!this.closed) await this.persist(metadata);
    return metadata;
  }

  private async lookup(): Promise<string | null> {
    const controller = new AbortController();
    this.controller = controller;
    const aborted = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener('abort', () => reject(new Error('Update check stopped')), { once: true });
    });
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? TIMEOUT_MS);
    try {
      return await Promise.race([this.fetchVersion(controller.signal), aborted]);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      this.controller = undefined;
    }
  }

  private async fetchVersion(signal: AbortSignal): Promise<string | null> {
    const response = await (this.options.fetch ?? globalThis.fetch)(REGISTRY_URL, {
      signal, redirect: 'error', headers: { accept: 'application/json' },
    });
    if (!response.ok || !response.body) { await response.body?.cancel(); return null; }
    const reader = response.body.getReader();
    const cancel = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 16_384) { await reader.cancel(); return null; }
        chunks.push(value);
      }
      const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const latest = data && typeof data === 'object' ? (data as { version?: unknown }).version : undefined;
      return stable(latest) ? latest : null;
    } finally {
      signal.removeEventListener('abort', cancel);
      reader.releaseLock();
    }
  }

  private async persist(metadata: Metadata): Promise<void> {
    const temporary = `${this.cacheFile}.${randomUUID()}.tmp`;
    try {
      await mkdir(dirname(this.cacheFile), { recursive: true, mode: 0o700 });
      await writeFile(temporary, JSON.stringify(metadata), { mode: 0o600, flag: 'wx' });
      await rename(temporary, this.cacheFile);
    } catch { /* Never turn a cache failure into a tool failure. */ }
    finally { await rm(temporary, { force: true }).catch(() => {}); }
  }

  private project(metadata: Metadata): UpdateInfo {
    const result: UpdateInfo = { currentVersion: this.currentVersion, status: 'unavailable', checkedAt: new Date(metadata.checkedAt).toISOString() };
    const current = parseVersion(this.currentVersion);
    const latest = parseVersion(metadata.latestVersion);
    if (!current || !latest) return result;
    result.latestVersion = metadata.latestVersion!;
    const difference = latest.core.map((part, index) => part > current.core[index]! ? 1 : part < current.core[index]! ? -1 : 0).find(value => value !== 0) ?? 0;
    result.status = difference > 0 || (difference === 0 && !!current.prerelease) ? 'available' : 'current';
    if (result.status === 'available') {
      result.releaseNotesUrl = `https://github.com/smallmiro/codex-discussion-mcp/releases/tag/v${result.latestVersion}`;
      result.notice = `A newer Codex Discussion MCP version is available: ${result.currentVersion} → ${result.latestVersion}. Update your installation, then reconnect the MCP server. For a global npm installation: npm install -g @mirolab/codex-discussion-mcp@latest. For a project-local installation: run npm install @mirolab/codex-discussion-mcp@latest in that installation's project. For version-pinned npx: update the configured package version. Refresh separately copied skills after reviewing your customizations. Release notes: ${result.releaseNotesUrl}`;
    }
    return result;
  }
}
