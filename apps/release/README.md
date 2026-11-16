# Releasing

Packages are versioned with [Changesets](https://changesets.dev), each on its own semver, and published to npm by CI
only, through [trusted publishing](https://docs.npmjs.com/trusted-publishers): no npm token exists on any machine or
in the repository.

```
pnpm release              what the next release holds
pnpm release add          write a changeset for your change
pnpm release check        build and pack every package as npm would get it, install it fresh, import it
pnpm release pre <tag>    enter a prerelease (alpha, beta, rc); pre exit leaves it
pnpm release bootstrap    once per new package: its name on npm, linked to CI
pnpm release version      apply the changesets (CI runs this)
```

## A change

1. Make the change. If users will notice it, run `pnpm release add`: pick the packages, the bump, and write the line
   for the changelog. Commit the file it writes with your change. Without a terminal, pass the flags of `changeset add`:
   `pnpm release add --patch @ji.dev/llm -m "Fix the retry delay"`.
2. While in 0.x, **minor** is the breaking release and **patch** carries fixes and additions. Picking **major** makes
   the package 1.0.0.
3. A package that depends on one you bump is released along with it when the new version leaves its range;
   `pnpm release` lists those with the reason.

## A release

1. When a push to main changes a changeset or a `package.json`, [release.yml](../../.github/workflows/release.yml)
   opens or updates the one **Version Packages** PR: new versions, changelogs, and the desktop app's version in
   `apps/desktop/mygo.json`. Other pushes (the site, the desktop app's code) leave it alone.
2. Merging that PR is the release. CI runs `pnpm release check`, packs the packages, publishes them, and pushes a tag
   per package (`@ji.dev/llm@0.1.0`). If publishing stops halfway, run the Release workflow again from the Actions tab
   (main only): it publishes only the versions npm does not have yet.

## Prerelease

`.changeset/pre.json` says whether a prerelease is on. In one, versions end in `-alpha.N` and publish to the `alpha`
dist-tag, so `npm i @ji.dev/llm` keeps the stable version (or, before the first stable one, the placeholder, whose
description points to `@alpha`). Move to beta with `pnpm release pre beta`; finish with `pnpm release pre exit`,
after which the next Version Packages PR makes the stable versions on `latest`.

## Setup, once

1. **A license.** `pnpm release check` fails until every package has one: add a `LICENSE` and a `"license"` field.
2. **Package names on npm.** Trusted publishing can only be set up for a package that exists. Logged in to npm
   (`npm login`), run `pnpm release bootstrap`: it publishes a 0.0.0 placeholder for each name not on npm (asking
   once), then links those packages to `baoziv587/Ji` `release.yml`. With every name already on npm, it links all of
   them; `pnpm release bootstrap llm tui` links only those. npm asks for two-factor authentication in the browser for
   each publish and each link, and will not say without it whether a package is linked, so a run that stops halfway
   prints the command that finishes the rest. `--dry-run` says what it would do. Run it again when adding a package.
3. **GitHub.** In Settings → Actions → General, allow GitHub Actions to create and approve pull requests. Install the
   [Changesets bot](https://github.com/apps/changeset-bot) for a comment on pull requests without a changeset (it
   never blocks a merge).
4. **Optional: CI on the Version Packages PR.** A PR opened with the workflow's own token starts no workflows. To have
   CI run on it, create a GitHub App with contents and pull requests write access, install it on the repository, and
   set `vars.RELEASE_APP_CLIENT_ID` and `secrets.RELEASE_APP_PRIVATE_KEY`.

## Building

`pnpm build` builds every published package with [tsdown](https://tsdown.dev) from the root `tsdown.config.ts`. A
package's `exports` and `bin` keep pointing at its sources, which is how the workspace runs it; the build writes the
`dist/` paths into `publishConfig`, which pnpm swaps in when packing. Commit `package.json` when the build changes it
(after adding an export); CI fails otherwise.
