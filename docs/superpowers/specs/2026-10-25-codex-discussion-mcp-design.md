# Codex Discussion MCP Design

Original design status as of 2026-10-25: implementation and local verification complete,
before the first npm publication. A separate review agent confirmed that no unresolved
questions blocked the implementation plan. Version 0.1.0 has since been published;
see the [release record](../../releases/0.1.0.md).

## Purpose and Confirmed Requirements

Coding agents that support MCP, such as Claude Code and Antigravity CLI, exchange
questions, counterarguments, and reassessments with Codex. The calling agent selects
the model and reasoning effort according to the complexity of the question. An agent
using the tools for the first time must be able to retrieve the model catalog and
each model's supported effort values through a tool.

The calling agent controls the discussion order, follow-up questions, and decision to
end the discussion. Its conversation history is not automatically passed to Codex, so
it explicitly includes the necessary context in each message. It can also specify a
project path.

At the user's additional request, installation and distribution use an npm package.
The distribution namespace is the user-owned organization `@mirolab`, and the package
is public. The GitHub repository is
`https://github.com/smallmiro/codex-discussion-mcp`.
The project follows the existing remote repository's MIT LICENSE.
The user requested a release workflow that builds on GitHub and publishes to npm.

## Approaches Considered

1. Discussion led by the calling agent: MCP manages Codex conversations and execution
   state. This requires no callbacks to external agents and is easy to connect to
   different MCP hosts.
2. Discussion automatically led by the server: the server also runs external agents
   and manages rounds. This requires execution adapters for each agent and additional
   lifecycle management.

The user's follow-up requirements were developed into approach 1. Approach 2 is
outside the scope of this version.

## Proposed Implementation Choices

The following are implementation proposals, rather than choices specified by the user.

- Use Node.js >=22.14, TypeScript, and the official MCP SDK v2. Verify compatibility
  with existing MCP hosts through the SDK's legacy protocol support and integration
  tests.
- Use stdio MCP between the external host and the MCP server.
- Have the MCP server launch a dedicated `codex app-server --listen stdio://` child
  process.
- Reuse the existing Codex CLI login and provider settings without directly reading
  authentication files.
- Reserve stdout for the MCP protocol and write diagnostic logs to stderr.
- Start Codex in read-only mode for exploring the project and discussing it.
- Disable this MCP connection in the child process's configuration to prevent the
  child Codex process from recursively invoking the same discussion MCP. Disable
  other MCP configurations by default as well.
- Explicitly define Codex's role as a discussion partner in its developer
  instructions. Instruct it to explain evidence, assumptions, counterexamples, and
  unresolved issues, and to evaluate the caller's views independently.

## MCP Tools

### `models_list({ includeHidden? })`

Retrieve and return every page of `model/list`. The default `includeHidden` is false.
Do not maintain hardcoded model or effort catalogs in the source code.

Each entry includes `id`, the `model` value to use in calls, `displayName`,
`description`, `isDefault`, `defaultReasoningEffort`, and
`supportedReasoningEfforts`. Preserve the original effort descriptions as well.
Return the retrieval timestamp.

This is the catalog provided by the connected Codex instance. Do not present it as a
list of models whose inference access has been verified for the actual account or
provider. This tool sends no inference requests.

### `discussion_start({ message, cwd?, model?, effort? })`

Create a new thread and start its first turn. Validate that `cwd` is an existing
absolute directory. If omitted, use the MCP server's working directory at startup.

Immediately return `discussionId`, `turnId`, `status`, `model`, and `effort`.
Use the Codex thread ID as `discussionId`.

### `discussion_reply({ discussionId, message, model?, effort? })`

Start a new turn in an existing thread. The model and effort can change on every turn.
If a turn is already running, return a busy error and the current turn ID.
Do not silently queue turns in the same conversation or insert them into a running
turn. Different conversations can run independently.

### `discussion_read({ discussionId, turnId?, cursor?, limit?, waitMs? })`

Retrieve the status and public messages for the latest turn or a specified turn.
`waitMs` is a bounded long poll with a default of 0 and a maximum of 20 seconds.
It may return early when the turn completes or new public messages become available.
Separate start/reply from result retrieval so that long inference runs are not
constrained by MCP call timeouts.

