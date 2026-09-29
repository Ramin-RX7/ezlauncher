# ezlauncher — architecture reference

A map of the codebase for AI agents (and people) doing a task here. Read this **before** grepping: it gives the flow, the file layout, the invariants, and "where to add X" recipes, so you rarely need to open more than the two or three files a change actually touches.

- What to build and why lives in [scopes.md](scopes.md). All eight scopes (00–07) are **implemented**.
- The rules you must follow (security, IPC, styling, files-on-disk, cross-platform) live in [CLAUDE.md](CLAUDE.md). This document does not repeat them; it shows where things are.
- Tests sit next to their file (`foo.ts` → `foo.test.ts`) and are omitted from the file tables below. When you change a file, update or add its test.

---

## 1. The three processes and the boundary between them

```
┌── src/main ─────────────┐   IPC (typed contract)   ┌── src/renderer ────────────┐
│ Electron main process   │ <───────────────────────>│ React UI (no Node/fs)      │
│ all fs, network, spawn  │   src/shared/ipc.ts       │ TanStack Query + store     │
└─────────────────────────┘         ▲                 └────────────────────────────┘
                                     │ contextBridge
                          ┌── src/preload ──┐
                          │ window.api only │
                          └─────────────────┘
```

- **`src/main/`** does every side effect (files, network, child processes). Split into pure core (`minecraft/`, `core/`, `auth/`, `profiles/`, `modsources/`, `validation/`, `settings/` — **no Electron imports**, unit-testable) and the Electron glue (`services/`, `ipc/`, `window.ts`, `index.ts`, `log.ts`).
- **`src/preload/`** exposes exactly one object, `window.api`, with `invoke`, `on`, and `pathForFile`. Nothing else crosses.
- **`src/renderer/`** is React only. It never imports Node, Electron, or `src/main`. ESLint enforces this.
- **`src/shared/`** holds the types both sides use: the IPC contract (`ipc.ts`), the data shapes (`launcher.ts`), and the argument splitter (`args.ts`). No Node or DOM types here.

### Boot flow (`src/main/index.ts`)

1. Single-instance lock; a second launch focuses the running window.
2. `app.whenReady()` → `initFromBootstrap()` reads `bootstrap.json` (in Electron `userData`); if it names a data folder, `startService(dir)` builds the `LauncherService` for it.
3. `registerIpc()` wires every `register…Ipc()` handler.
4. `createMainWindow()` (sandboxed) loads the renderer.
5. Renderer `App.tsx` → `Root()` queries `setup:getState`; with no data folder it shows `SetupPage`, otherwise the `HashRouter` app. Hash routing because the packaged app loads from `file://`.

### The IPC contract (the pattern to copy for any new call)

- **One source of truth:** `src/shared/ipc.ts` declares `IpcInvokeContract` (request/response) and `IpcEventContract` (main→renderer push), plus the runtime allow-lists `INVOKE_CHANNELS` / `EVENT_CHANNELS`. Preload only forwards channels in those lists.
- **Main registers** with `handle(channel, fn)` from `ipc/register.ts`. Thrown `AppError(code, msg)` is caught and returned as `{ ok: false, error: { code, message } }` — errors never cross IPC as exceptions.
- **Main pushes** with `broadcast(channel, payload)` to all windows.
- **Renderer calls** `invoke(channel, ...args)` from `lib/api.ts`, which unwraps `{ ok }` and throws `IpcCallError` (carrying `code`) on failure. `lib/errors.ts` maps a `code` to a localized `errors.*` string (add new codes to its `KNOWN` list **and** to `en.json`).
- **Renderer subscribes** with `useIpcEvent(channel, handler)` or, for store wiring, in `state/LauncherEvents.tsx`.
- Handlers delegate to `getService()` (the per-data-folder `LauncherService`). File dialogs run main-side (in `ipc/mods.ts`, `ipc/setup.ts`) so paths never originate in the renderer.

---

## 2. On-disk data directory layout

Everything is built through `src/main/minecraft/paths.ts` (`createPaths(dataDir)` → `Paths`). The renderer never builds paths; ids are sanitized (`safeId`, `safeFolderName`, `safeJoin`) so renderer input can't escape the folder. The data folder is user-chosen (never hard-coded).

