# Agent Guide

## Project

`@mirolab/codex-discussion-mcp` is a local stdio MCP server that lets coding
agents discuss questions with Codex through `codex app-server`. The calling
agent controls the discussion and chooses a model and reasoning effort.

- Runtime: Node.js **22.14 or newer**, TypeScript, ESM.
- MCP: official TypeScript SDK v2, including compatibility with legacy hosts.
- Validation: Zod 4.
- Tests: `node:test` executed through `tsx`.
- Package executable: `codex-discussion-mcp`, built as `dist/index.js`.
- License: MIT.

## Repository Map

| Path | Responsibility |
|---|---|
| `src/app-server.ts` | Lazy child process, JSONL framing, RPC correlation, deadlines, interactive-request rejection, shutdown |
| `src/models.ts` | Paginated model discovery, catalog cache, model/effort validation and defaults |
| `src/discussions.ts` | Start, reply, read, cancel, resume, submission guards, event reconciliation and backend freshness |
| `src/messages.ts` | Public item projection, text chunking and scoped pagination cursors |
| `src/protocol.ts` | Narrow wire interfaces and public result types |
| `src/errors.ts` | Structured application errors |
| `src/server.ts` | MCP tool schemas, descriptions and structured results |
| `src/index.ts` | CLI options and process lifecycle |
| `src/version.ts` | Package version lookup shared by the CLI and app-server client |
| `tests/fixtures/app-server.mjs` | Deterministic process-boundary simulation of Codex, including error and ordering cases |
| `scripts/verify-package.mjs` | Installation and MCP verification of a packed release artifact |
| `scripts/smoke.mjs` | Optional verification against a locally authenticated Codex CLI |
| `skills/codex-discussion/` | Portable user guide skill with standalone setup and tool references |
| `.github/workflows/` | CI, token-based initial publication and release-based OIDC publication |
| `docs/publishing.md` | npm publishing and trusted-publisher setup |
| `docs/skills.md` | Human-readable skill installation, invocation, maintenance and troubleshooting manual |
| `docs/verification.md` | Recorded validation results and known limits |
| `docs/releases/` | Historical release records and artifact identities |
| `docs/superpowers/` | Original design and completed implementation plan |

Read the relevant source and tests before changing behavior. Historical plans
record earlier decisions; current source, package scripts and release records
establish the implemented state.

## Development Commands

```bash
npm ci
npm run typecheck
npm test
npm run build
```

`npm run check` runs type checking, the full test suite and the build.

After building, verify the npm artifact independently of the source checkout:

```bash
npm run verify:package
npm pack --dry-run
```

To verify a specific tarball:

```bash
npm run verify:package -- --tarball /absolute/path/to/package.tgz
```

Live checks require an installed, authenticated Codex CLI:

```bash
npm run smoke -- --models-only
npm run smoke -- --inference
```

The model-only check does not run inference. The inference check consumes real
account usage, switches models during a short discussion and verifies persisted
history after reconnecting. Use it for changes that need live protocol evidence;
documentation-only edits do not need it.

## Behavioral Contracts

- Discover models and supported efforts dynamically. Treat effort values as
  strings and validate them against the selected model's catalog entry. Never
  silently substitute another model.
- Preserve selection inheritance. Changing the model without specifying effort
  selects the new model's default effort.
- `models_list` exposes catalog metadata, not proof of account entitlement. Keep
  `accessVerified: false` unless an explicit access-verification feature is added.
- Keep discussion execution read-only. Reuse Codex's existing authentication and
  provider configuration without reading credential files. Disable inherited MCP
  connections, apps and plugins in the discussion child.
- Reserve stdout for MCP protocol messages during server operation. Write
  diagnostics to stderr. `--help` and `--version` may write their requested output
  to stdout.
- Register event handlers before submitting turns. A completion event can arrive
  before the `turn/start` RPC response; never overwrite it with `inProgress`.
- Enforce one active or pending submission per discussion. Different discussions
  may run independently. Check backend activity before connected reads and replies.
- Distinguish `completed`, `failed`, `interrupted` and `connectionLost`. An accepted
  start or cancellation request is not a final outcome.
- Do not replay inference automatically after a timeout or connection loss.
- Expose public messages and progress only. Never expose reasoning items or raw
  authentication/configuration contents.
- Preserve pagination limits: `waitMs` is 0–20000, `limit` is 1–100, text chunks
  contain at most 8000 characters and a response contains at most 64000 characters.
- Cursors belong to one MCP process, discussion and turn. During generation,
  callers read without a cursor to obtain updated partial text.
- Keep received local output readable after disconnect. For new live threads
  whose paginated history is unavailable, preserve the supported inline-history
  fallback rather than treating missing history support as successful completion.
- Close pending RPCs, polls and the owned Codex process on shutdown.

## Testing and Documentation

For behavior changes, add a regression test that exercises the affected boundary,
then run `npm run check`. Use the process fixture to test RPC payloads, races,
failures and lifecycle behavior without paid inference. Keep fixtures aligned
with the real app-server protocol; fixture success alone does not establish live
protocol compatibility.

For packaging or dependency changes, also run `npm run verify:package`. For workflow
changes, use `actionlint` when available and inspect the GitHub Actions result.
Check the artifacts and commands that actually changed; avoid unrelated rewrites.

Write documentation, new comments, static tool descriptions and errors in English.
Retain multilingual test strings when they exercise Unicode or language behavior.
For documentation edits, preserve technical identifiers, version history, release
hashes, URLs and command semantics. Check Markdown links and JSON examples, and run
`git diff --check`. Do not invent verification results or require live inference
for prose-only changes.

## Packaging and Release

- Keep the npm scope `@mirolab`, the public package name and the executable name
  consistent across package metadata, workflows and installation examples.
- `package.json` uses a `files` allowlist. Ship compiled output and intended user
  documentation; keep source checkouts, tests, local artifacts and credentials out
  of the published tarball. Do not edit generated `dist/` files directly.
- Use explicit local paths such as `./artifacts/package.tgz` with `npm publish`.
  A path without `./` can be interpreted as a GitHub shorthand.
- `.github/workflows/ci.yml` checks Node.js 22 and 24 and uploads `npm-package`.
- `bootstrap-publish.yml` is a manual token-based path using the repository Secret
  `NPM_TOKEN`. Keep the token out of source files, logs, artifacts and chat.
- `publish.yml` publishes releases through npm OIDC. Its trusted-publisher binding
  uses GitHub owner `smallmiro`, repository `codex-discussion-mcp` and workflow
  filename `publish.yml`; the npm organization is `mirolab`.
- Publishing must be part of the requested task. A documentation edit alone does
  not require a version bump or npm publication. Published versions are immutable;
  never try to overwrite `0.1.0` or another existing version.
- Follow `docs/publishing.md` for account setup and release procedures. Verify the
  published version, artifact integrity and a fresh installation before reporting
  a release as complete.
