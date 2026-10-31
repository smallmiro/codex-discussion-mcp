# Tool details

Names below are the server's tool names. Use any prefixes exposed by the host.

| Tool | Inputs | Purpose |
|---|---|---|
| `models_list` | `includeHidden?` | Retrieve model and effort metadata without inference. |
| `discussion_start` | `message`, `cwd?`, `model?`, `effort?` | Start a read-only discussion; return IDs and current status. |
| `discussion_reply` | `discussionId`, `message`, `model?`, `effort?` | Submit a follow-up in the same discussion. |
| `discussion_read` | `discussionId`, `turnId?`, `cursor?`, `limit?`, `waitMs?` | Read output and status; optionally wait for progress. |
| `discussion_cancel` | `discussionId`, `turnId` | Request interruption of one specific turn. |

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
