# Codex Discussion MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Implement an npm-installable MCP server that lets external coding agents select a model and effort level for ongoing discussions with Codex.

**Architecture:** The stdio MCP server owns a dedicated Codex app-server child process. Separate the JSONL RPC client, model catalog, discussion service, and MCP registration. Persist history in Codex and keep public messages in memory while the server runs.

**Tech Stack:** Node.js >=22.14, TypeScript, MCP SDK v2 with legacy host support, Zod 4, node:test + tsx, npm, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-25-codex-discussion-mcp-design.md`

## Global Constraints

- npm package `@mirolab/codex-discussion-mcp`, public, MIT; binary `codex-discussion-mcp`.
- Codex CLI login/provider configuration is reused; no credential-file reads or stored npm tokens.
- Read-only Codex discussion; inherited MCP connections disabled to prevent recursion.
- Dynamic model and effort discovery; validate every selection; never substitute models silently.
- New turns return immediately; read long poll <=20 seconds; statuses preserve failed/interrupted/connectionLost.
- `discussionId` is the Codex thread ID. A thread permits one active submission; distinct threads may run concurrently.
- Public messages only; no reasoning output; bounded pagination and bounded per-response text.
- User explicitly requested planning AND execution: proceed inline without another plan approval pause.
- npm publication is not part of this execution; prepare/test artifacts and OIDC workflow. Existing authorization covers GitHub pushes.

## Review Focus

- A turn completes before its RPC response: final status and text must survive.
- A model changes while effort is omitted: use the new model default, never an incompatible inherited effort.
- Client resumes persisted history: recover selection, enforce read-only policy, filter private reasoning.
- Transport fails or a state-mutating RPC times out: report uncertainty and never replay inference automatically.
- Packaged CLI runs outside the source checkout with legacy MCP hosts: no dev dependency, path or stdout assumptions.

## File Map

- `src/errors.ts`, `src/protocol.ts`: errors, narrow wire types, public result types.
- `src/app-server.ts`: spawn, JSONL, RPC correlation, deadlines, deny server requests, close.
- `src/models.ts`: complete paginated catalog, cache, dynamic selection/default validation.
- `src/discussions.ts`: create/resume/reply/read/cancel, locking, event reconciliation, cursors.
- `src/server.ts`, `src/index.ts`: MCP tool schemas, structured results, CLI lifecycle/options.
- `tests/fixtures/app-server.mjs`: deterministic external Codex protocol simulator, including adverse ordering.
- `tests/*.test.ts`: protocol, model, discussion, stdio MCP and packaging behavior.
- `scripts/verify-package.mjs`, `scripts/smoke.mjs`: standalone packed installation and optional live smoke.
- `.github/workflows/ci.yml`, `.github/workflows/publish.yml`: test/build/artifacts and release-driven OIDC publish.
- `README.md`, `docs/publishing.md`: install, host registration, tool examples, bootstrap and trusted publisher setup.

### Task 1: App-server transport

**Files:** package/TS configuration; `src/errors.ts`, `src/protocol.ts`, `src/app-server.ts`; fixture and `tests/app-server.test.ts`.
**Interfaces:** `AppServer.request<T>(method, params): Promise<T>`; `onNotification(listener)`, `onDisconnect(listener)`, `close()`; injected executable/args for process-boundary tests.

- [x] Write failing process-level tests: initialization must precede methods; split UTF-8/JSONL frames and out-of-order RPC responses correlate; child exit rejects pending requests; known approval/user-input requests get explicit denials; invalid JSON/oversized frame/timeout closes connection.
- [x] Run `npm test -- tests/app-server.test.ts`; confirm failing assertions for unimplemented transport.
- [x] Implement transport with listeners attached before spawn output, finite RPC timeout, idempotent shutdown and no shell interpolation. Retain existing login/provider configuration; discover configured MCP keys and disable them in per-thread overrides.
- [x] Run transport tests and `npm run typecheck`; expect success. Commit task.

### Task 2: Dynamic models

**Files:** `src/models.ts`, `tests/models.test.ts`.
**Interfaces:** `ModelCatalog.list(includeHidden?): Promise<CatalogResult>`; `select({model?, effort?}, previous?): Promise<Selection>` where Selection is `{model: string, effort: string}`.

- [x] Write failing tests for all pages, hidden filtering, default choice, effort descriptions, selection inheritance, model-change default, invalid model/effort, one refresh on stale catalog, repeated cursor rejection.
- [x] Run `npm test -- tests/models.test.ts`; confirm missing behavior failures.
- [x] Implement catalog cache and model selection with string-valued efforts, exact model identifiers, explicit errors with allowed choices, no inference on list.
- [x] Run model and transport tests and typecheck; expect success. Commit task.

### Task 3: Discussion lifecycle

**Files:** `src/discussions.ts`, `tests/discussions.test.ts`.
**Interfaces:** `DiscussionService.start(input)`, `reply(input)`, `read(input, signal?)`, `cancel(input)`, `close()` return typed public results.

- [x] Write failing tests for model/effort propagation; immediate completion before RPC reply; same-thread submission locking; independent threads; final/delta reconciliation; bounded pagination; early-waking long poll; busy/invalid turn errors; failed/interrupted/disconnected states; targeted cancellation; persisted resume and history filtering.
- [x] Run discussion tests; confirm unimplemented behavior failures.
- [x] Implement read-only start/resume overrides, persisted thread model/effort recovery, active turn guards, event mapping by thread+turn, public message projection and context-bound cursors. Preserve uncertain submissions as busy until connection reset.
- [x] Run full tests and typecheck; expect success. Commit task.

### Task 4: MCP tools and executable

**Files:** `src/server.ts`, `src/index.ts`, `tests/mcp.test.ts`.
**Interfaces:** SDK v2 `McpServer` factory plus `serveStdio`; CLI bin, `--help`, `--version`, `--codex-command`, `--codex-arg` (repeatable), `--cwd`; env `CODEX_DISCUSSION_CODEX_PATH` optional.

- [x] Write failing subprocess MCP tests: list exactly five tools; valid/invalid models and effort calls; start/read/reply/cancel; structured errors; legacy `2025-03-26` initialization; clean stdout and child shutdown on stdin close/SIGTERM.
- [x] Run MCP tests; confirm missing executable/behavior failures.
- [x] Implement schemas with dynamic strings and numeric/message limits; describe models_list-first flow and read polling; MCP tool errors return isError with structured detail; lazily start Codex so discovery/help need no Codex login.
- [x] Run full tests, typecheck and build; expect success. Commit task.

### Task 5: npm artifact, GitHub Actions and documentation

**Files:** package metadata; verification/smoke scripts; workflows; README and publishing documentation.
**Interfaces:** `npm run check` (typecheck/test/build), `npm run verify:package`, `npm run smoke -- --models-only` and opt-in `--inference`.

- [x] Write packed-install verification that executes the installed bin's help/version and performs MCP discovery + fixture-backed start/read/reply from a clean temporary prefix.
- [x] Run package verification before implementation; confirm failure from missing build/package behavior.
- [x] Implement bin/shebang/pack allowlist, reproducible lockfile, CI on Node 22+24 with packed artifact upload, publish.yml on release publication/manual dispatch using GitHub-hosted runner, id-token write, exact tag/version match, no secret npm token.
- [x] Document installation/registration in all three hosts, cwd selection, CLI auth, limitations and first GitHub-built artifact manual publish followed by OIDC setup.
- [x] Run `npm run check`, `npm run verify:package`, `npm pack --dry-run`, live catalog smoke and a short live inference conversation when account access permits. Record exact results. Commit task.

## Finish

- [x] Run independent whole-branch review per executing-plans; fix important findings with failing regression tests.
- [x] Re-run required validation; fast-forward main to reviewed implementation, push to origin, inspect CI and address failures.
- [x] Record working features, test evidence, npm publish readiness and remaining account setup in README, docs/publishing.md and docs/verification.md.
