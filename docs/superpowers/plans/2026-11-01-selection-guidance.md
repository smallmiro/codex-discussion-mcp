# Selection Guidance Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Make delegated model/effort selection understandable and responsive to user preferences.

**Architecture:** Keep selection in the portable skill. Use dynamic catalog descriptions, task ambiguity/scope/depth, and stated speed/depth preferences; briefly disclose the selection in an existing progress update. Preserve explicit choices without introducing a server router or approval prompt.

**Tech Stack:** Portable Markdown skill and user documentation.

**Spec:** [Issue #19](https://github.com/smallmiro/codex-discussion-mcp/issues/19).

## Global Constraints

- No fixed model names, effort enumerations, price claims, or entitlement assumptions.
- No added inference, automatic retries, confirmation gate, version bump, or publication.
- Keep copied skills self-contained and linked relative references valid.
- Write documentation in English and preserve command semantics.

## Review Focus

- Partial explicit selections must stay explicit while missing choices can be delegated.
- Speed preference does not imply an unsupported model price claim.
- Deep review examples must be grounded in returned catalog descriptions.
- Selection disclosure must be brief and precede an ordinary call without approval.
- Guidance is agent judgment and must not promise deterministic routing.

### Task 1: Clarify selection guidance

**Files:** `skills/codex-discussion/SKILL.md`, `skills/codex-discussion/references/tools.md`, `docs/skills.md`.

**Interfaces:** Public MCP schemas and RPC payloads unchanged.

- [ ] Run five fresh-context baseline simulations; record missing selection disclosure. Three of five omitted model/effort from progress; two supplied both and a brief reason.
- [ ] Move existing selection rules to one subsection in a separate tidy commit.
- [ ] Add a concise selection recipe and simple/ambiguous examples using catalog descriptions and user preferences. Align the manual and tool reference.
- [ ] Run five fresh-context revised-skill simulations plus deep-review and explicit-selection scenarios. Expect supported settings, preference alignment, and one brief selection reason without a confirmation gate.
- [ ] Validate Markdown links, JSON examples, copied-skill references and `git diff --check`; no prose-mirroring tests.
- [ ] Create a PR, obtain independent review, wait for Node 22/24 CI, and merge with `Closes #19`.
