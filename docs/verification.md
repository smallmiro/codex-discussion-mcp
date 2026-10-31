# Implementation Verification Record

Verification date: 2026-10-25. Version: `@mirolab/codex-discussion-mcp@0.1.0`.

## Skill and User Manual Verification

On 2026-10-31, the skill and manual changes for
[issue #3](https://github.com/smallmiro/codex-discussion-mcp/issues/3) were checked
on Linux x64 with Node.js 22.22.0 and npm 11.12.1. This is an unreleased change
to the `0.1.1` source; the published `0.1.0` and `0.1.1` artifacts do not contain
the skill or manual.

- `npm run check`: Passed type checking, all 49 tests, and the build.
- `npm run verify:package`: Passed isolated production installation, exact
  content checks for the manual and all three skill files, executable checks,
  model discovery, and a two-turn discussion using the process fixture.
- `npm pack --dry-run`: Includes `docs/skills.md`,
  `skills/codex-discussion/SKILL.md`, and both skill references. Source, tests,
  implementation plans, and local configuration remain excluded.
- Skill frontmatter passed the skill-creator validator. Local Markdown targets
  and anchors, JSON examples, and `git diff --check` passed validation.
- The manual's checkout-copy, npm-path-copy, and update/backup shell commands
  were exercised in temporary directories with spaces in their paths. Complete
  skill contents and references were preserved; backups stayed outside the
  skill discovery directory. Real user configuration was not changed.
- An independent read-only review found no actionable issues in the skill,
  manual, installation instructions, protocol guidance, or package verifier.

The existing test `resume restores thread defaults and reads persisted public
history only` failed intermittently in the earlier draft and initial push CI:
the fixture could exit after truncating its JSON state file during a snapshot
rewrite. A new deterministic regression terminated a fixture during a write and
failed with `Unexpected end of JSON input` before the fix. The fixture now writes
a sibling temporary file and renames it over the saved snapshot. The regression
then passed, a fresh fixture read the previous snapshot, and the original resume
test passed 10 consecutive runs. This changes test persistence only, not runtime
protocol behavior.

[PR CI run 41166840927](https://github.com/smallmiro/codex-discussion-mcp/actions/runs/41166840927)
and [push CI run 41166836387](https://github.com/smallmiro/codex-discussion-mcp/actions/runs/41166836387)
both passed on Node.js 22 and 24 after the fixture fix, including the 49-test
suite and isolated package verification. The earlier PR run's uploaded
`npm-package` artifact was also downloaded and passed
`npm run verify:package -- --tarball <downloaded-tarball>` locally.

### Actual Claude Code Skill Test

At the user's request, Claude Code **2.1.311** was tested with Codex CLI
**0.166.0** using a freshly packed and production-installed candidate. The
complete installed skill was copied into a temporary project's `.claude/skills/`
directory, and the installed MCP executable was registered using
`claude mcp add --transport stdio --scope project`. Existing Codex and Claude
sign-ins were reused without reading or copying credential files.

Claude Code ran in print mode with the `sonnet` alias (resolved to
`claude-sonnet-5-5`), low effort, project settings, a strict explicit MCP
configuration, and session persistence disabled. Only `Read`, `Skill`, and this
server's MCP tools were allowed. The runs reported no permission denials.

| Scenario | Observed result |
|---|---|
| Explicit `/codex-discussion` setup check | Skill advertised; MCP connected; `models_list` returned 8 entries with `accessVerified: false`; no Codex inference submission. |
| Natural-language second-opinion request | One real Codex turn completed, but there was no `Skill` tool invocation. The harness assertion expecting automatic skill activation failed. |
| Explicit request to invoke the skill | `Skill` invoked `codex-discussion`, followed by catalog discovery, `discussion_start` with absolute project `cwd`, and repeated reads through `completed`; all harness assertions passed. |

Both live review turns used the dynamically discovered `gpt-6.1-sol` model with
`low` effort. The explicit skill run observed two `inProgress` reads and then
`completed` with `nextCursor: null`. The sample proposal incorrectly treated an
accepted submission as a finished review; Codex rejected that proposal. The
temporary project's input file remained unchanged.

These two short Codex turns consumed real account usage. The test confirms
installed-skill discovery, explicit invocation, and actual Claude-to-MCP-to-Codex
execution. It does not guarantee automatic selection for every matching prompt,
and it does not test interactive UI behavior, a live follow-up, active-turn
cancellation, or other hosts. Host paths and invocation methods for Codex,
Cursor, Gemini CLI, Copilot, Antigravity, and Kiro were checked against official
documentation; their host-side skill behavior remains unverified here. No npm
publication or product runtime change was made.

## Codex CLI 0.166.0 Compatibility Check

On 2026-10-31, the current `0.1.1` source passed `npm run check` (type checking,
48 tests, and build) and `npm run smoke -- --inference` on Linux x64 with
Node.js 22.22.0 and Codex CLI 0.166.0, resolving the validation requested in
[issue #1](https://github.com/smallmiro/codex-discussion-mcp/issues/1).
The CLI was installed in a temporary prefix, leaving the existing installation
unchanged:

```bash
npm ci
npm install --prefix /tmp/codex-discussion-issue-1-cli --no-save --package-lock=false @openai/codex@0.166.0
npm run check
PATH="/tmp/codex-discussion-issue-1-cli/node_modules/.bin:$PATH" npm run smoke -- --inference
```

The live run retrieved 8 models, including `gpt-6.1-terra`, completed a turn with
`gpt-6.1-sol` / `low`, switched to `gpt-6-luna` / `medium` for the follow-up,
and restored the persisted public response and model/effort defaults after
restarting MCP and app-server. Both turns returned `MCP connection confirmed`.

The [0.165.0 release notes](https://github.com/openai/codex/releases/tag/rust-v0.165.0),
[0.166.0 release notes](https://github.com/openai/codex/releases/tag/rust-v0.166.0),
and [app-server documentation](https://learn.chatgpt.com/docs/app-server) were
reviewed alongside JSON schemas generated by both CLI 0.164.0 and 0.166.0:

- The initialization parameters and request/response definitions for model discovery, thread
  start/resume/read, paginated history, turn start/interrupt, and configuration
  reads remain compatible. Across their 126 reachable schema definitions, the
  only changes are additive item fields and error variants.
- Items retain their flat wire format and add optional lifecycle timestamps
  and an image-generation identifier. Public message projection ignores these
  extra fields. New `modelNotFound` and `policyCapacityUnavailable` error variants
  retain the existing failed-turn/error-message handling.
- New experimental account/session and attached-fork APIs do not require
  changes to this integration, which reuses existing authentication. Backend
  provider validation, permission preservation on resume, reasoning-effort
  overrides, and thread startup/shutdown fixes require no client adaptation
  for the exercised workflow.

No user-facing package behavior changed, so only the README validation version
was advanced; the package remains `0.1.1` and no npm release was made. The live
smoke test does not exercise interruption of an active turn or access to every
catalog model/provider. Cancellation semantics remain covered by the process
fixture tests. The original implementation verification below is historical.

## Automated Verification

- `npm run check`: Passed type checking, **48 tests**, and the TypeScript build.
- `npm run verify:package`: Installed only production dependencies into a temporary
  prefix outside the source checkout and verified the installed binary's help/version,
  MCP discovery, model listing, and two turns with model/effort selection.
- `npm pack --dry-run`: Includes only `dist`, README, MIT LICENSE, the publishing guide,
  and package metadata. Source code, tests, development environment files, and
  authentication configuration are excluded from the distribution tarball.
- `actionlint 1.7.12`: Passed checks for the CI and npm publishing workflows.
- [GitHub CI run 40177781421](https://github.com/smallmiro/codex-discussion-mcp/actions/runs/40177781421):
  The check and tarball installation verification both passed for implementation
  commit `e875ef2` on Node.js 22 and 24.
- Downloaded the `npm-package` artifact from that GitHub run, installed it separately
  on macOS, and passed the same binary/MCP verification again. Local path:
  `artifacts/mirolab-codex-discussion-mcp-0.1.0.tgz`.

## Live Codex Verification

The full `npm run smoke -- --inference` scenario passed on macOS with
Node.js 26.0.0 and Codex CLI 0.164.0:

1. Retrieved 7 models from the live app-server catalog and each model's effort levels.
2. Ran the first turn with `gpt-6.1-sol` / `low` and confirmed `completed` status and a public response.
3. Switched to `gpt-6-luna` / `medium` for a follow-up turn in the same discussion.
4. Shut down MCP and app-server, then resumed the discussion in a new process and
   confirmed restoration of the persisted public history and model/effort defaults.

This record confirms successful access for the model/effort combinations exercised.
It does not guarantee inference access to every model in the catalog or for other
accounts/providers.

## Independent Review and Regression Fixes

A separate review agent reviewed the full set of changes and reran the 45 tests
that existed at the time. It reported one Important finding: reading a cached,
completed discussion did not detect new work from another connection. After
reproducing the issue with a failing test, the implementation was updated to fetch
the latest state while connected. Verification also covered reading the latest
history after external work completes and reading existing output after disconnection.

Two more cases were reproduced with failing tests and fixed: missing a long-poll
wakeup for output arriving during a state refresh, and the history API not yet
being ready for a new live thread. After the fixes, all 48 tests, installation
verification, and the live Codex smoke test passed again.
The review reported no Critical or Minor findings.

## Implementation Decisions and Verification Scope

- Used the current stable MCP SDK v2 and integration-tested legacy `2025-03-26`
  connections. This did not include testing each host's tool UI with live
  Claude/Antigravity/Kiro accounts.
- Implemented in a single session, followed by an independent review.
- The scope is a read-only local stdio service. Concurrent writes to the same
  discussion from multiple processes and service-scale memory lifecycle management
  are not provided. Completed output remains cached for the lifetime of the MCP process.
- Messages updated during generation must be fetched again without a cursor.
  Message page cursors are bound to a process, discussion, and turn and must not
  be reused after a restart.
- Provided an npm OIDC publishing workflow and setup guide. The first publication
  to the npm organization and Trusted Publisher configuration require setup by an
  account administrator. After the initial development verification, the
  [first publication of 0.1.0](releases/0.1.0.md) was completed using a GitHub Secret
  configured by the user. [0.1.1](releases/0.1.1.md) was published the same way
  after its OIDC run was rejected with `E404` because no Trusted Publisher is
  configured. Actual publication via OIDC has not yet been verified.

## Automatic Update Notices (2026-10-31)

Validation for [issue #9](https://github.com/smallmiro/codex-discussion-mcp/issues/9)
on Node.js 22.22.0:

- `npm run check`: passed type checking, all 64 tests, and the TypeScript build.
- `npm run verify:package`: passed a fresh tarball installation, executable
  help/version, shipped skill/manual contents, MCP discovery, catalog metadata
  and disabled update status, model selection, and a fixture-backed two-turn
  discussion independently of the source checkout.
- `npm pack --dry-run`: passed; 28 intended package files, including the compiled
  checker and portable skill documentation; no source/tests or cache data.
- `git diff --check`: passed. Relative documentation links and JSON examples were
  checked locally; the copied skill uses a public URL for the external manual.

The nine checker tests cover strict semantic version precedence for stable npm
latest versions, invalid/equal/older versions, persistent success/failure caches,
24-hour expiration, concurrency, invalid/stale/future cache entries, offline and
malformed/oversized responses, header/body deadlines, shutdown, cache failures,
opt-out and OS cache paths. The 13 MCP integration tests include actual process
restart cache reuse, cache read/write errors, CLI/environment opt-out,
help/version without registry calls, unchanged model metadata, identical
structured/text update information, legacy-host protocol stdout and shutdown,
and discussion start/read/cancel while registry requests fail or stall.

An independent code review reported no material findings after fixing a manual
link that would break in separately copied skills. Checks used controlled registry
responses and the deterministic app-server fixture. Public registry access, live
inference, individual host notice display and a new npm release were not part of
this verification. Package version remains 0.1.2; publication is a separate task.

## npm 0.1.3 Release Verification (2026-10-31)

[0.1.3](releases/0.1.3.md) is publicly available as npm `latest`. Release
preparation passed `npm run check` (64 tests, type checking and build),
`npm run verify:package`, dry-run packing and whitespace checks. Release PR CI
passed on Node.js 22 and 24; the publishing workflow repeated the checks and
verified its exact tarball before upload.

The public registry metadata, public tarball and successful publishing workflow
artifact match in integrity and bytes. A fresh installation by package name and
exact version used an empty cache, empty npm configuration and no token-related
environment variables. CLI help/version, shipped guide contents and the public
tarball's fixture-backed MCP behavior passed. Full identities, workflow links,
the OIDC failure and successful token fallback are recorded in the release record.
No new live inference was run; OIDC publication remains unverified.

Future verification runs and artifacts are available in [GitHub Actions](https://github.com/smallmiro/codex-discussion-mcp/actions).
