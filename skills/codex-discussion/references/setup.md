# Setup and connection checks

The skill and the MCP server are separate installations. Copying this skill does
not install Codex, sign in, register an MCP server, or grant tool permissions.
Use the host's normal permission settings.

## Prerequisites

- Node.js 22.14 or newer and npm.
- Codex CLI installed and signed in in the environment running the MCP server.
- Access to the project's files from that same environment.

The server reuses Codex's existing authentication and model provider settings.
Do not read or copy credential files to diagnose setup. The discussion child has
read-only project access, with inherited MCP connections, apps, and plugins
disabled. Discussion messages do not automatically include the caller's chat.

A cloud or remote agent needs the executable, authentication, and project files
in its own server environment. A local installation on the user's computer does
not by itself make this stdio server available to a remote host.

## Claude Code

For a user who requests installation for all local projects:

```bash
npm install -g @mirolab/codex-discussion-mcp
claude mcp add --transport stdio --scope user codex-discussion -- codex-discussion-mcp
claude mcp get codex-discussion
```

Use `--scope project` instead when the user wants shared project configuration.
Inspect an existing registration before updating it. Use `/mcp` in Claude Code
to check the connection and any required host approval.

Once connected, call `models_list`. This checks catalog retrieval without
running inference. It returns `accessVerified: false`; a model being listed is
not proof that the account or provider permits inference with it.

If Codex is not on the host process's PATH, configure its absolute path:

```json
{
  "command": "codex-discussion-mcp",
  "args": ["--codex-command", "/absolute/path/to/codex"]
}
```

The host may start the MCP process outside the project. Pass the absolute project
path in `discussion_start.cwd`. The skill selects the user's requested directory,
or the calling agent's current working directory when none is specified. Resolve
relative paths against the caller's current directory and confirm the directory
exists and is accessible in the MCP server environment. Report an inaccessible
target rather than falling back to another project.

For direct tool calls that omit `cwd`, the server uses `--cwd`, then the MCP
process working directory. You can configure `--cwd` as that server default, but
it does not discover the caller's current project. See the
[directory examples](tools.md#project-directory-and-examples) for explicit calls.

## Other MCP hosts

Merge this server entry into the host's existing MCP configuration using that
host's documented format:

```json
{
  "mcpServers": {
    "codex-discussion": {
      "command": "codex-discussion-mcp",
      "args": []
    }
  }
}
```

The example is an `mcpServers` JSON configuration, not a universal format. Codex,
for example, uses TOML for manual configuration. Discover the tools after
registration and use the host's actual names, including any namespace prefix.

Keep one copy of the complete skill directory in a location supported by the
installed host. These are project locations; personal locations and supported
surfaces can differ:

| Host | Skill directory | Official documentation |
|---|---|---|
| Claude Code | `.claude/skills/codex-discussion/` | [Skills](https://code.claude.com/docs/en/skills), [MCP](https://code.claude.com/docs/en/mcp) |
| Codex | `.agents/skills/codex-discussion/` | [Skills](https://learn.chatgpt.com/docs/build-skills), [MCP](https://developers.openai.com/codex/mcp/) |
| Cursor | `.agents/skills/codex-discussion/` or `.cursor/skills/codex-discussion/` | [Skills](https://cursor.com/help/customization/skills) |
| Gemini CLI | `.agents/skills/codex-discussion/` or `.gemini/skills/codex-discussion/` | [Skills](https://geminicli.com/docs/cli/skills/) |
| GitHub Copilot | `.agents/skills/codex-discussion/` or `.github/skills/codex-discussion/` | [Skills](https://docs.github.com/en/copilot/concepts/customizations/agent-skills) |
| Antigravity | `.agents/skills/codex-discussion/` | [Skills](https://antigravity.google/docs/skills) |
| Kiro CLI V3 | `.kiro/skills/codex-discussion/` | [V3 skills](https://kiro.dev/docs/cli/v3/new-features/) |

Skill support does not establish that this MCP server has been tested in each
host. Verify discovery and catalog retrieval in the target host. If a host does
not support skills, put a short routing instruction in its supported project
guidelines, pointing to the installed guide. The server also supplies basic MCP
instructions and tool descriptions, whose presentation depends on the host.

## Updates and automatic checks

The server checks public npm `latest` version metadata in the background at
startup and exposes the result through `models_list` in structured and text
results. It does not run inference or install anything. The skill relays an
available notice in the caller's language once per newer version per session;
hosts are not guaranteed to display it, and there are no desktop popups.

Checks have a 1500 ms network deadline covering headers and body, coalesce within
one process, and cache successful and failed checks for 24 hours across restarts.
Only version/check metadata is stored in `codex-discussion-mcp/update.json` under
absolute `$XDG_CACHE_HOME` or `~/.cache` on Linux, `~/Library/Caches` on macOS, and
`%LOCALAPPDATA%` or `~/AppData/Local` on Windows. Cache failures are ignored and an
in-memory cache still throttles the process. Offline and malformed responses
yield `unavailable`, not a claim that the version is current. Discussion tools
remain usable; only `models_list` awaits the bounded check alongside discovery.
`--help` and `--version` do not access npm.

Disable checks and cache reads/writes with server argument `--no-update-check`
or server environment variable `CODEX_DISCUSSION_UPDATE_CHECK=0`.

Use the procedure for the installation the host actually launches:

- **Global npm installation:** `npm install -g @mirolab/codex-discussion-mcp@latest`.
- **Project-local npm installation:** run
  `npm install @mirolab/codex-discussion-mcp@latest` in that installation's project,
  preserving its dependency/devDependency convention.
- **Version-pinned npx:** update the configured
  `@mirolab/codex-discussion-mcp@VERSION` argument to the desired newer version.
  Installing globally does not update an npx pin.

Finish active discussions, then reconnect/restart the MCP server in the host to
load the new package. The checker never modifies installed code, dependencies,
MCP configuration, or running discussions and never restarts the server.
A separately copied skill must be refreshed separately: preserve customizations,
move the old copy outside skill discovery directories, copy the complete updated
skill directory, then reload the host's skills. Updating npm does not overwrite
that copy. See the
[manual](https://github.com/smallmiro/codex-discussion-mcp/blob/main/docs/skills.md#6-update-or-remove-the-skill).

## Troubleshooting

| Symptom | Check |
|---|---|
| Skill command is missing | Confirm the complete directory is in a supported skill location, then reload skills or restart the host as its documentation requires. |
| Skill loads but tools are missing | Register and enable the MCP server separately; inspect the host's MCP connection status. |
| Executable cannot be found | Check the host process's PATH and use absolute executable paths where needed. |
| Catalog retrieval fails | Check the Codex CLI sign-in and server diagnostics in the host. Do not expose credentials or raw configuration. |
| Project path is rejected | Supply an existing absolute directory accessible to the MCP server. |
| A listed model rejects inference | Report the account/provider error; do not silently switch models or claim catalog retrieval verified access. |
