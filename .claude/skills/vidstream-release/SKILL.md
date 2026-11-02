---
name: vidstream-release
description: Release checklist for vidstream-player, which is distributed from its public GitHub repo (not npm) — version bump in every place it lives, build/test verification on a fresh clone, changelog/migration notes, git tag + GitHub release, and pointing consuming projects and the docs site at the new tag. Use whenever the user wants to bump the version, cut or prepare a release, tag, write release notes or a changelog entry, update projects to the latest player, or "ship"/"push out" fixes or features of vidstream-player.
---

# Releasing vidstream-player (GitHub distribution)

Since 2026-11-02 the owner **does not publish to npm**. The npm 2.0.0 release is frozen; never run `npm publish` or `npm run publish:npm`. Consumers install from the public repo:

```bash
npm install github:antor-arif/vidstream-player#v2.1.0     # pin a tag (recommended)
npm install github:antor-arif/vidstream-player            # tracks main (not reproducible)
```

`dist/` is gitignored. npm clones the repo, installs devDependencies and runs the `prepare` script (`npm run build`), then packs according to `files: ["dist", "README.md"]`. Pnpm and yarn behave the same way. So **a release is only good if a fresh clone builds with nothing but `npm ci`**.

Repos (both `main`):
- github.com/antor-arif/vidstream-player
- github.com/antor-arif/vidstream-player-docs (Netlify deploys from `main`)

Pushing, tagging and creating GitHub releases are outward-facing. Prepare everything locally, show the user the summary, and get an explicit yes before `git push`, `git tag` or `gh release create`. The owner often pushes themselves; ask instead of assuming.

## 1. Pick the version (semver)
- **Patch**: fixes with no API change.
- **Minor**: new options, methods, events, exports, aliases or behaviour.
- **Major**: removing or renaming any public API (exports, options, events, CSS classes, `<video-player>`), or changing a default users rely on. Needs a migration section in the docs.

## 2. Bump the version
- Run `npm version <x.y.z> --no-git-tag-version` inside `Vidstream-player/`. This updates package.json and the lockfile.
- `VERSION` and `VidstreamPlayer.version` come from package.json automatically (`src/version.ts` plus the build `define`). The fallback string in `src/version.ts` only matters for raw-source use; keep it equal to the new version.
- Docs: update the Navbar badge (`src/components/layout/Navbar.tsx`) and the changelog "Current" label.

## 3. Verify
In `Vidstream-player/`:
```bash
npx tsc --noEmit && npm run lint && npm test && npm run build
```

Then do a fresh-clone check. This is what consumers actually get:
```bash
git clone <repo or local path> /tmp/vs && cd /tmp/vs && npm ci     # prepare builds dist/
npm pack                                                            # inspect the tarball
# in an empty project:
npm install /tmp/vs/vidstream-player-<v>.tgz react@18 react-dom@18
node --input-type=module -e "const m=await import('vidstream-player'); await import('vidstream-player/react'); console.log(m.VERSION)"
node -e "require('vidstream-player/react')"
```
(Use the session scratchpad instead of /tmp.)

Run the browser harness from the `vidstream-player` skill for the areas the release touched. That includes `assets/umd.html` if the build changed.

## 4. Release notes
- Docs repo: add a top entry to `src/app/docs/changelog/page.mdx` (version, YYYY-MM-DD; Added / Changed / Fixed / Deprecated / Removed / Breaking).
- Breaking changes also go in `getting-started/migration`.
- Update the player README (GitHub shows it). Its install instructions must use the `github:` form, not `npm install vidstream-player`.
- Mark fixed items in `vidstream-player/references/known-issues.md` and `vidstream-docs/references/docs-drift.md`.

## 5. Commit, tag, push (after approval)
```bash
git add -A && git commit -m "chore(release): vX.Y.Z"     # add the session's attribution trailer
git tag vX.Y.Z
git push origin main --tags
gh release create vX.Y.Z --title "vX.Y.Z" --notes-file <notes.md>   # optional
```

## 6. Update consumers
- Bump each consuming project's dependency to `github:antor-arif/vidstream-player#vX.Y.Z`, then `npm install`.
- The docs site still pins the frozen npm `vidstream-player@2.0.0`. Switch it to the GitHub tag so its LiveDemo and Playground run the current player, then `npm install && npm run build`.
- Apps that link the repo locally (`file:`), such as `Test/*`, need Vite `resolve.dedupe: ['react','react-dom']`, because the repo has react as a devDependency.
