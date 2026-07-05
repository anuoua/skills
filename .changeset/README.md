# Changesets

This folder is managed by [`@changesets/cli`](https://github.com/changesets/changesets),
which handles versioning and publishing across the packages in this monorepo.

## Adding a changeset

When you make a change that should be released, run from the repo root:

```bash
pnpm changeset
```

You'll be prompted to select:

1. **The package** affected (e.g. `@askills/agent-chat`).
2. **Bump type** — `major` / `minor` / `patch`.
3. **A summary** message — this becomes the changelog entry.

This creates a markdown file next to this README describing the pending change.

## Releasing

Releases are automated via the `Release` GitHub Actions workflow on every push to
`develop`. When changesets are present, a "Version Packages" pull request is
opened automatically; merging it publishes the new version(s) to npm.

Manual release (if needed):

```bash
pnpm version    # consume changesets, bump versions + CHANGELOG
pnpm release    # publish to npm
```
