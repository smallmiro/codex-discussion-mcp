# Codex Discussion skill user manual

The optional `codex-discussion` skill teaches your coding agent how to ask Codex
for an independent technical opinion and evaluate the answer. It is useful for
design comparisons, debugging hypotheses, and implementation-plan reviews.
The calling agent leads the discussion and remains responsible for the final
decision and implementation.

The [skill](../skills/codex-discussion/SKILL.md) is instructions for an agent;
this manual explains how you install and use those instructions. **The skill and
the MCP server are separate installations.** Copying the skill does not install
Codex, sign in, register the server, or grant tool permissions.

## 1. Prepare the MCP connection

You need Node.js **22.14 or newer**, npm, and an installed, authenticated
[Codex CLI](https://developers.openai.com/codex/cli/). The MCP server reuses that
CLI's authentication and provider settings; no separate API key is required by
this server. Do not copy credential files into the repository or skill.

For a local Claude Code installation, install the MCP executable:

```bash
npm install -g @mirolab/codex-discussion-mcp
codex-discussion-mcp --help
```

Check whether the server is already registered with
`claude mcp get codex-discussion`. If it is not, register it for your user:

```bash
claude mcp add --transport stdio --scope user codex-discussion -- codex-discussion-mcp
claude mcp get codex-discussion
```

Use `--scope project` instead of `--scope user` when you want shared project
configuration. Inspect an existing registration before changing it. In Claude
Code, open `/mcp` to check the connection and complete any host approval.
See the [README registration instructions](../README.md#register-with-claude-code)
and [Claude Code MCP documentation](https://code.claude.com/docs/en/mcp).

Ask the agent to call `models_list` to check catalog retrieval without inference.
It returns `accessVerified: false`: a listed model is not proof that your account
or provider permits inference with it. Starting or replying to a discussion runs
inference and consumes account usage.

## 2. Install the complete skill

Choose one installation scope. A personal skill applies across your local
projects; a project skill can be committed to that project's repository.

| Claude Code scope | Install directory |
|---|---|
| Personal | `~/.claude/skills/codex-discussion/` |
| Project | `<your-project>/.claude/skills/codex-discussion/` |

Before copying, check whether the destination already exists. If so, follow
[updating or removing the skill](#6-update-or-remove-the-skill) first. Copy the
entire directory, so that the installed layout is:

```text
codex-discussion/
├── SKILL.md
└── references/
    ├── setup.md
    └── tools.md
```

### From a repository checkout

Run these commands from the root of this repository to install a personal skill:

```bash
mkdir -p "$HOME/.claude/skills"
cp -R ./skills/codex-discussion "$HOME/.claude/skills/"
```

For a project installation, copy `skills/codex-discussion` into the target
project's `.claude/skills/` directory instead. The source checkout and target
project can be different repositories.

### From a globally installed npm package

The skill and this manual are included starting with **`0.1.2`**. The published
`0.1.0` and `0.1.1` releases do not include them; use the checkout-based method
above or install `0.1.2` or later before following the npm-copy instructions.

After globally installing a package that contains the skill, confirm its files:

```bash
ls "$(npm root -g)/@mirolab/codex-discussion-mcp/skills/codex-discussion"
```

Then copy the complete directory into your chosen skill location:

```bash
mkdir -p "$HOME/.claude/skills"
cp -R "$(npm root -g)/@mirolab/codex-discussion-mcp/skills/codex-discussion" "$HOME/.claude/skills/"
```

An `npx` MCP registration does not copy a skill into a host's discovery directory.
Use the checkout method or a package installation whose files you can access.

## 3. Invoke the skill in Claude Code

In a local Claude Code session, type `/` and select `codex-discussion`, or enter
the command with your question. The installed skill is also eligible for
automatic selection when your request matches its description. Automatic
selection is not a guarantee that every task will start a discussion.

Claude Code watches existing skill directories. If the top-level skills
directory was created after your session started, use `/reload-skills` where
supported, or restart the session. If the command is still missing, check the
installation path, frontmatter, and any organization restrictions. A personal
skill with the same name can take precedence over a project skill. See
[Claude Code skills](https://code.claude.com/docs/en/skills).

### Compare a design

```text
/codex-discussion Compare cache invalidation with checking permissions on every
request in this project. A permission change must take effect immediately.
Share the relevant access-check code and our current proposal with Codex, test
its counterexamples against the code, and explain the trade-offs and final choice.
```

### Review a debugging hypothesis

```text
/codex-discussion Review our hypothesis that duplicate events cause the missing
notification. Include the failing test, event ordering, relevant logs, and the
alternatives already ruled out. Ask what evidence would distinguish the causes,
then assess that advice against the repository before recommending a fix.
```

### Review an implementation plan

```text
/codex-discussion Get an independent review of our proposed database migration
plan. Include the schema changes, compatibility requirements, rollout order,
and rollback plan. Report overlooked failure cases, which recommendations you
accept or reject, and what still needs verification before implementation.
```

Codex does not automatically receive your agent's conversation. Include the
necessary code, logs, assumptions, and constraints in the question, and pass the
project's absolute path as `discussion_start.cwd`. Codex can inspect files there
with read-only access. Advice from the discussion does not authorize additional
changes or actions beyond your original request.

### Choose a project and continue the review

When you omit a directory, the skill tells the agent to use its current working
directory and pass that absolute path as `discussion_start.cwd`. For example:

```text
/codex-discussion Read this project's error-handling source and relevant tests.
Report missing cases with inspected file paths and evidence. Identify files you
could not inspect and keep the review read-only.
```

An explicit directory takes priority. Relative paths are resolved against the
calling agent's current directory. If the agent is in `/workspace/app`, this
request selects `/workspace/other-project`; an explicit absolute path selects the
same location:

```text
/codex-discussion Review authentication in ../other-project. Read its relevant
source and tests, cite inspected file paths and evidence, and report inspection
limits. Keep the review read-only.
```

The selected directory must exist and be accessible in the MCP server's execution
environment. The agent reports an unavailable target rather than selecting a
different project. Merely mentioning a path in the discussion message does not
set its working directory. Direct tool calls that omit `cwd` use `--cwd`, then
the MCP process working directory, which may differ from the agent's project.
The skill installation directory does not select the project.

After the answer is complete, ask a follow-up using the existing discussion:

```text
Continue the same Codex discussion about other-project. Check why the existing
tests do not catch the authentication issue you identified, citing file paths
and evidence. Keep the review read-only.
```

`discussion_reply` retains the original discussion directory and has no `cwd`
argument, even if the caller changes its own directory. Reviewing a different
project starts a new discussion. The agent reads every returned turn until a
terminal status and retrieves all remaining pages of a completed answer. See
the [tool-call examples](../skills/codex-discussion/references/tools.md#project-directory-and-examples)
for the exact start, read, and reply inputs.

## 4. Use the same skill in other agents

Copy the same complete skill directory to one location supported by your host,
then register the MCP server using that host's configuration format. Tool names
may receive host-specific prefixes. The skill uses the connected tools rather
than requiring a fixed prefix.

| Host | Project skill location | Invocation and discovery | Official documentation |
|---|---|---|---|
| Codex CLI / IDE extension | `.agents/skills/codex-discussion/` | Mention `$codex-discussion`; use `/skills` to find it. | [OpenAI skills documentation](https://learn.chatgpt.com/docs/build-skills) |
| Cursor | `.agents/skills/codex-discussion/` or `.cursor/skills/codex-discussion/` | Use `/codex-discussion`; inspect Customize → Skills. | [Skills](https://cursor.com/docs/skills) |
| Gemini CLI | `.agents/skills/codex-discussion/` or `.gemini/skills/codex-discussion/` | Ask to use the `codex-discussion` skill; use `/skills list` and `/skills reload`. | [Skills](https://geminicli.com/docs/cli/skills/) |
| GitHub Copilot | `.agents/skills/codex-discussion/` or `.github/skills/codex-discussion/` | In Copilot CLI, include `/codex-discussion` in the prompt; `/skills list` shows discovery. Other surfaces differ. | [Supported surfaces](https://docs.github.com/en/copilot/concepts/customizations/agent-skills), [CLI usage](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills) |
| Antigravity | `.agents/skills/codex-discussion/` | In the CLI, use `/codex-discussion`; other surfaces have their own discovery UI. | [Skills](https://antigravity.google/docs/skills) |
| Kiro CLI V3 | `.kiro/skills/codex-discussion/` | Use `/codex-discussion` or a matching request. | [Skills](https://kiro.dev/docs/skills/), [V3 support](https://kiro.dev/docs/cli/v3/new-features/) |

These instructions describe officially documented skill support, **not a claim
that every host's skill UI or MCP connection has been tested here**. Support can
depend on version, policy, and local versus cloud execution. Verify discovery
and catalog retrieval in your target host. The repository's fixture-based
package check verifies installation and MCP tool behavior, not a host's automatic
skill selection.

When an agent lacks skill support, use its supported project guidelines to point
it to the copied guide and describe when to consult Codex. MCP tool descriptions
provide basic usage guidance even without an installed skill.

## 5. Understand the discussion flow

1. The calling agent discovers models and supported efforts with `models_list`.
   It respects an explicit selection or chooses using the returned descriptions.
   Model IDs and effort strings must not be hardcoded.
2. `discussion_start` returns a `discussionId` and `turnId`. This means the turn
   was accepted, not that the answer is complete.
3. The caller uses `discussion_read`, normally with `waitMs: 20000`. While
   `inProgress`, it reads again without a cursor to obtain updated partial text.
   Reads may return early with new output; 20 seconds is not a total discussion
   deadline. Repeated partial text should not be concatenated as new output.
4. Only `completed` indicates successful generation. The caller must still
   follow all `nextCursor` pages to retrieve the full answer. Long messages use
   chunks with a shared message ID and `textOffset`.
5. The caller checks the advice against the evidence. A useful new objection or
   finding can be sent with `discussion_reply` in the same discussion; the new
   turn must also be read to completion. Routine edits and repeated rounds to
   force agreement are unnecessary.

One discussion supports one active turn at a time. To stop it, ask your agent to
call `discussion_cancel` with both IDs, then read the final status. Accepted
cancellation does not establish `interrupted`; completion can win the race.

`failed`, `interrupted`, and `connectionLost` are different outcomes and should
be reported accurately. Partial output can still be useful, but it is not a
completed review. Do not automatically repeat an inference submission after a
timeout or disconnect: the original request may already have run.

See the skill's [tool reference](../skills/codex-discussion/references/tools.md)
for pagination limits, model switching, structured errors, and resuming saved
discussions. Cursors are tied to the MCP process, discussion, and turn. After a
restart, keep the discussion ID but read without an old cursor.

## 6. Update or remove the skill

### Check and update the MCP package

Call `models_list` to obtain package `update` metadata alongside the unchanged
model catalog, in structured results or the JSON text fallback. For `available`,
the skill relays the running/newer versions, release-notes link and upgrade and
reconnect instructions in your language once per newer version per session.
This portable delivery mechanism does not promise desktop popups or display in
every host. Older servers may omit the field; `unavailable` and `disabled` never
prove the installed version is current.

Automatic checks start in the background, fetch public npm version metadata only,
have a 1500 ms network timeout including response bodies, and coalesce concurrent
lookups within one process. Success and failure metadata is cached for 24 hours
across restarts, under `codex-discussion-mcp/update.json` in the OS user cache:
absolute `$XDG_CACHE_HOME` or `~/.cache` on Linux, `~/Library/Caches` on macOS,
`%LOCALAPPDATA%` or `~/AppData/Local` on Windows. Cache failures are ignored;
in-memory throttling remains. Registry errors do not block discussion submission,
polling or cancellation. `models_list` awaits the bounded check alongside catalog
retrieval. `--help` and `--version` do not check npm.

To disable network checks and update cache reads/writes, pass `--no-update-check`
in the server's configured arguments, or set `CODEX_DISCUSSION_UPDATE_CHECK=0`
in its environment.

- **Global npm installation:** run `npm install -g @mirolab/codex-discussion-mcp@latest`.
- **Project-local npm installation:** run `npm install @mirolab/codex-discussion-mcp@latest`
  in the installation's project, preserving its dependency/devDependency convention.
- **Version-pinned npx:** change the configured `@mirolab/codex-discussion-mcp@VERSION`
  argument to the desired newer version. A global installation does not update this pin.

After updating, finish active work and reconnect/restart the MCP server through
the host to load the new version. The checker never installs anything, rewrites
configuration, performs inference or interrupts/restarts active discussions.

### Refresh or remove a copied skill

An installed copy is independent of the checkout or npm package. Pulling changes
or updating the package does not update that copy.

To update, review any local customization, move the old copy outside all skill
discovery directories as a backup, and copy in the complete new directory. Do
not keep a renamed backup under a `skills/` directory: a host may discover it as
another skill. For example, from an updated repository checkout, replace a
personal Claude Code copy with:

```bash
skill_backup_dir="$(mktemp -d)"
mv "$HOME/.claude/skills/codex-discussion" "$skill_backup_dir/codex-discussion"
cp -R ./skills/codex-discussion "$HOME/.claude/skills/"
```

The old copy remains in the temporary backup directory for inspection or manual
restoration. Move it to a durable backup location if you want to keep it.

To remove a manually installed skill, move its `codex-discussion` directory out
of the host's skill location, or delete that specific directory after preserving
any customization. Reload skills or restart the host as needed. This leaves MCP
registration and Codex authentication unchanged; manage the MCP registration
separately in the host if you also want to remove the server connection.

## 7. Troubleshoot setup and usage

| Symptom | What to check |
|---|---|
| `/codex-discussion` is missing | Confirm the complete directory and valid `SKILL.md` are in a supported location. Reload discovery or restart the host; check same-name skills and organization policy. |
| The skill loads but tools are missing | Register and enable the MCP server separately. Inspect the host's MCP connection status. |
| An executable cannot be found | Check the host process's PATH. Configure absolute paths for the MCP command or `--codex-command` where needed. |
| `cwd` is rejected or Codex examines the wrong project | Supply an existing absolute directory accessible to the MCP server; the host's process directory may differ from your project. |
| Catalog retrieval fails | Check the Codex CLI sign-in and host diagnostics. Keep credentials and raw configuration out of reports. |
| A listed model rejects inference | Report the provider/account error. A successful catalog query does not verify entitlement; do not silently switch models. |
| `DISCUSSION_BUSY` | Read the active turn or request cancellation before another reply in that discussion. |
| A timeout or `connectionLost` occurs | Retain received output and read the known turn when recovery is possible. Do not resubmit inference automatically. |
| A saved discussion requires effort | Query the catalog and explicitly choose a supported effort. Historical turn selection may be unavailable even when thread defaults exist. |

The server is a local stdio process. In a remote or cloud session, its execution
environment must also contain Node.js, the MCP executable, an authenticated Codex
CLI, and the project files. A skill copied into a cloud repository does not
provide access to the user's local machine. Inherited MCP connections, apps, and
plugins are disabled in the discussion child; discussion execution is read-only.
