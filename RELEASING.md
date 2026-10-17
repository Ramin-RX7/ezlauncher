# Releasing

How a new EZLauncher version gets from `master` to a GitHub release.

## How it fits together

| Piece                                                          | Role                                                                                                             |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [CHANGELOG.md](CHANGELOG.md)                                   | Every user-facing change goes under `## [Unreleased]` as it lands.                                               |
| `npm version`                                                  | Checks, bumps `package.json`, turns `[Unreleased]` into the new version, commits and tags `v<version>`.          |
| [.github/workflows/ci.yml](.github/workflows/ci.yml)           | Type check, lint, format check and tests on every push to `master` and every pull request.                       |
| [.github/workflows/release.yml](.github/workflows/release.yml) | On a `v*` tag: checks, builds on Windows and Linux, and creates a **draft** release with the files.              |
| [electron-builder.yml](electron-builder.yml)                   | What gets built: Windows installer, portable exe and portable zip (x64), Linux AppImage (x64).                   |
| [.github/workflows/feed.yml](.github/workflows/feed.yml)       | When a release is **published**: adds it to `releases.json` (the app's update feed) and pushes that to `master`. |
| [releases.json](releases.json)                                 | The update feed: every published version with its notes, file names, sizes and SHA-256. Bot-written.             |
| [.github/release-footer.md](.github/release-footer.md)         | Download table and notes appended below the changelog section in every release description.                      |

The app reads its version from `package.json` (About screen, logs, User-Agent), so there's nothing else to update.

## While developing

Add a line to `CHANGELOG.md` under `## [Unreleased]` with each feature or fix, grouped under `### Added`, `### Changed`, `### Fixed`, …. Write it for users, not as a commit message.

## Making a release

1. Be on an up-to-date, clean `master` (`git pull`; untracked files are fine).
2. Check `## [Unreleased]` in `CHANGELOG.md` reads well: it becomes the release description.
3. Bump the version. Pick one:

   ```bash
   npm version patch        # 0.1.0 -> 0.1.1   bug fixes only
   npm version minor        # 0.1.0 -> 0.2.0   new features
   npm version major        # 0.1.0 -> 1.0.0   breaking changes / first stable
   npm version 0.3.0        # an exact version
   ```

   This runs the checks (`preversion`), updates `package.json` and `package-lock.json`, moves `[Unreleased]` to `## [x.y.z] - <today>` (`version`), then commits `[release] vx.y.z` and creates the tag `vx.y.z`. If a check fails or `[Unreleased]` is empty, nothing is changed.

4. Push the commit and the tag:

   ```bash
   git push --follow-tags
   ```

5. Watch **Actions → Release** on GitHub (about 10 minutes). When it finishes, a draft appears under **Releases**.
6. Open the draft, download the installer and give it a quick try. Edit the description if you like, then click **Publish release**. GitHub adds the source code archives by itself.
7. Publishing runs **Actions → Update feed**: it adds the version to `releases.json` and pushes a commit `[release] feed vx.y.z [skip ci]` to `master`. From then on, launchers that check for updates offer it (within a day, or at once with Settings → Check for updates). Run `git pull` before your next change.

While the version is `0.x`, minor versions may still break things; go to `1.0.0` when you consider it stable.

### The first release

`package.json` already says `0.1.0`, and `npm version` refuses to "bump" to the same version. For the very first release run:

```bash
npm version 0.1.0 --allow-same-version
git push --follow-tags
```

### Pre-releases (betas)

A version with a `-` suffix becomes a GitHub **pre-release**, which is never shown as "Latest":

```bash
npm version preminor --preid beta   # 0.1.0 -> 0.2.0-beta.0
npm version prerelease              # 0.2.0-beta.0 -> 0.2.0-beta.1
npm version minor                   # 0.2.0-beta.1 -> 0.2.0 (the final release)
```

Each one needs entries under `[Unreleased]`, so every beta gets its own changelog section.

## Testing a build without releasing

- **On GitHub:** Actions → Release → **Run workflow**. It builds on Windows and Linux but creates no release; download the files from the run's **Artifacts** (kept 7 days).
- **Locally:** `npm run package:win` puts the installer, portable exe and portable zip in `release/`. The Linux AppImage can only be built on Linux (or WSL).

## Updates in the app

- The launcher reads `releases.json` from `master` (`raw.githubusercontent.com`) and downloads the files from the release, so **the repository and its releases must be public**.
- Only stable versions are offered; a pre-release (`-beta.1`) is in the feed but skipped.
- Each build downloads its own file: installer → `-setup.exe`, portable exe → `-portable.exe`, portable zip → `-portable.zip`, AppImage → `.AppImage`. Keep those names (electron-builder.yml) or the feed script won't find the files.
- **Never edit `releases.json` by hand**, except to remove a broken release (that stops it being offered). To add or redo a published release's entry, run **Actions → Update feed → Run workflow** with its version.
- Testing an update locally: build two versions (`npx electron-builder --win zip portable --publish never -c.extraMetadata.version=0.2.1 -c.directories.output=<dir>`), serve a `releases.json` for the newer one, and start the older with `EZL_UPDATE_FEED=<url>` (any download URL allowed then), `EZL_USER_DATA=<scratch folder>` (so it never opens your real data folder) and optionally `EZL_UPDATE_TEST=install` (checks, downloads and installs by itself).

## When something goes wrong

- **A job failed for a flaky reason** (network, runner): open the run and click **Re-run failed jobs**. Re-running updates the existing draft instead of making a second one.
- **The tag doesn't match `package.json`:** the release was tagged by hand. Always tag with `npm version`.
- **The build is broken and the draft isn't published yet:** fix it on `master`, then move the tag to the fixed commit:

  ```bash
  git tag -d v0.2.0 && git push origin :refs/tags/v0.2.0   # delete the tag locally and on GitHub
  git tag -a v0.2.0 -m "[release] v0.2.0"                  # tag the fixed commit
  git push origin v0.2.0
  ```

  Delete the old draft on GitHub first if it exists. Never move a tag of a **published** release: release a new patch version instead.

## What users see

- The portable exe and the portable zip keep their settings in the user's AppData, like the installed app, so all of them use the same data folder. The exe starts a bit slower because it unpacks itself on each start; the zip is the same app already unpacked.
- Every build checks for updates once a day (Settings → About turns it off, or checks now) and offers new versions in a banner; the user chooses when to download and restart.
- Uninstalling never deletes settings or the data folder (worlds, backups, mods).
- macOS isn't built: without a paid Apple developer account the app can't be notarised, and macOS won't open it.