```
<dataDir>/
  versions/<id>/            <id>.json, <id>.jar, natives/, install.json (marker; written last)
  libraries/<maven path>    shared Mojang/loader libraries
  assets/                   indexes/, objects/<2>/<hash>, virtual/, log_configs/
  runtimes/<component>/      downloaded Java, manifest.json, .installed.json
  mods-store/<sha1>.jar      the shared mod library (one copy per unique jar)
  mods-store/icons/<sha1>.png
  profiles/<profileId>/      a profile's game folder: mods/ (hard links into mods-store), saves/, config, options.txt, logs/
  worlds/<worldId>/          every world, whichever profile owns it (ezlauncher-world.json owner flag inside)
  backups/<key>/             world backups: <id>.zip each + index.json (key = world id, or <profileId>~<folder> for an unlinked world)
  launcher/                  profiles.json, accounts.json, settings.json, mods.json, loaders/<id>.json (cache), version_manifest cache
  games/<versionId>/         legacy Scope 01–02 folders, only read to migrate into profiles
```

- **Worlds** live once in `worlds/` and are **directory-linked** into each profile's `saves/` (junctions on Windows, symlinks elsewhere). `links.ts` is the only place that knows link types.
- **Mods** live once in `mods-store/<sha1>.jar` and are **hard-linked** into each profile's `mods/` (a copy where hard links fail, e.g. across drives).
- **Markers** (`install.json`, loader marker) are written **last**, so a half-finished install reads as "not installed".

---

## 3. End-to-end flows (what calls what)

**Install / repair a version** — `installer.ts:installVersion` (via `InstallQueue`, one job at a time): resolve the `inheritsFrom` version-JSON chain (`versionJson.ts`, downloading missing) → fetch asset index → gather library/native/client/asset `FileTask`s (`libraries.ts`, `assets.ts`, rule-filtered by `rules.ts`) → `checkFiles` keeps only missing/bad → `downloader.ts` downloads (concurrent, `.part`, SHA1, retry) → `ensureJava` (`java.ts`) → extract natives (`natives.ts`) → `writeInstallMarker`. Loader installs go through `loaders/installLoader.ts` instead (ensures vanilla, writes the merged loader version JSON with hashes backfilled, then installs its files).

**Launch a game** — `launcherService.launch({profileId, accountId, problems})`:

1. Resolve the account → `AuthProvider.getLaunchIdentity` (offline: MD5 `OfflinePlayer:` UUID, placeholder token).
2. **Refuse** if that account already plays this profile (`ACCOUNT_PLAYING`); several games of one profile are allowed but each needs a different account.
3. `ensureProfileInstall` installs/reuses the version; sync worlds+mods (skipped if the profile is already running).
4. `validateMods` (Scope 05). With errors and `problems:"check"` → return `{status:"blocked", report}` (the UI shows `LaunchProblemsDialog`); `"ignore"` plays anyway; `{disable:[…]}` disables those mods first.
5. `buildLaunchCommand` (`arguments.ts`) assembles argv: `[...jvm, ...extraJvmArgs, mainClass, ...game, ...extraGameArgs]`, memory/args from `resolveLaunchSettings(profile, settings)`. `launchGame` (`gameProcess.ts`) spawns detached; stdout is parsed (`gameLog.ts`) and pushed as `game:log` events keyed by `launchId`; each game writes `logs/ezlauncher-output-<account>.log`.

**Add / enable mods (local)** — jars enter via `mods:addFiles`/`addFromPicker` (picker in `ipc/mods.ts`) or are dropped into `mods/` and adopted on `sync`. `mods.ts:createModLibrary` stores by SHA1, reads metadata (`modInfo.ts`), hard-links into the profile, and enforces one version per `modId`. Each entry records `addedAs` (`user` for picked/dropped/searched mods, `dependency` for what a download pulled in; only ever promoted to `user`); older entries are inferred by `libraryDeps.ts`. The Mod library page nests dependency-only mods under the mods that need them (`components/mods/libraryTree.ts`). Compatibility is `compat.ts:checkCompat` (jar metadata first).

**Download mods (Modrinth)** — `mods:findRemote` → `modrinth.ts:findExact` → `getCompatibleVersion` → `resolveDependencies.ts:resolveInstall` builds a plan (download/reuse/missing/incompatible/replaces) → a `RemoteMatchCard` with a `planId` (kept in memory, 15-min TTL). `mods:installRemote` → `downloadMods.ts:downloadPlan` downloads into the store (SHA1-checked), records source refs, enables everything; a failed/cancelled batch removes only what it added. Hand-added jars are identified by hash in the background (`identifyFiles`, weekly recheck) to earn a Modrinth badge. **Bulk re-fetch** (`bulkFetch.ts:resolveBulk` + `downloadMods.ts:storeVersions`): `downloadLibraryMods` grabs the compatible version of every sourced library mod for a chosen version+loader; `applyProfileMods` does the same for one profile after its version changes, enabling the matches and disabling (but keeping) mods with no compatible version. Progress streams on `mods:bulkProgress`.

