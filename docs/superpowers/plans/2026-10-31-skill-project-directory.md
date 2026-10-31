# Skill Project Directory Guidance Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan. Steps use checkbox syntax for tracking.

**Goal:** Complete [issue #5](https://github.com/smallmiro/codex-discussion-mcp/issues/5) with explicit directory selection, evidence-based code review instructions, and practical examples.

**Architecture:** Keep directory selection in the calling agent's skill instructions. Document the existing MCP fallback and follow-up behavior in the portable references, and expose natural-language examples in the user manual. Runtime behavior stays unchanged.

**Tech Stack:** English Markdown; existing Node.js MCP package verification.

**Spec:** [Issue #5 acceptance criteria](https://github.com/smallmiro/codex-discussion-mcp/issues/5).

## Global Constraints

- Preserve the existing MCP API, read-only policy, model selection, polling, and recovery contracts.
- Do not change dependencies or the package version, or publish a release.
- Existing published versions and historical verification records remain unchanged.
- Validate documentation and the packed artifact without live inference.

## Review Focus

- User omission must select the caller's actual working directory, even when the server starts elsewhere.
- Relative paths must resolve against the caller, not the MCP process or the skill's installation directory.
- A missing or inaccessible target must be reported rather than silently replaced.
- A reply cannot change project directory; another project requires a new discussion.
- Examples must use discovered model values and returned discussion/turn IDs, and retrieve complete output.

## Task 1: Update and verify the guides

**Files:** `skills/codex-discussion/SKILL.md`, `skills/codex-discussion/references/setup.md`, `skills/codex-discussion/references/tools.md`, `docs/skills.md`.

- [x] Record the existing omissions by comparing the guides with current source and issue #5.
- [x] Add directory selection and code inspection rules to the skill, fallback/reply details and tool-call examples to the references, and user-facing examples to the manual.
- [x] Validate relative links/anchors, JSON examples, frontmatter, and every issue requirement; run `git diff --check`, `npm run check`, `npm run verify:package`, and `npm pack --dry-run`.
- [x] Review the complete diff, resolve material findings, commit the documentation, and prepare an issue-linked PR with actual verification results.

## Execution Notes

- Initial inspection confirmed all omissions reported in the preceding review; the existing guidance only requests an absolute project path. The server already forwards that path and preserves it on replies/resume.
- Work uses the clean existing checkout on `docs/skill-project-directory`, avoiding changes on `main` and interference with completed work from issue #3.

## Verification Results

- `npm run check`: type checking, all 49 tests, and the build passed.
- `npm run verify:package`: isolated installation verified guide contents, executable, MCP discovery, model selection, and a fixture-based two-turn discussion.
- `npm pack --dry-run --json`: all four user guide files remain in the intended 26-file package; no package metadata changed.
- Documentation validation passed for five Markdown files, eight local links/anchors, six JSON examples, skill frontmatter, and the unchanged package version. `git diff --check` passed.
- Executed all four tool-reference JSON examples through the MCP SDK with temporary directories and fixture-controlled completions. Verified that explicit project directories override a different server default, relative paths resolve correctly, projects use separate threads, and replies retain the selected thread. This does not verify real model file inspection.
- A fresh read-only reviewer found no critical, important, or minor issues. The reviewer also applied the skill to five scenarios: omitted path with a different server default, relative path, inaccessible target, caller directory change before a reply, and switching projects during a follow-up.
- No live inference or host automatic-skill-selection checks were performed, and no release was published.
