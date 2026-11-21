# @ji.dev/coding-agent

## 0.1.0-alpha.1

### Patch Changes

- [`4c3bf0b`](https://github.com/baoziv587/Ji/commit/4c3bf0b9f8b1a4eeea4641b74d902d89524e8897) Thanks [@baoziv587](https://github.com/baoziv587)! - `/autocompact 400k` sets where the conversation is summarized by itself, and `/autocompact default` goes back to the model's own; the service takes it at `POST /api/sessions/:id/autocompact`

- [`5feccd2`](https://github.com/baoziv587/Ji/commit/5feccd216c9cb42f6e629f81c8636fdc3c7fd46e) Thanks [@baoziv587](https://github.com/baoziv587)! - A reply runs until the agent finishes or you stop it, instead of failing after 64 steps

## 0.1.0-alpha.0

### Minor Changes

- [`6c6f382`](https://github.com/baoziv587/Ji/commit/6c6f3820fc81b5e9fafb9649a72cd8da79540c63) Thanks [@baoziv587](https://github.com/baoziv587)! - First release

### Patch Changes

- Updated dependencies [[`6c6f382`](https://github.com/baoziv587/Ji/commit/6c6f3820fc81b5e9fafb9649a72cd8da79540c63)]:
  - @ji.dev/llm@0.1.0-alpha.0
  - @ji.dev/plugin-auth@0.1.0-alpha.0
  - @ji.dev/plugin-choices@0.1.0-alpha.0
  - @ji.dev/plugin-compaction@0.1.0-alpha.0
  - @ji.dev/plugin-files@0.1.0-alpha.0
  - @ji.dev/plugin-jsonl@0.1.0-alpha.0
  - @ji.dev/plugin-shell@0.1.0-alpha.0
  - @ji.dev/plugin-skills@0.1.0-alpha.0
  - @ji.dev/plugin-truncate-tool-results@0.1.0-alpha.0
  - @ji.dev/tui@0.1.0-alpha.0
  - @ji.dev/utils@0.1.0-alpha.0
