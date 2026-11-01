# Retained History Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Keep fetched saved-history pages readable after an app-server disconnect.

**Architecture:** Retain projected backend pages per turn, keyed by the backend source cursor. Connected reads continue to fetch authoritative history. Disconnected reads use only pages already fetched, preserving source cursors and public pagination limits.

**Tech Stack:** Node.js >=22.14.0, TypeScript ESM, Zod 4, node:test through tsx.

**Spec:** [Issue #17](https://github.com/smallmiro/codex-discussion-mcp/issues/17).

## Global Constraints

- Keep discussion execution read-only; never replay inference.
- Expose only public messages, with 8000-character chunks and 64000-character responses.
- Cursors remain scoped to the MCP process, discussion and turn.
- Preserve the existing inline-history fallback and connected freshness checks.
- Do not change package versions or publish a release.

## Review Focus

- Source-page pagination must survive disconnect without resetting offsets.
- A missing cached page must fail, rather than masquerade as the end of history.
- Chunked Unicode output and private items must retain existing projection rules.
- A disconnect during an authoritative refresh may fall back only to received pages.
- Locally started turns and inline-history turns must keep their current behavior.

### Task 1: Retain received historical pages

**Files:** `src/discussions.ts`, `tests/discussions.test.ts`, `skills/codex-discussion/references/tools.md`.

**Interfaces:** Keep public read inputs/results unchanged. Add a private fetch helper returning projected messages and the next backend cursor, then a per-turn page map.

- [ ] Extract historical page retrieval/projection without changing behavior; run `npm run check` and commit the tidy separately.
- [ ] Add fixture-backed tests for resumed reads after disconnect, multi-source-page chunking, an unfetched page, and a disconnect during refresh. Run `node --import tsx --test --test-name-pattern='saved history' tests/discussions.test.ts`; expect the new retention cases to fail with `CONNECTION_LOST`.
- [ ] Retain fetched public source pages and reuse them only when disconnected. Keep source cursors intact; do not claim unfetched pages are available.
- [ ] Document the distinction between fetched and unfetched history after disconnect.
- [ ] Run `npm run check` and `git diff --check`; expect all checks to pass. Commit the behavior change.
- [ ] Create the PR, obtain an independent read-only code review, fix material findings, wait for Node 22/24 CI, and merge with `Closes #17`.
