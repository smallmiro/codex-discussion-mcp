# Startup Read Errors Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make immediate reads of locally owned running turns tolerate the known app-server startup errors in issue #13.

**Architecture:** Preserve notification-driven local output when backend freshness checks encounter the two precisely identified startup errors. Keep normal freshness checks, inline-history fallback, and all other errors intact.

**Tech Stack:** Node.js 22.14+, TypeScript ESM, node:test through tsx.

**Spec:** https://github.com/smallmiro/codex-discussion-mcp/issues/13

## Global Constraints

- Scope tolerance to the requested locally owned live turn that is in progress when the read begins; resolve cursor turn IDs too.
- Match RPC codes and known error messages; do not replay inference.
- Preserve foreign activity detection, resumed history, and disconnected local output.
- Preserve existing unrelated working-tree edits; no dependency or release changes.
- Run `npm run check` and `npm run smoke -- --inference`.

## Review Focus

- Unknown errors sharing a known RPC code must still surface.
- Known startup errors on completed or historical turns must still surface.
- Inline fallback failure must not lose received messages.
- A healthy backend must still reveal a foreign active turn.
- A reply's locally owned running turn should get the same protection.

### Task 1: Reproduce and fix the startup window

**Files:** Modify `tests/fixtures/app-server.mjs`, `tests/discussions.test.ts`, and `src/discussions.ts`.

**Interfaces:** Consume existing `DiscussionService.read`, fixture JSONL RPCs, and `DiscussionError`. Preserve public tool schemas and results.

- [x] Add deterministic per-thread read-error queues to the fixture, armed on `turn/start` by `--startup-read-errors`, and a `test/readErrors` control for negative cases. Fail metadata read with -32603, then turn listing and inline read with -32601.
- [x] Add regression cases asserting two immediate reads return `inProgress`, completion retains the full answer, and only the requested inference submissions occurred. Exercise both start and reply.
- [x] Add cases asserting unrelated errors surface, known errors surface for completed/historical turns, and healthy reads still reject foreign activity.
- [x] Run `npx tsx --test tests/discussions.test.ts`; confirm the startup cases fail with the reported RPC errors before changing production code.
- [x] In `refreshReadState`, return local state only when the requested turn matches `ownedActiveId` and the error is `APP_SERVER_ERROR` with the exact known code/message pair. Preserve an unknown listing failure if inline history also fails with a known startup error.
- [x] Run `npm run check`; all 71 tests, type checking, and build passed.
- [x] Run `npm run smoke -- --inference`; start, reply, completion, and resumed history passed against Codex CLI 0.166.0.
- [x] Review the diff and run `git diff --check`; actual verification results are recorded in `docs/verification.md`.
