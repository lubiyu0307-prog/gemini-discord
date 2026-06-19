# Release Process

This repository uses manual, guarded releases. Do not publish packages, create GitHub releases, or move tags unless a maintainer explicitly asks for that action.

## Version Policy

Use Semantic Versioning:

- `MAJOR`: breaking configuration, command, permission, storage, or API changes.
- `MINOR`: backward-compatible features and user-visible workflow additions.
- `PATCH`: backward-compatible bug fixes, documentation, and maintenance.

Pre-`1.0.0`, prefer `MINOR` for meaningful new capabilities and `PATCH` for fixes or documentation. Treat permission and safety changes conservatively even before `1.0.0`.

## Source Of Truth

`package.json` is the source of truth. The version must stay synchronized across:

- `package.json`
- `package-lock.json`
- `gemini-extension.json`
- `src/shared/version.ts`
- generated `dist/` output after `npm run build`

CI runs `npm run version:check` to catch drift before build and `git diff --exit-code -- dist/server.cjs dist/daemon.cjs dist/setup.cjs dist/install-service.cjs` after build to catch stale generated files.

## Bump A Version

```bash
npm run version:bump -- 0.1.2
npm run version:check
npm run build
npm test
```

For source changes, also run:

```bash
npm run typecheck
```

The broader local gate is:

```bash
npm run check
```

Update `CHANGELOG.md` in the same commit as the version bump. Move entries from `Unreleased` under the new version heading.

## Tag A Release

Only tag after the release commit is merged to the release branch and all required checks pass.

```bash
git tag v0.1.2
git push origin v0.1.2
```

Do not retag an existing version. If a release needs a correction, create a new patch version.