Return the status, model/effort, messages, public progress information, next cursor,
and errors. Preserve final messages without double-counting delta and item-completed
events. Do not collect or expose private reasoning. Retrieve accumulated history in
pages.

### `discussion_cancel({ discussionId, turnId })`

Send `turn/interrupt` for the specified turn. Distinguish acceptance of the interrupt
request from completion of the interruption. Check the final status with
`discussion_read`. For an already completed turn, return its completed status, and
never interrupt a different turn by mistake.

## Model and Effort Selection Rules

1. Model omitted in a new conversation: select the catalog's `isDefault` model. If
   the default model is ambiguous or missing, return an error directing the caller
   to list the models and make an explicit selection.
2. Effort omitted in a new conversation: use the selected model's
   `defaultReasoningEffort`.
3. Both omitted in a follow-up turn: retain the last accepted model and effort.
4. Model changed and effort omitted in a follow-up turn: use the new model's default
   effort.
5. Only effort specified in a follow-up turn: validate it against the retained model.
6. Use the returned `model` value for model selection. Validate effort against that
   model's supported values. For an invalid combination, return an error with the
   allowed values.
7. The catalog may be cached briefly, but `models_list` explicitly fetches fresh
   data. On validation failure, refresh once and validate again. Do not automatically
   substitute another model.
8. Always include the selected model/effort sent to Codex in the response. Surface an
   actual provider access rejection as a separate execution error.

The tool descriptions and README must state the usage flow: first use `models_list`
to inspect model descriptions and supported effort values, then choose according to
the difficulty of the question. The server must not override the caller's selection
based on fixed assumptions about model rankings, price, or speed.

## Protocol and Execution Lifecycle

- For each connection, receive the `initialize` response, send `initialized`, and
  then begin requests.
- Parse JSONL frame by frame and route messages by RPC ID, thread ID, and turn ID.
- Register event listeners before requesting a turn start so that even immediate
  completion events are preserved.
- Distinguish JSON-RPC response acceptance from inference completion. Check the
  final status in `turn/completed`; do not treat `failed` or `interrupted` as success.
- When a user reconnects using a discussion ID, restore the conversation with
  `thread/resume`. Restore the thread's selection settings from `model` and
  `reasoningEffort` in the resume response. These fields were verified in the local
  0.164.0 schema. If effort is null and cannot be restored, require an explicit
  effort in the next reply. Explicitly apply the read-only execution policy and
  discussion role on resume as well.
- Retrieve completed public history in pages through the app-server's persisted
  history API. Cursor formats need not remain compatible across MCP process
  restarts. An old cursor may return a clear error directing the caller to query
  again without a cursor.
- Reads during a connection check the latest thread state and last turn to detect
  active work from an external connection. Only when paginated history for a new
  live thread is not yet ready, use the supported `thread/read(includeTurns: true)`
  to check its latest state.
- If the process exits during execution, expose ongoing calls as connection-lost.
  Do not automatically retry inference requests, to avoid duplicate charges or
  duplicate turns.
- Reject or cancel execution approval requests and user input requests that arise
  during a read-only discussion using supported protocol responses. Record the
  reason in public progress information to prevent indefinite waiting.
- On MCP shutdown, clean up the child process and pending RPCs/long polls.

## Scope and Limitations

This version is a local stdio MCP. It does not include a multi-user service, web UI,
automatic multi-party discussion, external agent execution, file modification, or
automatic consensus judgments.
Each MCP host process has its own app-server process.
Concurrent modification of the same conversation by multiple MCP processes is not
supported. Before reading or starting a new turn, check the app-server's active turn
state and report conflicts as errors.

## Verification and Acceptance Criteria

- Use RPC and MCP integration tests with a fake app-server to verify initialization
  order, fragmented JSONL, response/event routing, pagination, immediate completion
  events, errors/interruption, and process termination.
- Verify different effort values per model, defaults, effort reselection on model
  changes, invalid combinations, and catalog refreshes.
- Verify rejection of concurrent replies to the same thread and independent
  execution of different threads.