**Duplicate a profile / profile icons** — `duplicateProfile(id, { copyWorlds })` copies a profile's settings + enabled-mods set into a new id (worlds are owned by the `ezlauncher-world.json` flag, so the copy claims none of the originals). With `copyWorlds` (a checkbox in `DuplicateProfileDialog`, off by default), `worlds.ts:copyProfileWorlds` copies each world into the new profile's `saves/` without its flag or `session.lock`, and the next sync adopts the copies as the new profile's own; a failed copy removes the new profile again. A profile's `iconId` names a bundled renderer asset (`assets/profile-icons/*.svg`); nothing is written to disk for it.

**Validate mods (Scope 05)** — `collect.ts:collectInput` gathers enabled mods + loader build + Java + integrity file list; `integrity.ts:checkIntegrity` does a quick zip check every launch (full SHA1 only when a file changed); `validate.ts:validate` (pure) returns `issues` + `requiredBy`. Version ranges: `versions/{semver,fabricRange,mavenRange,mcVersion}.ts`. `disableCascade`/`orphanedDependencies` drive "disable problem mods" and the untick cascade. The renderer words issue codes via `issueText.ts`.

**World backups** — `profiles/backups.ts` (no Electron): `createBackup` streams a world into a zip (fflate `ZipDeflate`, `.part` then rename; `session.lock` and the owner flag left out) unless its fingerprint (names + sizes + mtimes, no file reads) equals the newest backup's; `restoreBackup` unpacks into a temp folder (every entry through `safeJoin`) and moves it into `worlds/` as a new world owned by the profile, then a sync links it; `pruneBackups` keeps at most N and none older than D days, never the newest; `backupDue` decides automatic backups. The service runs one backup job at a time (`backup:progress` / `backup:state` events → the navbar `BackupIndicator`); automatic ones run before the start (inside `launch`, Skip continues) or after the last game of a profile closes (after its sync), per settings. Manual backups are refused while the profile plays. Retention is applied after each backup, at start, and when its settings change.

**World sync** — `worlds.ts:syncWorlds`: adopt saves created in-game into `worlds/`, drop worlds deleted in-game, relink each profile's `saves/` from owner flags, report orphans. Runs after the **last** game of a profile exits. `removeTree` never follows links, so deleting a profile can't touch a linked world.

**Move the data folder** — `moveData.ts:moveDataDir`: same drive = `rename`; other drive = copy the tree preserving hard links (so `mods-store` stays shared), re-point world links into the new folder, delete the old one; cancellable, progress via `setup:moveProgress`, then relaunch. Orchestrated in `ipc/setup.ts`; refused while games run or installs are busy.

**Accounts** — `auth/accounts.ts:createAccounts`: add/rename/remove, names unique ignoring case, UUID fixed at creation and kept across rename. Selection lives in `settings.selectedAccountId`.

---

## 4. Feature → where it lives

| Feature                                    | Main                                         | Renderer                                                                                                         |
| ------------------------------------------ | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Version list / install / launch (Scope 01) | `minecraft/*`, `services/launcherService.ts` | `pages/VersionsPage`, `components/versions/*`, `components/play/*`                                               |
| Mod loaders Fabric/Quilt (02)              | `minecraft/loaders/*`                        | loader dropdown in `components/profiles/ProfileEditor`                                                           |
| Profiles & worlds, mod library (03)        | `profiles/*`                                 | `pages/{ProfilePage,NewProfilePage}`, `components/profiles/*`, `components/mods/ModsTab`, `pages/ModLibraryPage` |
| Modrinth download / identify (04)          | `modsources/*`                               | `components/mods/{AddModDialog,RemoteModCard,SourceBadge}`                                                       |
| Mod validation (05)                        | `validation/*`                               | `components/mods/{IssueList,issueText}`, `components/play/LaunchProblemsDialog`                                  |
| Accounts & settings, data move (06)        | `auth/*`, `settings/*`                       | `components/accounts/*`, `pages/SettingsPage`, `components/settings/*`                                           |

---

## 5. File reference

Tests (`*.test.ts[x]`) and `testing/` fake helpers are omitted. One line each: purpose + key exports.

### src/shared

