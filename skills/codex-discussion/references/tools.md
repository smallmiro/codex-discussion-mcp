# Tool details

Names below are the server's tool names. Use any prefixes exposed by the host.

| Tool | Inputs | Purpose |
|---|---|---|
| `models_list` | `includeHidden?` | Retrieve model and effort metadata without inference. |
| `discussion_start` | `message`, `cwd?`, `model?`, `effort?` | Start a read-only discussion; return IDs and current status. |
| `discussion_reply` | `discussionId`, `message`, `model?`, `effort?` | Submit a follow-up in the same discussion. |
| `discussion_read` | `discussionId`, `turnId?`, `cursor?`, `limit?`, `waitMs?` | Read output and status; optionally wait for progress. |
| `discussion_cancel` | `discussionId`, `turnId` | Request interruption of one specific turn. |

## Project directory and examples

The caller selects the directory explicitly named by the user, or its own
current working directory when the user omits a path. Resolve a relative path
against the caller's current directory, then pass the resulting existing absolute
directory as `discussion_start.cwd`. Check access in the MCP server environment;
report an unavailable directory rather than substituting another project.
Putting a directory only in `message` does not change the working directory.

Direct calls that omit `cwd` use the following server fallback:

```text
discussion_start.cwd -> --cwd -> MCP process working directory
```

Neither the MCP process directory nor the skill installation location establishes
the caller's current project. Replies retain the discussion's directory and do
not accept `cwd`. For another project, use a new `discussion_start`; resumed
discussions normally recover their saved directory.

The following examples assume the caller is in `/workspace/app` and both
`/workspace/app` and `/workspace/other-project` exist in the server environment.
Call `models_list` with `{}` first. These calls omit model and effort to use the
catalog defaults; when selecting explicitly, use the returned `model` and one of
its supported effort strings. Replace the example directories with real paths
and the ID placeholders with values actually returned by each call.

### Review the current project

User request: "Review this project's error handling with Codex."

Call `discussion_start` with:

```json
{
  "cwd": "/workspace/app",
  "message": "Read this project's error-handling source and relevant tests. Identify missing cases, citing inspected file paths and evidence. Report files you could not inspect. Keep the review read-only."
}
```

Call `discussion_read` with the returned IDs:

```json
{
  "discussionId": "<returned discussionId>",
  "turnId": "<returned turnId>",
  "waitMs": 20000
}
```

While `inProgress`, repeat the read without a cursor. After `completed`, retrieve
all `nextCursor` pages as described below. Report other terminal statuses as such.

### Review another project

User request: "Review authentication in `../other-project` with Codex."
Resolve that path against `/workspace/app` to obtain `/workspace/other-project`.
An explicit `/workspace/other-project` request selects the same directory.
Start a new discussion with:

```json
{
  "cwd": "/workspace/other-project",
  "message": "Read this project's authentication source and relevant tests. Report problems with inspected file paths and evidence, and identify files you could not inspect. Keep the review read-only."
}
```

Read the returned discussion and turn using the polling and pagination procedure
above. Keep these IDs separate from the current-project discussion's IDs.

### Follow up in the same project

Once the other-project turn is terminal, call `discussion_reply` using that
discussion's ID:

```json
{
  "discussionId": "<other-project discussionId>",
  "message": "Read the relevant tests again and explain why they do not catch the authentication issue you identified. Cite file paths and evidence, and report any inspection limits. Keep the review read-only."
}
```

This still reviews `/workspace/other-project`, even if the caller has since changed
its own directory. Read the returned turn to completion and retrieve all pages.

## Model and effort selection

Select the catalog entry's `model` value, not `id`. Supported effort strings come
from its `supportedReasoningEfforts` entries, using their `reasoningEffort` values.
There is no fixed model list or universal set of effort levels.

- On the first turn, omitted choices use the default model and its default effort.
- On replies, omitted choices inherit the previous selection.
- Changing model without specifying effort selects the new model's default effort.
- An explicit unsupported choice returns an error; it is not silently replaced.

`models_list` returns catalog metadata and `accessVerified: false`, not verified
account entitlement. A model can be listed and still reject inference.

## Reading complete output

`discussion_start` and `discussion_reply` return before generation finishes. Keep
the returned IDs and read the specific `turnId` so later turns do not change
which output is being examined.

`waitMs` accepts 0–20000, and `limit` accepts 1–100. Reads can return early when
new output arrives; a 20-second wait is not a deadline for the whole discussion.

| Status | Meaning for the caller |
|---|---|
| `inProgress` | Continue reading for updated output; do not submit another turn in this discussion. |
| `completed` | Generation succeeded; retrieve remaining pages before assessing the answer. |
| `failed` | Report the failure and any available error; partial output is not a completed answer. |
| `interrupted` | Generation stopped; report the interruption. |
| `connectionLost` | The connection was lost; retained local output may still be readable. Do not assume generation succeeded or stopped. |

While generation runs, read without a cursor to obtain revised partial text.
These reads can repeat or update earlier content; do not concatenate each poll
as new text. When completed, begin without a cursor and follow `nextCursor` until
exhausted. Text chunks share a message `id` and carry `textOffset`; reconstruct
the message using offsets. Each chunk contains at most 8000 characters and each
response at most 64000 characters.

Cursors belong to one MCP process, discussion, and turn. After a server restart,
read without the old cursor. Keep the `discussionId` if the user wants to resume
later through the same Codex storage.

## Busy turns, cancellation, and reconnecting

One discussion allows one active or pending submission. For `DISCUSSION_BUSY`,
read the active turn or request cancellation if the user wants it stopped.
Different discussions can run independently. Concurrently changing the same
discussion from multiple MCP processes is unsupported.

Cancellation requires both IDs. Read the turn afterward: acceptance of the
request does not establish the final `interrupted` status, and completion can
win the race.

After a timeout or connection loss, do not automatically repeat `discussion_start`
or `discussion_reply`; the original submission may already have run. Read the
known discussion and turn when possible, and report uncertainty if recovery
cannot establish the outcome.

An existing `discussionId` can be read or continued after reconnecting to the
same Codex storage. Historical per-turn model or effort can be `null`;
`threadDefaults` describes saved thread defaults, not proof of a past turn's
selection. For `EFFORT_REQUIRED`, query the catalog and explicitly select a
supported effort before the next reply.

Tools return structured application errors, also represented as text for legacy
hosts. Inspect `isError` and the error information before using the result.
Report authentication, provider, and protocol failures as failures rather than
converting them into technical advice from Codex.
