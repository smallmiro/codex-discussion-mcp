# Reply Selection Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Resolve omitted reply selections consistently from the latest persisted thread defaults.

**Architecture:** Share thread-default reconciliation between reads and replies. Apply it after rejecting foreign activity and before selection validation. Explicit selections win; a changed model cannot inherit the old model's effort when backend effort is unavailable.

**Tech Stack:** Node.js >=22.14.0, TypeScript ESM, node:test through tsx.

**Spec:** [Issue #18](https://github.com/smallmiro/codex-discussion-mcp/issues/18).

## Global Constraints

- Preserve dynamic model/effort validation and model-change defaults.
- Unknown saved effort requires an explicit effort unless selecting another model.
- Preserve one pending/active submission per discussion and foreign activity checks.
- Keep execution read-only; do not replay inference or publish a release.

## Review Focus

- Direct reply and read-then-reply must agree after sequential external work.
- An explicit effort or model must retain precedence over backend defaults.
- Null effort clears stale selection; missing effort must not cross model boundaries.
- Foreign active work must be rejected before local defaults are reconciled.
- Concurrent reads must not overwrite a pending submission's selection.

### Task 1: Reconcile reply defaults

**Files:** `src/discussions.ts`, `tests/discussions.test.ts`, `tests/fixtures/app-server.mjs`, `README.md`, `skills/codex-discussion/references/tools.md`.

**Interfaces:** Private `reconcileDefaults(state: DiscussionState, thread: Record<string, unknown>): void`; public inputs/results unchanged.

- [ ] Extract current read reconciliation without changing behavior; run `npm run check` and commit separately.
- [ ] Add fixture scenarios for completed external work, explicit overrides, null/missing effort, and active foreign turns. Run the selection-focused tests; expect stale selections or missing `EFFORT_REQUIRED` failures.
- [ ] Reconcile current defaults before reply selection; clear effort on a model change when backend effort is missing. Document inheritance from persisted defaults.
- [ ] Run `npm run check` and `git diff --check`; expect all checks to pass, then commit.
- [ ] Rebase onto merged #17, create a PR, obtain independent review, wait for Node 22/24 CI, and merge with `Closes #18`.