- With an MCP client, verify the scenario of first retrieving the model catalog,
  passing the selected model/effort to the actual `turn/start`, and changing the
  model/effort within the same conversation.
- Verify model catalog retrieval against local Codex without inference.
- For a real inference smoke test, verify start/read/follow-up with a short
  discussion and state the scope actually exercised in the results. Do not report
  connection failures or access rejections as successful tests.
- Provide build/run instructions, the CLI login prerequisite, generic MCP
  configuration JSON, tool usage examples, and instructions for reading and
  canceling long-running turns in the README. Do not guess host-specific
  configuration paths.
- Install the output of `npm pack` in a separate temporary directory and verify MCP
  initialization and tool listing through the installed executable. It must work
  without a source checkout or development dependencies.
- Include build output and the README in the release tarball; exclude tests, local
  configuration, and authentication data. Check the version and executable path
  with `npm pack --dry-run`.
- Run tests, builds, and package verification in GitHub Actions and support public
  npm publication. Configure publishing permissions according to the npm
  organization's trusted publishing/authentication setup.

The implementer chooses the test runner, module organization, detailed limit values,
cache TTL, and similar implementation details.

## MCP Host Registration Guidance

At the user's request, npm installation is the default distribution method. The
organization scope is confirmed as `@mirolab`, with public visibility. In the original
pre-publication design, the proposed package name was
`@mirolab/codex-discussion-mcp`, with the name and permissions to be checked before
publication. A public registry lookup on 2026-10-25, before publication, did not find
that name. The original proposal used `codex-discussion-mcp` as the executable command
and `codex-discussion` as the MCP registration name. Version 0.1.0 has since been
published under that package name; see the [release record](../../releases/0.1.0.md).
The `bin` field in `package.json` points to `dist/index.js`, and the executable has a
Node shebang. Build before publication so that installing users do not need to clone
the repository or compile TypeScript.

Installation and registration example for users after publication:

```sh
npm install -g @mirolab/codex-discussion-mcp
claude mcp add --transport stdio --scope user codex-discussion -- codex-discussion-mcp
```

Also provide a way to run without a global installation using
`npx -y @mirolab/codex-discussion-mcp@<version>`. The original pre-publication
requirement was not to describe this command as currently installable until it had
been verified against a published version.
Document Node.js and a logged-in Codex CLI as runtime prerequisites.

- Claude Code: use the stdio registration command above.
- Kiro CLI: add command/args to `mcpServers` in `~/.kiro/settings/mcp.json`.
  The project-scoped path is `.kiro/settings/mcp.json`.
- Antigravity CLI: add the same command/args to `mcpServers` in
  `~/.gemini/config/mcp_config.json`. The project-scoped path is
  `.agents/mcp_config.json`.
- Explain how to merge the new entry into existing settings without overwriting
  other server configurations.
- In the README, provide examples covering actual build output, Node/Codex paths,
  registration verification, and the first `models_list` call. Explain that
  registration alone does not mean the calling agent will always discuss with
  Codex, and describe how to request a discussion from the calling agent or add
  separate project instructions.

For Kiro and Antigravity, the common server entry for a global installation is
`{"command":"codex-discussion-mcp","args":[]}`; for npx, it is
`{"command":"npx","args":["-y","@mirolab/codex-discussion-mcp@<version>"]}`.
Use the confirmed package name and version in the actual README.

The paths and commands above were verified against each product's official
documentation on 2026-10-25. Registration guidance must state the scope verified for
the installed host version.

## Verification Sources

- [Official app-server documentation](https://learn.chatgpt.com/docs/app-server)
- [Claude Code MCP registration](https://code.claude.com/docs/en/mcp)
- [Kiro MCP configuration](https://kiro.dev/docs/mcp/configuration/)
- [Antigravity MCP configuration](https://www.antigravity.google/docs/mcp)
- [npm package.json bin configuration](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/)
- [npm exec / npx](https://docs.npmjs.com/cli/v11/commands/npm-exec/)
- Verified `model/list`, `turn/start.model`, and `turn/start.effort` in the
  `generate-json-schema` output from local `codex-cli 0.164.0`.
- Successfully initialized the local app-server and retrieved the complete
  `model/list` on 2026-10-25. No inference requests were run for this verification.
