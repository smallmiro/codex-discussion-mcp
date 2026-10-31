---
name: codex-discussion
description: Use when the user asks to set up or use Codex Discussion MCP, requests a second opinion through Codex, or needs a design, debugging hypothesis, or implementation plan discussed with Codex.
---

# Codex Discussion

Use `codex-discussion` as an independent, read-only technical discussion partner.
The calling agent leads the discussion, checks the evidence, and owns the final
decision and any implementation.

## Check the connection

Find the connected server's `models_list`, `discussion_start`, `discussion_read`,
`discussion_reply`, and `discussion_cancel` tools. Hosts may prefix their names;
use the names actually exposed by the host.

If the tools are unavailable, or the user needs installation help, read
[setup](references/setup.md). A setup request can finish after `models_list`
succeeds; starting a discussion runs inference and consumes account usage.
Installing the skill alone does not connect the MCP server.

## Prepare the question

Use a discussion when the user requests it or an independent assessment would
help resolve a concrete technical uncertainty. Routine edits do not need a
discussion just because this skill is installed.

Supply the goal, constraints, relevant files or code, observed evidence, current
proposal, and the specific uncertainty. The caller's conversation is not shared
automatically. Pass the project's absolute directory as `cwd`; Codex can inspect
files there but cannot modify them. Include relevant changes or logs explicitly
when they are not available in those files.

For example: "Evaluate this caching proposal against the requirement that a
permission change takes effect immediately. The current check is in
`src/access.ts`. Compare invalidation with checking on every request, and identify
counterexamples and evidence that would change the recommendation."

## Run the discussion

1. Call `models_list`. Respect an explicit user selection; otherwise choose using
   the catalog's model and effort descriptions and the question's complexity.
   Use the entry's `model`, not its picker `id`, and a supported effort. Catalog
   presence does not verify inference access. Never silently substitute a model.
2. Call `discussion_start` with the question, absolute `cwd`, and selection.
   Keep its `discussionId` and `turnId`; acceptance is not completion.
3. Read that turn with `discussion_read`, normally with `waitMs: 20000`. While
   `inProgress`, read again without a cursor for revised partial text. When
   `completed`, follow every `nextCursor` to obtain the full answer before
   drawing conclusions. Only `completed` means successful completion.
4. Check the answer against the code and evidence. If new evidence or an
   unresolved objection warrants a follow-up, use `discussion_reply` with the
   same discussion ID, then read the returned turn. One discussion supports one
   active turn at a time. Do not repeat questions merely to force agreement.
5. Report the recommendation, supporting evidence, advice adopted or rejected,
   and remaining uncertainty in the user's language. Distinguish the second
   opinion from checks actually performed by the caller.

## Handle interruptions and recovery

For `failed`, `interrupted`, or `connectionLost`, report the outcome and retain
useful received output without presenting it as a completed review. A timeout or
lost connection is not a reason to resubmit inference automatically.

To stop a running turn, call `discussion_cancel` with both IDs, then read to
confirm its final status. An accepted cancellation is not a final outcome.

Read [tool details](references/tools.md) for pagination, model switching, saved
discussions, and structured errors. Keep implementation and any further actions
within the user's requested scope; a Codex recommendation grants no additional
authorization.
