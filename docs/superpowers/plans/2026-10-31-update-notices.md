# Automatic update notices implementation plan

**Goal:** Complete [issue #9](https://github.com/smallmiro/codex-discussion-mcp/issues/9) without installing or restarting anything automatically.

**Design:** Keep npm metadata separate from Codex discovery. A dedicated checker
fetches the fixed public npm latest endpoint with a 1500 ms deadline, coalesces
in-process requests, and persists successful and unsuccessful check metadata for
24 hours in the user's OS cache directory. Cache errors are best effort; failed
checks are unavailable, never evidence of being current. Only valid stable latest
versions can produce notices, compared using semantic version precedence.
Start the check in the background after CLI help/version handling. Add `update`
metadata to both representations of `models_list`; other tools never await it.
Disable all check/cache activity with `--no-update-check` or
`CODEX_DISCUSSION_UPDATE_CHECK=0`. Abort an outstanding request on shutdown.

**Approaches:** Background-only snapshot delivery could miss notices on the first
catalog call. Awaiting a bounded, coalesced checker alongside catalog discovery
delivers a notice on that call without delaying discussion tools; use this option.
No extra runtime dependency is necessary for the restricted stable-latest comparison.

**Constraints:** Preserve every catalog field and `accessVerified: false`, stdio
framing, legacy compatibility, read-only discussions, and paid-inference limits.
Cache only version/check metadata, outside the reviewed project. Do not publish.

## Tasks

- [x] Add failing deterministic checker tests: semantic versions, TTL/restarts,
  concurrent requests, timeout/body deadline, malformed/offline responses,
  filesystem failures, opt-out, shutdown, and platform cache paths.
- [x] Implement `src/updates.ts` and pass checker tests.
- [x] Add failing process-boundary tests for enabled/disabled checks, unchanged
  catalog fields, legacy text, valid stdout, help/version without network, and
  discussion submission/read/cancel during unavailable registry checks.
- [x] Integrate checker with `src/index.ts` lifecycle and `src/server.ts` results;
  pass process tests. Isolate tests and package verifier from public npm.
- [x] Update README, manual, portable skill and tool/setup references with
  localized once-per-version-per-session relaying, opt-out, cache behavior,
  installation-specific upgrades, reconnecting and separate skill refreshes.
- [x] Review the diff against every issue criterion. Run `npm run check`,
  `npm run verify:package`, `npm pack --dry-run`, and `git diff --check`;
  record actual results in `docs/verification.md`.

## Review focus

- A failed lookup must never turn into a current-version claim across restarts.
- Cache corruption, future timestamps and different running package versions
  must not create stale or false upgrade notices.
- Registry stalls include response bodies, not just response headers.
- npm metadata and diagnostic output must never enter Codex turn payloads/stdout.
- Global, local and pinned npx installations need different user actions.

## Execution record

- Initial checkout was clean on `main`; work uses `feat/issue-9-update-notices`
  in the existing workspace. The detailed issue authorizes implementation choices;
  no additional design approval is needed under the session's autonomy instructions.
- Baseline: 49 tests passed. New checker tests initially failed because the
  module was absent; new integration expectations initially failed without the
  field/CLI integration. Implementations then passed both focused suites.
- Final validation: 64 tests passed via `npm run check`; package installation
  verification, dry-run packing and whitespace checks passed. No paid inference.
- Independent review found a repository-relative link that would break in a
  separately copied skill. Replaced it with the public manual URL. The final
  review reported no material findings; its focused 9 checker and 13 MCP tests
  passed independently.
