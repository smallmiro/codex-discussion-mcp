# Implementation Verification Record

Verification date: 2026-10-25. Version: `@mirolab/codex-discussion-mcp@0.1.0`.

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
  configured by the user. Actual publication via OIDC has not yet been verified.

Future verification runs and artifacts are available in [GitHub Actions](https://github.com/smallmiro/codex-discussion-mcp/actions).