| File          | Purpose / key exports                                                                                                                                                                                                                                                                                                                              |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ipc.ts`      | IPC contract: `IpcInvokeContract`, `IpcEventContract`, `INVOKE_CHANNELS`, `EVENT_CHANNELS`, `IpcResponse`, `IpcError`, `AppInfo`, derived `Invoke*`/`Event*` types                                                                                                                                                                                 |
| `launcher.ts` | All main↔renderer shapes: `Profile`, `ProfileInput`, `LibraryMod`, `ModCompat`, `RemoteMatchCard`, `ValidationReport`/`ValidationIssue`/`ValidationProblem`, `DisablePlan`, `LaunchRequest`/`LaunchResult`, `RunningGame`, `LauncherSettings`, `AccountInfo`, `MoveProgress`, progress/event shapes; consts `PROFILE_NAME_MAX`, `USERNAME_PATTERN` |
| `args.ts`     | `splitArgs` / `joinArgs` (shell-style parse/quote, never executed), `setsMemory`                                                                                                                                                                                                                                                                   |
| `app.ts`      | `APP_DISPLAY_NAME` — the single user-facing app name (`EZLauncher`); technical `ezlauncher` identifiers stay as-is                                                                                                                                                                                                                                 |

### src/preload

| File       | Purpose / key exports                                                                     |
| ---------- | ----------------------------------------------------------------------------------------- |
| `index.ts` | Exposes `window.api`: channel-guarded `invoke`, `on` (returns unsubscribe), `pathForFile` |
| `api.d.ts` | `Api` interface + global `Window.api` augmentation                                        |

### src/main (entry & glue)

| File                          | Purpose / key exports                                                                         |
| ----------------------------- | --------------------------------------------------------------------------------------------- |
| `index.ts`                    | Electron entry: single-instance lock, boot sequence, lifecycle + crash handlers               |
| `window.ts`                   | `createMainWindow()`: sandboxed window, external-link handling, dev/prod URL                  |
| `log.ts`                      | `getLogger()`: lazy app-wide `Logger` into Electron's logs dir                                |
| `ipc/index.ts`                | `registerIpc()` calls each feature's register fn                                              |
| `ipc/register.ts`             | `handle<C>()` (typed handler, errors→`{ok:false}`), `broadcast<C>()`                          |
| `ipc/app.ts`                  | `app:getInfo` (version, platform, total memory)                                               |
| `ipc/launcher.ts`             | versions/loaders/accounts/settings/game channels → `getService()`                             |
| `ipc/profiles.ts`             | profiles CRUD/openFolder, worlds list/move/orphans/openFolder                                 |
| `ipc/mods.ts`                 | mod library/icon/add/enable/remove/remote-search/validate/redownload (dialogs main-side)      |
| `ipc/backups.ts`              | `backups:create/cancel/list/restore/delete/reveal/summary/deleteOrphans/openFolder` → service |
| `ipc/java.ts`                 | `java:list/install/cancel/remove` → service; progress on `java:progress`                      |
| `ipc/setup.ts`                | data-folder state/pick/set/move/cancel; move → `moveDataDir` + relaunch                       |
| `services/current.ts`         | service singleton: `initFromBootstrap`, `startService`, `hasService`, `getService`            |
| `services/launcherService.ts` | **composition root** `createLauncherService(dataDir, logger)`; ~40 methods (see below)        |

`launcherService` methods by area: **versions** `listVersions, installedVersions, installVersion, repairVersion, listLoaders, cancelInstall, deleteVersion`; **profiles** `listProfiles, createProfile, duplicateProfile, updateProfile, deleteProfile, openProfileFolder`; **worlds** `listWorlds, moveWorld, listOrphanWorlds, openWorldFolder`; **mods** `modLibrary, modIcon, addMods, setModEnabled, validateMods, disablePlan, redownloadMod, removeMod, removeUnusedMods`; **remote mods** `findRemoteMods, installRemoteMod, cancelRemoteMod`; **bulk mods** `downloadLibraryMods` (whole library for a version+loader), `applyProfileMods` (re-fetch a profile's mods after a version change; keeps-but-disables no-compat ones), `cancelBulkDownload`; **accounts** `listAccounts, addAccount, renameAccount, removeAccount`; **settings** `getSettings, updateSettings`; **games** `runningGames, launch`; **backups** `backupWorlds, cancelBackup, listWorldBackups, restoreWorldBackup, deleteWorldBackup, revealWorldBackup, backupSummary, deleteOrphanBackups, openBackupsFolder` (`listWorlds` adds `lastBackupAt`/`backupCount`); **java** `listJava, installJava, cancelJavaInstall, removeJava` (version installs wait for a Java install; Java installs are refused while versions install); **data move** `prepareToMove, resumeAfterMove`; plus `paths`.

### src/main/core

| File          | Purpose / key exports                                                                                             |
| ------------- | ----------------------------------------------------------------------------------------------------------------- |
| `errors.ts`   | `AppError` (coded), `toIpcError()`                                                                                |
| `fsAtomic.ts` | `writeFileAtomic`, `writeJsonAtomic`, `readJson` (Zod), `renameWithRetry` (temp-write→rename, Windows lock retry) |
| `logger.ts`   | `createLogger`, `Logger`/`LogLevel`, `LOG_FILE_NAME` (leveled, size-rotating, scoped)                             |

### src/main/minecraft (pure launcher core, no Electron)

| File                       | Purpose / key exports                                                                                                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `paths.ts`                 | `createPaths`/`Paths`, `safeId`, `safeFolderName`, `safeJoin`                                                                                                          |
| `platform.ts`              | `detectPlatform`, `javaPlatformKeys`, `javaExecutableRelPath`, `Platform`                                                                                              |
| `verify.ts`                | `sha1File`, `isFileValid`, `checkFiles`, `CheckMode`                                                                                                                   |
| `fileTask.ts`              | `FileTask` (dest/url/sha1/size), `uniqueTasks`                                                                                                                         |
| `rules.ts`                 | `rulesAllow`, `RuleEnv` (Mojang OS/feature rules)                                                                                                                      |
| `schemas.ts`               | Zod schemas + types for all Mojang/loader JSON (`VersionJson`, `VersionManifest`, `AssetIndex`, `InstallMarker`, `RuntimeManifest`, …)                                 |
| `maven.ts`                 | `parseCoordinate`, `coordinateToPath`, `libraryKey`, `MavenCoordinate`                                                                                                 |
| `natives.ts`               | `extractNatives`                                                                                                                                                       |
| `assets.ts`                | `assetObjectTasks`, `assetIndexId`, `gameAssetsDir`, `applyLegacyAssets`, `RESOURCES_URL`                                                                              |
| `downloader.ts`            | `createDownloader`/`Downloader`, `FetchFn`, `DownloadProgress`; concurrent workers, `.part`+SHA1+retry, abort-all-on-first-failure                                     |
| `manifest.ts`              | `getManifest` (cache-first), `findManifestEntry`, `listInstalledVersions`, `compareVersionSummaries`, `getVersionList`, `MANIFEST_URL`                                 |
| `versionJson.ts`           | `resolveVersion` (merge `inheritsFrom` chain), `mergeVersions`, `diskVersionLoader`, `ResolvedVersion`, `VersionLoader`                                                |
| `libraries.ts`             | `collectLibraries` → classpath + native tasks, `CollectedLibraries`, `MOJANG_LIBRARIES_URL`                                                                            |
| `java.ts`                  | `ensureJava` (download/verify runtime → exe path), `loadJavaAll`, `pickJavaPlatform`, `DEFAULT_JAVA_COMPONENT`, `JAVA_ALL_URL`                                         |
| `javaRuntimes.ts`          | `listJavaRuntimes` (installed + Mojang-offered runtimes, size, which versions use each), `removeJavaRuntime`, `javaUsage`, `javaMajor`, `isJavaComponent`              |
| `patchNotes.ts`            | `createPatchNotes` → `get(versionId)`: Mojang patch notes (index cached, each entry saved once); `PATCH_NOTES_INDEX_URL`                                               |
| `systemJava.ts`            | `detectSystemJava` (JAVA_HOME, PATH, per-OS install folders; reads each `release` file, runs nothing), `parseRelease`                                                  |
| `arguments.ts`             | `buildLaunchCommand` (argv), `flattenArguments`, `substitute`, `LaunchContext`/`LaunchCommand`                                                                         |
| `installer.ts`             | `installVersion`, `readInstallMarker`, `isInstalled`, `writeInstallMarker`, `listDependents`, `deleteVersion`, `clientJarVersionId`, `InstalledVersion`, `InstallMode` |
| `installQueue.ts`          | `InstallQueue` (serialize jobs, cancel, `isBusy`/`isAnyBusy`)                                                                                                          |
| `gameProcess.ts`           | `launchGame`, `GameHandle`/`GameExit`                                                                                                                                  |
| `gameLog.ts`               | `createGameLogParser`                                                                                                                                                  |
| `loaders/types.ts`         | `LoaderProvider`, `LoaderInstallContext`                                                                                                                               |
| `loaders/registry.ts`      | `createLoaderRegistry`, `getSupportedGameVersions`, `LoaderRegistry`                                                                                                   |
| `loaders/fabric.ts`        | `createFabricProvider`, `pickFabricLoader`, `FABRIC_META_URL`                                                                                                          |
| `loaders/quilt.ts`         | `createQuiltProvider`, `pickQuiltLoader`, `compareLoaderVersions`, `QUILT_META_URL`                                                                                    |
| `loaders/installLoader.ts` | `prepareLoader`, `installLoader`, `LoaderInstallRequest`/`LoaderInstallDeps`                                                                                           |
| `loaders/maven.ts`         | `mavenArtifactUrl`, `fetchMavenSha1`, `addMissingHashes`                                                                                                               |
| `loaders/fetchJson.ts`     | `fetchJson` (download + Zod)                                                                                                                                           |

### src/main/auth

| File                   | Purpose / key exports                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| `types.ts`             | `Account`, `AuthProvider`, `LaunchIdentity`                                                 |
| `registry.ts`          | `getProvider(id)` (offline only for now)                                                    |
| `accountStore.ts`      | `createAccountStore(file)` — `accounts.json` load/save                                      |
| `accounts.ts`          | `createAccounts()` — add/rename/remove/list/get; case-insensitive unique names; stable UUID |
| `providers/offline.ts` | `offlineProvider`, `offlineUuid`, `validateUsername`, `OFFLINE_PROVIDER_ID`                 |

### src/main/profiles

| File             | Purpose / key exports                                                                                                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `profiles.ts`    | `createProfileStore(file)`, `sameLoader`; `profiles.json` CRUD; version/loader change clears `installedVersionId`                                                       |
| `links.ts`       | `createDirLink`, `isLink`, `linkTarget`, `removeLink`, `removeTree`, `createHardLink`, `sameFile` — only module that knows link types                                   |
| `worlds.ts`      | `syncWorlds`, `listWorlds`, `listOrphans`, `moveWorld`, `deleteWorld`, `worldsOwnedBy`, `readWorldOwner`, `rescueUnlinkedWorlds`, `uniqueWorldId`, `WORLD_FLAG`         |
| `migrate.ts`     | `migrateLegacyGames`, `MIGRATION_MARKER`                                                                                                                                |
| `nbt.ts`         | `readLevelInfo`, `LevelInfo` (minimal `level.dat` reader)                                                                                                               |
| `backups.ts`     | `createBackup`, `restoreBackup`, `listBackups`, `listBackupFolders`, `deleteBackup`, `deleteBackupFolder`, `pruneBackups`, `backupDue`, `backupKey`, `worldFingerprint` |
| `libraryDeps.ts` | `libraryNeededBy` (which library mods depend on which, via mod id / provides / nested jars), `isDependencyOnly` (recorded `addedAs`, else inferred)                     |
| `modInfo.ts`     | `readModInfo`, `readModInfoFromJar`, `ModInfo`/`ModDep`/`NestedMod`, `UNREADABLE_RANGE` (fabric/quilt/forge + nested jars; never throws)                                |
| `compat.ts`      | `checkCompat`, `acceptedLoaders`, `rangeText` (jar metadata first)                                                                                                      |
| `mods.ts`        | `createModLibrary`, `ModMeta`/`ModSourceRef`/`ModLibrary`, `INFO_VERSION`, `RECHECK_AFTER_MS` (store + hard links + `mods.json`)                                        |

### src/main/modsources

| File                     | Purpose / key exports                                                                                                                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`               | `ModSource`, `ModTarget`, `RemoteProject`/`RemoteVersion`/`RemoteFile`/`RemoteDependency`                                                                                                 |
| `registry.ts`            | `createModSourceRegistry`, `ModSourceRegistry` (`get(id)`)                                                                                                                                |
| `modrinth.ts`            | `createModrinthSource`, `pickVersion`, `MODRINTH_API`/`MODRINTH_SITE`/`HASH_BATCH` (rate-limit-aware `call`, findExact/getCompatibleVersion/getVersion/getProjects/identifyFiles/pageUrl) |
| `resolveDependencies.ts` | `resolveInstall`, `InstallPlan`/`PlanItem`/`LibraryView`                                                                                                                                  |
| `downloadMods.ts`        | `downloadPlan`, `storeVersions` (download into store + `addStored`, shared by bulk), `DownloadModsDeps`                                                                                   |
| `bulkFetch.ts`           | `resolveBulk` — compatible version of each known project for a target (no dep recursion); backs "download library for a version" and "apply mods after a version change"                  |

