# User Guide Skill Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan. Steps use checkbox syntax for tracking.

**Goal:** Complete [issue #3](https://github.com/smallmiro/codex-discussion-mcp/issues/3) with a portable skill, a human-readable usage manual, and independently verified npm packaging.

**Architecture:** Keep agent instructions in `skills/codex-discussion/`. Put user installation and usage instructions in `docs/skills.md`, with a short README entry point. Extend the existing tarball verifier to check all shipped guide files.

**Tech Stack:** Markdown, Node.js 22.14 or newer, existing TypeScript MCP server and process fixture.

**Spec:** [GitHub issue #3](https://github.com/smallmiro/codex-discussion-mcp/issues/3).

## Global Constraints

- Write documentation in English and preserve existing runtime behavior.
- Discover models and efforts dynamically; preserve asynchronous completion, pagination, cancellation, and recovery contracts.
- Include the complete skill and manual in the npm allowlist. Do not publish or bump the version as part of this task.
- Check official host documentation; separate documented support from observed host behavior.

## Review Focus

- A skill copy without its references must not be presented as a complete installation.
- Existing published packages without the skill must have a usable checkout-based installation route.
- Updating or removing a skill must not leave a discoverable backup or change MCP registration implicitly.
- Completed generation with remaining pages must not be confused with retrieving the entire answer.
- A cloud host must not be assumed to have access to local Codex authentication or project files.

## Task 1: Finish the user documentation

- [x] Retain and review the existing skill and its standalone setup/tool references.
- [x] Add `docs/skills.md` covering every manual section in issue #3, including practical prompts, maintenance, and host-specific invocation.
- [x] Link the manual prominently from the README; keep its quick-start commands consistent.
- [x] Validate skill frontmatter, local links, JSON examples, and installation commands in temporary directories.

## Task 2: Package and verify the guides

- [x] Add `docs/skills.md` to `package.json` and the existing packed-install verifier.
- [x] Run `npm run check`, `npm run verify:package`, `npm pack --dry-run`, and `git diff --check`.
- [x] Record the actual initial verification scope and results without claiming unperformed host or inference tests.
- [x] Review the complete change against the issue before committing and preparing integration.

## Task 3: Address CI evidence and the user's additional requests

Ruling: CI twice reproduced an existing fixture snapshot-write race. Fixing
test-only persistence is necessary to leave reliable verification for this
change; product runtime behavior stays unchanged.

- [x] Add a deterministic interrupted-write regression and observe it fail before the fixture fix.
- [x] Write fixture snapshots through a sibling temporary file and atomic rename; verify 49 tests, 10 resume repetitions, and Node.js 22/24 CI pass.
- [x] At the user's request, test the installed skill and actual MCP in Claude Code with an isolated project, including real Codex inference; record observed automatic-selection limits.
- [x] At the user's request, add a README roadmap entry for future remote Codex connections without implying current support.
