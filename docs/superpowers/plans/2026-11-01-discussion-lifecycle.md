# Discussion Lifecycle Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Let callers explicitly release inactive retained discussion state without deleting saved history or losing active work.

**Architecture:** Add an idempotent `discussion_forget({ discussionId })` tool that removes local state only. Track operations and a release claim per discussion. Check backend activity while connected; refuse active, pending, loading, or uncertain connection-lost turns. Own cursor instances inside discussion state so release invalidates old cursors without accumulating tombstones. Later cursorless reads may resume saved history without inference.

**Tech Stack:** Node.js >=22.14.0, TypeScript ESM, official MCP SDK v2, Zod 4, node:test through tsx.

**Spec:** [Issue #20](https://github.com/smallmiro/codex-discussion-mcp/issues/20).

## Global Constraints

- Retain received output, including #17 historical pages, until explicit release or process exit.
- Never delete persisted history, cancel inference implicitly, or replay inference.
- Protect active turns, pending submissions, loads, reads, cancellations and polls.
- Keep stdout protocol-only, preserve legacy hosts and read-only Codex configuration.
- Keep existing model/effort semantics, cursor scopes and pagination limits.
- No version bump or publication is part of this work.

## Ownership and policy

- `DiscussionService.discussions` owns retained discussion states; `loading` owns pending resumes.
- Each discussion owns its turns, cursor instance and in-flight operation count.
- Each turn owns public live messages, received history pages and poll waiters.
- Unknown local IDs return `forgotten: false` without backend loading or retained tombstones.
- Known inactive IDs return `forgotten: true` after release; repeated calls return false.
- Connected release checks backend inactivity, then rechecks local activity before deleting state.
- Connection-lost turns have an unknown backend outcome and cannot be forgotten; completed/failed/interrupted turns remain releasable after disconnect.
- Unreleased cursors keep working. A released discussion's old cursors fail with `INVALID_CURSOR`, including after saved-history resume.

## Review Focus

- Reads awaiting backend refresh and cancellations awaiting RPC must block release.
- A release awaiting backend freshness must block competing operations and release attempts.
- Delayed resume loads and turn-start responses cannot leave detached active state.
- External backend activity and unknown disconnect outcomes must not be evicted.
- Repeated release/resume cycles must invalidate old cursors without growing a tombstone map.

### Task 1: Implement explicit local release

**Files:** `src/discussions.ts`, `src/server.ts`, `tests/discussions.test.ts`, `tests/mcp.test.ts`, `tests/fixtures/app-server.mjs`, `scripts/verify-package.mjs`, `README.md`, `skills/codex-discussion/references/tools.md`, `docs/skills.md`, `docs/verification.md`.

**Interfaces:** `DiscussionService.forget({ discussionId: string }): Promise<{ discussionId: string; forgotten: boolean }>`; MCP `discussion_forget` with a strict ID schema. Cursor formats remain opaque. No backend deletion API is called.

- [ ] Record state ownership and policy in this plan as the preparation commit; avoid an artificial cache framework.
- [ ] Add failing process-boundary regressions for release/repeat, saved-history recovery, stale cursors, disconnected completed output, active/uncertain/external work, pending submission/read/cancel/load, and release races. Add MCP discovery/schema/result coverage. Expect missing tool/method failures before implementation.
- [ ] Implement operation guards and discussion-owned cursors, then the release API. Exercise repeated release cycles with deterministic state-size assertions, not RSS measurements.
- [ ] Update MCP discovery and independently installed package verification for six tools and forget/resume behavior.
- [ ] Document explicit retention, offline limits, busy cases, stale cursors, and cursorless resume. Keep historical release records unchanged.
- [ ] Run `npm run check`, `npm run verify:package`, `npm pack --dry-run` and `git diff --check`; validate changed Markdown links and JSON examples. Expect all checks to pass.
- [ ] Rebase onto merged #19, obtain independent review, create the PR, wait for Node 22/24 CI and merge with `Closes #20`.