### src/main/validation

| File                      | Purpose / key exports                                                                     |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| `types.ts`                | `ValidationMod`, `ValidationInput`, `DamageReason`; re-exports `Issue`/`ValidationReport` |
| `validate.ts`             | `validate` (pure), `disableCascade`, `orphanedDependencies`                               |
| `collect.ts`              | `collectInput`, `CollectDeps`/`CollectProfile` (only file/marker access before checking)  |
| `integrity.ts`            | `checkIntegrity`, `jarIndexOpens`, `IntegrityFile`/`IntegrityResult`                      |
| `versions/semver.ts`      | `parseSemVer`, `compareSemVer`, `SemVer`                                                  |
| `versions/fabricRange.ts` | `parseFabricRange`, `matchesFabricRange`                                                  |
| `versions/mavenRange.ts`  | `parseMavenRange`, `matchesMavenRange`                                                    |
| `versions/mcVersion.ts`   | `parseMcVersion`, `McVersionEntry` (release/pre/rc/weekly snapshot → comparable version)  |

### src/main/settings

| File                | Purpose / key exports                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| `bootstrap.ts`      | `readDataDir`, `writeDataDir`, `suggestedDataDir` (`bootstrap.json` in userData)               |
| `settings.ts`       | `createSettingsStore(file)`, `DEFAULT_SETTINGS`, `argsSchema` (`settings.json`, Zod fallbacks) |
| `launchSettings.ts` | `resolveLaunchSettings(profile, settings)` — profile value **replaces** global                 |
| `moveData.ts`       | `moveDataDir`, `MoveResult`/`MoveOptions`/`MoveProgress`                                       |

