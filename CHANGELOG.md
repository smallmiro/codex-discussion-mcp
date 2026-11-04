# Changelog

Each npm release has a dated entry here and matching GitHub release notes.

## [0.1.5] - 2026-11-04

### Added

- Add `discussion_forget` to explicitly release inactive output retained by the
  MCP process while preserving saved Codex history. Released cursors become
  invalid; read without a cursor to resume saved history while connected.
- Ship a standalone authenticated remote app-server setup script and guide.
  The MCP connection continues to use local stdio.
- Include this changelog in the npm package and require updates for every npm
  publication.

### Fixed

- Keep previously fetched history pages readable after disconnect, including
  concurrent reads that finish while the connection is closing.
- Inherit reply model and effort from current persisted thread defaults and
  clear stale effort when the saved model changes without an effort value.
- Reject local state release during active, pending, loading, or uncertain work,
  including submissions with unknown outcomes and observed external activity.

### Documentation

- Clarify delegated model selection, selection inheritance, and brief disclosure
  of the selected model and effort.
- Add Skills CLI installation instructions and explain how to refresh copied
  skills separately from the npm package.

## [0.1.4] - 2026-10-31

- Keep immediate reads available during a newly submitted turn's startup history
  window without replaying inference.
- Preserve unrelated errors, historical turn boundaries, legacy inline history,
  and backend activity checks. See the [release record](https://github.com/smallmiro/codex-discussion-mcp/blob/main/docs/releases/0.1.4.md).

## [0.1.3] - 2026-10-31

- Add automatic npm update checks, cached metadata, update notices, and opt-out
  controls. See the [release record](https://github.com/smallmiro/codex-discussion-mcp/blob/main/docs/releases/0.1.3.md).

## [0.1.2] - 2026-10-31

- Ship the portable Codex Discussion skill, setup and tool references, and user
  manual. See the [release record](https://github.com/smallmiro/codex-discussion-mcp/blob/main/docs/releases/0.1.2.md).

## [0.1.1] - 2026-10-25

- Translate documentation to English, add the contributor guide, and make CLI
  version tests follow package metadata. No runtime behavior changes.
  See the [release record](https://github.com/smallmiro/codex-discussion-mcp/blob/main/docs/releases/0.1.1.md).

## [0.1.0] - 2026-10-25

- Initial public release with dynamic model discovery, per-turn model and effort
  selection, asynchronous reads, cancellation, and persisted discussion recovery.
  See the [release record](https://github.com/smallmiro/codex-discussion-mcp/blob/main/docs/releases/0.1.0.md).

[0.1.5]: https://github.com/smallmiro/codex-discussion-mcp/releases/tag/v0.1.5
[0.1.4]: https://github.com/smallmiro/codex-discussion-mcp/releases/tag/v0.1.4
[0.1.3]: https://github.com/smallmiro/codex-discussion-mcp/releases/tag/v0.1.3
[0.1.2]: https://github.com/smallmiro/codex-discussion-mcp/releases/tag/v0.1.2
[0.1.1]: https://github.com/smallmiro/codex-discussion-mcp/releases/tag/v0.1.1
[0.1.0]: https://registry.npmjs.org/@mirolab%2Fcodex-discussion-mcp/0.1.0
