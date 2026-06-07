# Agent Instructions

These instructions are for automated coding agents and contributors working on
`gemini-discord`. The goal is useful, reviewable maintenance, not activity for
its own sake.

## Scope Discipline

- Work from an assigned GitHub issue, maintainer request, or clearly stated bug.
- Keep each PR focused on one problem. Avoid bundled refactors, formatting churn,
  dependency churn, or broad cleanup unless the issue explicitly asks for it.
- Do not open PRs that only rename things, reshuffle prose, chase contribution
  graphs, or add low-value "improvements" without a concrete user or maintainer
  benefit.
- Fix root causes. Do not hide failures, weaken safety defaults, or add
  configuration switches just to avoid understanding the problem.
- Preserve existing behavior unless the task explicitly changes it.

## Required Workflow

1. Read the relevant code and docs before editing.
2. State the intended behavior in the issue or PR description.
3. Add or update focused tests for behavior changes and bug fixes.
4. Make the smallest code/doc change that satisfies the task.
5. Update README, docs, examples, or configuration reference whenever setup,
   runtime behavior, commands, APIs, or safety defaults change.
6. Run the relevant checks before claiming the work is ready.

## Quality Gates

```bash
npm ci
npm run typecheck
npm run build
npm test
```

If a check is not relevant or cannot be run, say exactly why in the PR. The
release package includes `dist/`, so rebuild and commit `dist/` when source
changes affect bundled outputs.

## Safety And Privacy

- Never commit real Discord IDs, bot tokens, API keys, `.env`, logs, databases,
  `.gemini-discord/`, or runtime state.
- Keep the default posture conservative: boss-only authority, guests disabled,
  mention-only server responses, and no fallback target channel.
- Do not expose new shell, filesystem, network, moderation, or outbound Discord
  powers without explicit authorization and tests for the permission boundary.
- Treat public contributors respectfully, but do not reward noisy or low-signal
  PRs with extra scope.

## Release Boundaries

- Do not push branches, create releases, move tags, or publish packages unless a
  maintainer explicitly asks for that action.
- Version bumps should keep `package.json`, `package-lock.json`,
  `gemini-extension.json`, and runtime client metadata aligned.
- Existing tags are immutable unless maintainers explicitly decide otherwise.