### src/renderer/src

| Area                         | Files (key export)                                                                                                                                                                                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| entry/shell                  | `main.tsx`, `App.tsx` (`App`/`Root`, routes), `components/AppShell.tsx` (top tab navbar with the account picker + `<Outlet>`), `components/ErrorBoundary.tsx`                                                                                                                                           |
| pages                        | `SetupPage`, `HomePage`, `VersionsPage`, `NewProfilePage`, `ProfilePage`, `ModLibraryPage`, `SettingsPage`                                                                                                                                                                                              |
| play                         | `PlayBar` (also runs a profile row's Play via its `request` prop, so progress and the mod-problems dialog stay in one place), `InstallProgressRow`, `LaunchProblemsDialog`, `GameLog` (one tab per game)                                                                                                |
| accounts                     | `AccountPicker`, `AccountsDialog` (+ `NameForm`)                                                                                                                                                                                                                                                        |
| profiles                     | `ProfileList`, `ProfileEditor` (icon picker + post-version-change "apply mods" prompt), `IconPicker` (dropdown grid), `ProfileIcon` + `profileIcons.ts` (bundled `assets/profile-icons/*.svg`), `WorldsTab` (+ `MoveWorldDialog`), `OrphanWorlds`, `DeleteProfileDialog`, `moveRisk.ts` (`isRiskyMove`) |
| mods                         | `ModsTab` (dependency tree), `AddMods` (drop/pick), `AddModDialog`, `DownloadForVersionDialog` (bulk library download), `RemoteModCard`, `IssueList`, `ModIcon`, `SourceBadge`, `VersionPicker`, `modGroups.ts` (`groupMods`), `compatText.ts`, `issueText.ts`                                          |
| versions                     | `VersionList` (virtualized, tabs, `toolbar` slot, changelog button per row), `ChangelogDialog` + `patchNotesHtml.tsx` (safe HTML → React), `VersionRefresh`, `versionTypes.ts` (`visibleTypes`)                                                                                                         |
| backups                      | `BackupIndicator` (navbar), `BackupsDialog` (restore / show / delete)                                                                                                                                                                                                                                   |
| settings UI                  | `ArgsField`, `DataDirChange`, `BackupSettings`, `JavaSettings` (Settings → Java)                                                                                                                                                                                                                        |
| ui (Radix/Tailwind wrappers) | `Button`, `Checkbox`, `Dialog`, `Input`, `Menu` (+ `ContextMenuArea`: the same items on right-click), `Progress`, `RadioGroup`, `Select`, `Tabs` (`TabBar`), `Tooltip`                                                                                                                                  |
| state                        | `launcherStore.ts` (`launcherStore`, `useLauncherState`; `{installs, running, games, lastExit}` via `useSyncExternalStore`), `LauncherEvents.tsx` (event→store bridge + query invalidation), `queries.ts` (`keys`, `useProfiles/useLoaders/useVersionList/useAccounts/useSettings/useSelection`)        |
| lib                          | `api.ts` (`invoke`, `IpcCallError`, `pathForFile`), `errors.ts` (`errorMessage`, `KNOWN`), `queryClient.ts`, `useIpcEvent.ts`                                                                                                                                                                           |
| theme                        | `ThemeProvider.tsx`, `theme.ts` (`applyThemeMode`, localStorage), `useTheme.ts`                                                                                                                                                                                                                         |
| i18n                         | `index.ts` (i18next init), `i18next.d.ts` (type-checks `t('key')`), `locales/en.json` (**the string table**)                                                                                                                                                                                            |
| styles/html                  | `styles/theme.css` (`--ezl-*` tokens + `@theme inline` → Tailwind names), `index.html` (CSP `<meta>`)                                                                                                                                                                                                   |

---

## 6. Conventions & invariants (don't break these)

- **Add a feature the existing way.** Core modules take their deps as arguments (`paths`, `downloader`, `platform`, `fetch`, `logger`) so they stay Electron-free and testable — never import `electron` under `minecraft/`, `core/`, `auth/`, `profiles/`, `modsources/`, `validation/`, `settings/`.
- **All UI text** goes through i18n keys in `en.json` (`t('…')` is type-checked). No hard-coded user-facing strings.
- **Styling** uses theme tokens only (`bg-surface`, `text-muted`, `rounded-ezl`, …) and logical properties (`ms-`, `pe-`, `start-`, `border-e`) for RTL. No raw colors.
- **JSON on disk**: write with `writeJsonAtomic`, read with `readJson(path, schema)`. Validate every JSON from disk or network with Zod. Build every path through `paths.ts`.
- **Never bundle/re-host Mojang files**; always download and verify by SHA1; skip already-valid files; obey library `rules`; treat version ids as opaque, sort by `releaseTime`.
- **Offline identity**: UUID = `nameUUIDFromBytes("OfflinePlayer:" + name)` (MD5 v3), generated once and stored; renaming keeps it.
- **Concurrency**: `LauncherService` runs folder work through `serialFs`; the mod library and profile/account stores each serialize their own writes. Installs go through `InstallQueue`. Don't add parallel writers to the same JSON.
- **While a profile's game runs**, block editing it, changing its mods/worlds, deleting it, and repairing/deleting its version (`assertNotRunning`, `assertVersionNotPlayed`). Sync only after the last game exits.

---

## 7. "Where do I add…?" recipes

- **A new IPC call** → declare it in `shared/ipc.ts` (contract + `INVOKE_CHANNELS`/`EVENT_CHANNELS`), add a `handle()` in the right `ipc/*.ts`, add a method on `launcherService.ts`, call it from the renderer via `invoke()`. New error codes → `lib/errors.ts` `KNOWN` + `en.json` `errors.*`.
- **A new page/route** → add the page in `pages/`, a `<Route>` in `App.tsx`, and a nav link in `components/AppShell.tsx`.
- **A new mod source** (e.g. CurseForge) → implement the `ModSource` interface in `modsources/<site>.ts`, register it in `modsources/registry.ts`. `resolveDependencies.ts`, `downloadMods.ts`, and the whole UI already work through the interface.
- **A new mod loader** (Forge/NeoForge) → implement `LoaderProvider` in `minecraft/loaders/<loader>.ts`, register in `loaders/registry.ts`; extend `acceptedLoaders` in `profiles/compat.ts` if it loads others' mods.
- **A new setting** → add the field to `LauncherSettings` (`shared/launcher.ts`), the file+patch schema and `DEFAULT_SETTINGS` (`settings/settings.ts`), and UI in `pages/SettingsPage.tsx`. A per-profile override also goes through `resolveLaunchSettings` and the profile schema.
- **A new validation check** → add it in `validation/validate.ts` (pure), a `ValidationProblem` variant in `shared/launcher.ts`, wording in `components/mods/issueText.ts` + `en.json`.
- **A new i18n string** → add it under the right top-level key in `en.json` (`app, nav, setup, versions, loaders, play, log, settings, errors, profiles, worlds, accounts, versionsPage, mods, remote, validation, launchProblems`).

---

## 8. Tooling & tests

- Commands (see CLAUDE.md): `npm run dev`, `npm run build`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`. Node-only launcher CLI: `npm run mc -- <list|install|check|command|launch> [id] --data <dir>`.
- **Before finishing any change:** `npm run typecheck && npm run lint && npm run format:check && npm test`.
- **Tests** (Vitest): Node environment for `src/main` + `src/shared`, jsdom for `src/renderer` (`src/renderer/src/test/setup.ts` adds jest-dom + a `ResizeObserver` stub). Core modules test with fakes — `minecraft/testing/{fakeFetch,fakeMojang}.ts`, `modsources/testing/fakeModSource.ts`, `profiles/testing/*` — and never touch the network or a real data folder. Renderer tests use `src/renderer/src/test/{mockApi,fixtures}.ts`.
