# Changelog

All notable changes should be recorded here before each tagged release.

This project follows Semantic Versioning:

- `MAJOR` for breaking configuration, command, permission, storage, or API changes.
- `MINOR` for backward-compatible features and user-visible workflow additions.
- `PATCH` for backward-compatible bug fixes, docs, and maintenance.

## Unreleased

### Added

- Google login auth: when no `GEMINI_API_KEY` / Vertex settings are configured, headless Gemini CLI processes now use `oauth-personal` and share the interactive `~/.gemini` login (symlinked into the headless CLI home), so the bridge runs on subscription quota.

### Added

- `<extension dir>/system.md`, when present, is passed to headless children as `GEMINI_SYSTEM_MD` (replaces the built-in system prompt).
- `<extension dir>/GEMINI.md` is linked into the headless Gemini CLI home so a persona / memory file actually reaches the child processes.

- Tool-mode detection understands Chinese requests (查一下／傳到頻道／幫我跑／存成檔案…), not only the English trigger phrases.

### Fixed

- Headless CLI settings are now also written to `<GEMINI_CLI_HOME>/.gemini/settings.json`, which is where current Gemini CLI core actually reads them; previously the auth type, extension-disable and MCP allowlist settings were silently ignored.

- Add release/versioning guardrails with synchronized manifest checks.

## 0.1.1

- Public release maintenance after `v0.1.0`.

## 0.1.0

- Initial public release.
