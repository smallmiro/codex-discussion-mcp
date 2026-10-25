# Codex Discussion MCP

A local MCP server that lets Claude Code, Antigravity CLI, Kiro CLI, and other
agents call **Codex as an independent discussion partner**. The calling agent leads
the discussion and can choose a model and reasoning effort for each question.

- Query Codex for available models, descriptions, and supported effort levels
- Send questions, counterarguments, and additional evidence while retaining context
- Retrieve long-running responses asynchronously and interrupt a specific turn
- Resume in a later session using a conversation ID saved by Codex
- Explore projects with read-only access and exchange public messages

The package name is `@mirolab/codex-discussion-mcp`. Install the version published
to npm with the commands below. To use an unpublished version, install the `.tgz`
from the `npm-package` artifact in GitHub Actions or build it locally.
[Publishing guide](docs/publishing.md)

## Requirements

- Node.js **22.14 or later** and npm
- [Codex CLI](https://developers.openai.com/codex/cli/) installed and signed in
- Validated against the app-server protocol in Codex CLI **0.164.0**

The server uses your existing Codex CLI login and model provider settings. You do
not need to enter a separate OpenAI API key for the MCP server. Your provider's
account permissions and usage limits still apply.

Codex has read-only access when exploring projects. Inherited MCP connections and
plugins are disabled in the child process used for discussions. The calling
agent's conversation is not shared automatically, so include the code,
explanations, and assumptions needed for each question.

## Installation

Install the published package globally:

```bash
npm install -g @mirolab/codex-discussion-mcp
codex-discussion-mcp --help
```

You can also run it without a global installation. Register this command in your
MCP configuration:

```bash
npx -y @mirolab/codex-discussion-mcp@0.1.0
```

This command waits for requests as a stdio MCP server. You do not type questions
into it like a terminal chat command; the MCP host connects to the server and
calls its tools.

## Register with Claude Code

After installing globally, register it for all projects:

```bash
claude mcp add --transport stdio --scope user codex-discussion -- codex-discussion-mcp
claude mcp get codex-discussion
```

Register without a global installation:

```bash
claude mcp add --transport stdio --scope user codex-discussion -- \
  npx -y @mirolab/codex-discussion-mcp@0.1.0
```

To share the configuration at the project level, replace `--scope user` with
`--scope project`. You can also check the connection in Claude Code using `/mcp`.

## Register with Kiro CLI or Antigravity CLI

Merge the server entry below into the existing `mcpServers` in the relevant
configuration file.

| Host | User-wide configuration | Project configuration |
|---|---|---|
| Kiro CLI | `~/.kiro/settings/mcp.json` | `.kiro/settings/mcp.json` |
| Antigravity CLI | `~/.gemini/config/mcp_config.json` | `.agents/mcp_config.json` |

```json
{
  "mcpServers": {
    "codex-discussion": {
      "command": "npx",
      "args": ["-y", "@mirolab/codex-discussion-mcp@0.1.0"]
    }
  }
}
```

If you installed the package globally, you can use this server entry instead:

```json
{ "command": "codex-discussion-mcp", "args": [] }
```

Host configuration formats may vary by installed version. See the official
[Claude Code documentation](https://code.claude.com/docs/en/mcp),
[Kiro documentation](https://kiro.dev/docs/mcp/configuration/), and
[Antigravity documentation](https://www.antigravity.google/docs/mcp).

## Project path and Codex executable

We recommend passing the project's **absolute path** as `discussion_start.cwd`.
If omitted, the server uses `--cwd`, falling back to the MCP process's working
directory. The host may start the MCP process outside your project.

```json
{
  "command": "codex-discussion-mcp",
  "args": ["--cwd", "/absolute/path/to/project", "--codex-command", "/absolute/path/to/codex"]
}
```

By default, `--codex-command` uses the `CODEX_DISCUSSION_CODEX_PATH` environment
variable, then `codex` on PATH. For advanced setups, repeat `--codex-arg` to replace
the default app-server launch arguments. Use `=` for values beginning with `-`,
such as `--codex-arg=--some-option`.

## Ask your agent

> First, query codex-discussion for the available models and supported effort levels.
> Choose a model and effort suited to the question's complexity, and discuss the
> strengths and weaknesses of the current design with Codex. Exchange
> counterarguments, then summarize the points of agreement and remaining differences.

To require discussions in specific situations, add instructions like these to
each agent's project guidelines:

> Before major architecture decisions, get an independent review through codex-discussion.
> Query models_list first, then choose a model and supported effort suited to the question.
> Share your position and evidence, consider counterarguments, and explain the reasons for the final decision.

## MCP tools

| Tool | Input | Result |
|---|---|---|
| `models_list` | `includeHidden?` | Model and effort catalog, retrieval time |
| `discussion_start` | `message`, `cwd?`, `model?`, `effort?` | New `discussionId`, `turnId`, selected settings, current status |
| `discussion_reply` | `discussionId`, `message`, `model?`, `effort?` | New turn in the same conversation |
| `discussion_read` | `discussionId`, `turnId?`, `cursor?`, `limit?`, `waitMs?` | Status, public messages, `nextCursor`, errors |
| `discussion_cancel` | `discussionId`, `turnId` | Status of the interruption request for a specific turn |

Do not hardcode model IDs or effort levels. Each entry returned by `models_list`
includes `model`, `displayName`, `description`, `isDefault`,
`defaultReasoningEffort`, and `supportedReasoningEfforts`. Select using the
**`model` value**, not the picker ID, `id`. Catalog retrieval does not verify
inference access and reports `accessVerified: false`.

Selection rules:

1. If omitted on the first question, use the catalog's default model and that model's default effort.
2. If omitted on a follow-up question, keep the previous selection.
3. If the model changes and effort is omitted, use the new model's default effort.
4. Unsupported combinations return an error that includes the allowed values.

`discussion_start` and `discussion_reply` do not wait for generation to finish.
Call the tools in this order:

```text
models_list({})
discussion_start({message: "Review the design", cwd: "/absolute/project", model: retrieved_model, effort: supported_effort})
discussion_read({discussionId: returned_ID, waitMs: 20000})
… read again if the status is inProgress …
discussion_reply({discussionId: same_ID, message: "What do you think of this counterexample?"})
```

`waitMs` accepts 0–20000, and `limit` accepts 1–100. A read may return before
completion when new output becomes available. Statuses are `inProgress`,
`completed`, `failed`, `interrupted`, and `connectionLost`. **Only `completed`
indicates successful completion.**

Use `nextCursor` to paginate messages. Long messages are split into chunks with
the same ID and a `textOffset`. Each chunk contains at most 8000 characters, and
each response at most 64000 characters. To retrieve revised text during
generation, read again without a cursor. Cursors are tied to a specific process,
conversation, and turn. After restarting the MCP server, omit the cursor and
read again.

Conversation IDs are Codex thread IDs. A later process using the same Codex
storage can resume them. When a saved turn's model or effort cannot be determined,
it is returned as `null`; the conversation's currently saved defaults are shown
separately in `threadDefaults`. If no saved effort is available, follow-up
questions require an explicit effort.

Each conversation processes one turn at a time. Additional questions while a turn
is running return `DISCUSSION_BUSY`. Different conversations can run
independently. Concurrently modifying the same conversation from multiple MCP
processes is unsupported. Inference is not automatically retried after a
connection closes or a request times out.

## Development and validation

See [AGENTS.md](AGENTS.md) for the repository map, behavioral contracts, validation
commands, and release guidance for coding agents.

```bash
npm ci
npm run check
npm run verify:package
npm run smoke -- --models-only
```

`verify:package` installs the tarball with production dependencies only in a
separate temporary directory, then uses the installed command to simulate MCP
discovery and a two-turn discussion. Automated tests do not consume actual model
usage.

To validate a short two-turn discussion with a signed-in Codex instance:

```bash
npm run smoke -- --inference
```

This command runs real inference and consumes account usage. CI runs type checks,
tests, builds, and installation validation on Node.js 22 and 24 without real
inference. The primary validation platforms are currently macOS and GitHub-hosted
Ubuntu.

## Publishing and design

[GitHub builds and npm publishing](docs/publishing.md) ·
[Design](docs/superpowers/specs/2026-10-25-codex-discussion-mcp-design.md) ·
[Development plan](docs/superpowers/plans/2026-10-25-codex-discussion-mcp.md)

## License

[MIT](LICENSE)
