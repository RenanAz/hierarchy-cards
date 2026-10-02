# Contributing / working on these cards

## Layout

```
src/        the two card modules (edit these)
dist/       built bundle, committed (do not edit by hand)
build.mjs   zero-dependency build: concatenates src/* into dist/
```

## The one rule

**Never edit `dist/hierarchy-cards.js` directly.** Edit `src/`, then:

```bash
npm run build
```

and commit both the source and the rebuilt bundle in the same commit. The
release workflow fails the build if `dist/` is stale, and `.gitignore` keeps
`dist/` tracked on purpose (HACS installs it straight from the repo).

## Commit messages

Conventional Commits, matching the history already in this repo:

```
<type>(<scope>): <subject>

<body: why, not what>
```

Types in use: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `ci`.
Scopes in use: `sizing`, `config`, `energy`, `power`, `build`, `ci`.

Keep the body focused on **why** the change is needed and what it replaces.
Reference the previous behaviour when changing it.

## Adding a change

1. Branch: `git switch -c fix/short-description`
2. Edit `src/…`, `npm run build`
3. Commit source + `dist/` together
4. Update `CHANGELOG.md` under `[Unreleased]`
5. Open a PR; the `Validate` workflow runs the HACS action

## Releasing

1. Move `[Unreleased]` items into a new version heading in `CHANGELOG.md`
2. Bump `version` in `package.json`
3. `npm run build` and commit
4. `git tag vX.Y.Z && git push origin vX.Y.Z`

The `Release` workflow builds, verifies `dist/` matches, and publishes the
GitHub Release with the bundle attached. HACS reads **releases**, not tags.

## Milestone note

`763e960` is the imported baseline: the cards exactly as they ran before this
repository existed. Everything above it is a reviewable change. `git diff
763e960..HEAD` shows the full delta from the original code.
