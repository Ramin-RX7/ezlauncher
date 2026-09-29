# Scopes

The project is built in small scopes, one after another. Each scope is self-contained: build only what the current scope describes.

## Scope 00: Project setup (done)

The base every later scope builds on. No Minecraft logic.

- **Tooling**: Electron 44, electron-vite 5 (Vite 7), TypeScript 6 strict, ESLint (type-aware, with rules that enforce the process boundaries), Prettier, Vitest (a Node project and a jsdom project), electron-builder (Windows NSIS, Linux AppImage, macOS dmg).
- **Main process** (`src/main/`): single-instance lock (a second start focuses the running window), a secure `BrowserWindow` (sandbox, context isolation, no Node in the page, navigation and new windows blocked, external links opened in the system browser), a logger with rotating files in the OS logs folder, and logging of uncaught errors.
- **Core helpers** (`src/main/core/`): `writeFileAtomic` / `writeJsonAtomic`, `readJson(path, zodSchema)`, `AppError`.
- **IPC**: one typed contract in `src/shared/ipc.ts`; `handle()` in main returns `{ ok, value }` or `{ ok: false, error }`; the preload forwards only the contract's channels; the renderer's `invoke()` throws `IpcCallError`. Example channel: `app:getInfo`.
- **Renderer**: React 19 with hash routing, an app shell (sidebar with Home and Settings), an error boundary, TanStack Query, Tailwind 4 theme tokens with light/dark/system switching, i18next (English, `dir`/`lang` kept in sync for right-to-left later), and Radix-based `Button`, `Dialog`, `Tooltip`.
- **Packaging**: `build/icon.png` is a placeholder; no code signing yet.

## Scope 01: Core launcher (list, install, launch, switch versions)

### Goal

The user can pick any Minecraft version, install it, play it offline, switch to another version, and come back to the first one **without downloading it again**. Several versions can be installed side by side.

### User flow

1. Open the launcher. It shows the version list (filter: releases / snapshots / old beta & alpha). Installed versions are marked.
2. Enter an offline username (saved for next time).
3. Pick a version, then press **Play**.
   - Not installed: install it with progress (files, bytes, current step), then launch.
   - Installed: run a quick check and launch right away.
4. Pick another version and press **Play**. It installs and launches; the first version is untouched.
5. Go back to the first version. It launches with no download, **even with no internet connection**.

### Storage layout

Everything lives under the user-chosen data directory (`<data>`). Files that don't belong to one version are **shared** and downloaded only once.

```
<data>/
  versions/<id>/<id>.json        version JSON (per version)
  versions/<id>/<id>.jar         client jar (per version)
  versions/<id>/natives/         extracted native libraries (per version)
  versions/<id>/install.json     install marker (written last)
  libraries/<maven path>         shared by all versions
  assets/indexes/<index>.json    shared
  assets/objects/<xx>/<hash>     shared, one file per hash
  runtimes/<component>/          Java runtimes, shared (e.g. java-runtime-epsilon)
  games/<versionId>/             game directory per version: saves/, options.txt, screenshots…
  launcher/settings.json         launcher settings
  launcher/accounts.json         accounts
  launcher/version_manifest.json cached version list
```

- **Suggested data folder** (first start): `%APPDATA%\.ezlauncher` on Windows, `~/.ezlauncher` on Linux, `~/Library/Application Support/ezlauncher-data` on macOS. It must not be Electron's own userData folder, which holds browser caches.
- **Where the data directory itself is saved**: `<data>` is user-chosen, so its path can't be stored inside it. Store it in `bootstrap.json` in Electron's `app.getPath('userData')`. The first start with no `bootstrap.json` asks the user where to keep data.
- **Game directory per version** (`games/<versionId>/`): each installed version has its own folder for worlds and settings, so a world from a newer version is never opened by an older one. Get this path only from `paths.gameDir(versionId)`, never build it anywhere else, so later scopes can change it in one place.
- Very old versions whose assets are marked `map_to_resources` / `virtual` get their assets copied into `games/<versionId>/resources/` or `assets/virtual/legacy/` respectively.

### Install and "already installed" logic

- **Downloads**: write to `<file>.part`, check the SHA1, then rename into place. A crash or cancel never leaves a corrupt file under the real name.
- **Skip existing files**: if the file exists with the right size (and hash, when doing a full check), don't download it. Libraries and assets that another version already downloaded are reused automatically.
- **Install marker**: after every file is in place, write `versions/<id>/install.json` (`{ versionId, installedAt, schema: 1 }`). Write it to a temp file and rename it so it appears in one step. No marker means not installed.
- **Before launch** (installed versions): quick check that every required file exists and has the right size. Re-download only the missing or wrong ones. No network needed if nothing is missing.
- **Repair** (button on the version): full SHA1 check of every file.
- **Delete version**: remove `versions/<id>/` only. Shared libraries and assets stay (cleaning them up is a later scope). Ask before also deleting `games/<versionId>/`, because it holds the user's worlds.
- One install runs at a time; more requests wait in a queue. Installs can be cancelled.
- Parallel downloads (about 8–16 at once), with retries and backoff.

### Version list

- Fetch `version_manifest_v2.json` from Mojang **only when there's no saved copy yet**, and save it in `launcher/version_manifest.json` with the time it was fetched.
- After that, always use the saved list (no network request on start). A **Check for new versions** button refreshes it on demand and reports how many new versions appeared; the list shows "Version list from <date>".
- A refresh that fails keeps the saved list and says there's no internet connection. With no saved list and no internet, show an empty state with **Try again**.
- Installed versions (from `versions/*/install.json`) always appear, even with no saved list.
- Sort by `releaseTime`, newest first.

### Java

- Use `javaVersion.component` from the version JSON (e.g. `java-runtime-epsilon`). If it's missing (old versions), use `jre-legacy`.
- Download the runtime from Mojang's Java runtime manifest into `runtimes/<component>/`. It's shared by every version that needs it.
- Linux ARM has no Mojang runtime: show a clear error for now.
- Windows ARM and Apple Silicon have no Mojang Java 8 (`jre-legacy`): fall back to the x64 runtime, which runs under emulation. This also makes old x64-only native libraries work.
- Runtime files are downloaded uncompressed (`raw`). Using the `lzma` downloads would cut Java's download to about a third; a possible later improvement.

### Authentication (abstract)

The launch code never knows *how* a user logged in. It only receives a `LaunchIdentity`.

```ts
interface LaunchIdentity {
  username: string;     // ${auth_player_name}
  uuid: string;         // ${auth_uuid}, no dashes
  accessToken: string;  // ${auth_access_token}
  userType: string;     // ${user_type}: "legacy" (offline), "msa" later
  xuid?: string;        // ${auth_xuid}
  clientId?: string;    // ${clientid}
}

interface Account {
  id: string;           // local id
  providerId: string;   // "offline" | later "microsoft" ...
  username: string;
  uuid: string;
  data?: unknown;       // provider-specific (tokens later)
}

interface AuthProvider {
  id: string;
  displayName: string;
  createAccount(input: unknown): Promise<Account>;         // offline: { username }
  getLaunchIdentity(account: Account): Promise<LaunchIdentity>; // may refresh tokens later
  removeAccount?(account: Account): Promise<void>;
}
```

- Code lives in `src/main/auth/`: `types.ts`, `registry.ts` (holds the providers by `id`), `providers/offline.ts`.
- **Offline provider**:
  - Username rules: 3–16 characters, `A-Z a-z 0-9 _`.
  - UUID: generated **once when the account is created** as `nameUUIDFromBytes("OfflinePlayer:" + name)` (MD5, version 3), then stored. Never recompute it from the name (see Scope 06).
  - Access token: a placeholder. User type: `legacy`.
- Accounts are saved in `launcher/accounts.json`, with the selected account remembered. Later providers must store secrets with Electron `safeStorage`, never as plain text.
- Adding Microsoft login later = one new provider file plus UI to sign in. Nothing in the install or launch code changes.

### Launch

1. Resolve the version JSON. Support `inheritsFrom` in the code structure even though vanilla doesn't use it; mod loaders will.
2. Apply the `rules` (OS, architecture, features) to libraries and arguments.
3. Build the classpath (libraries plus the client jar) using the OS path separator.
4. Fill in the `${...}` placeholders in the JVM and game arguments. Support both `arguments` (new) and `minecraftArguments` (old).
5. `spawn(javaPath, args, { cwd: paths.gameDir(versionId), detached: true })`, then apply the launcher setting (keep open / minimise / close).
   - The game's output goes to a **file** (`<gameDir>/logs/ezlauncher-output.log`), not a pipe, so the game keeps running if the launcher closes.
6. While the launcher is open: follow that file for the log view and report the exit code or crash. The game prints log4j XML (from Mojang's log config); the launcher turns it into readable lines.
7. Settings in this scope: RAM (`-Xmx`), data directory, launcher behaviour on game start.

### Code modules (`src/main/minecraft/`)

`manifest.ts` · `versionJson.ts` · `rules.ts` · `downloader.ts` · `installer.ts` · `java.ts` · `arguments.ts` · `launcher.ts` · `paths.ts` (the only place that builds paths under `<data>`)

### Done when

- [x] Version list loads online on first start, then from the saved list with no request; manual refresh; offline refresh keeps the saved list.
- [ ] Install and launch the latest release, then an old version (e.g. 1.8.9), then a snapshot. *Verified in WSL: 1.21.4, 1.8.9 and b1.7.3 install and start. Still to check: the latest release (26.x) and a snapshot, and everything on native Windows.*
- [x] Relaunching an installed version makes **zero** network requests (dev CLI: 0 requests; unit test with the network switched off).
- [x] Installing a second version reuses the shared libraries and assets already on disk (b1.7.3 after 1.8.9 downloaded 51 of 479 files, reusing Java 8).
- [x] Cancelling an install halfway, then retrying, finishes correctly with no corrupt files (no `.part` files left; interrupted installs resumed where they stopped).
- [x] Deleting a file inside an installed version: the quick check notices it and downloads only that file (unit test).
- [x] Unit tests for `rules.ts`, `arguments.ts`, the offline UUID, and the "is installed" logic.

## Scope 02: Mod loaders (Fabric and Quilt)

### Goal

The user picks a Minecraft version **and** a loader (Vanilla / Fabric / Quilt), then presses Play. The launcher installs the loader on top of the vanilla version and launches it. Mods are added by hand through an "Open mods folder" button.

Forge and NeoForge are **not** part of this scope, but the design below must let them be added later as one new provider, without restructuring (see *Ready for Forge*).

### User flow

1. Pick a version (e.g. `1.18.2`), then pick a loader from a dropdown: **Vanilla**, **Fabric**, **Quilt**. Loaders that don't support the chosen version are disabled.
2. Press **Play**. If needed, the launcher installs vanilla `1.18.2` first (Scope 01 installer), then the loader, then launches.
3. Loader installs show in the installed list as their own entries with a loader badge, e.g. `1.18.2 · Fabric 0.19.5`, next to plain `1.18.2`.
4. Each loader install has an **Open mods folder** button (opens `<gameDir>/mods/`, creating it if missing).

### How a loader install is stored

- A loader install is **just another installed version**, using the version id returned by the loader's server (`fabric-loader-<loader>-<mc>`, `quilt-loader-<loader>-<mc>`):
  - `versions/<id>/<id>.json`: the loader's version JSON, with `inheritsFrom: "<mc>"`.
  - `versions/<id>/install.json`: the marker, extended with `loader: { id, loaderVersion, gameVersion }`. Vanilla installs have no `loader` field.
  - `games/<id>/`: its own game folder (own `mods/`, worlds, settings), from `paths.gameDir(id)`.
- It reuses the vanilla version's jar, libraries, assets and Java. Only the loader's own libraries are new.
- Several loader installs can coexist (Fabric 1.18.2, Quilt 1.18.2, Fabric 1.20.1…), each with separate mods and worlds.

### Loader provider interface

Each loader is one file in `src/main/minecraft/loaders/` implementing:

```ts
interface LoaderProvider {
  id: string;                       // "fabric" | "quilt" (later "forge", "neoforge")
  displayName: string;
  listGameVersions(): Promise<string[]>;                // MC versions this loader supports
  getLatestLoaderVersion(gameVersion: string): Promise<string>;
  getVersionJson(gameVersion: string, loaderVersion: string): Promise<VersionJson>; // with inheritsFrom
  postInstall?(ctx: LoaderInstallContext): Promise<void>; // optional extra steps; not used by Fabric/Quilt
}

interface LoaderInstallContext {
  gameVersion: string;
  loaderVersion: string;
  versionId: string;
  paths: Paths;                // Scope 01 paths helper
  download: Downloader;        // Scope 01 downloader (hash check, .part, retries)
  getJava(component: string): Promise<string>; // path to a Java executable
  signal: AbortSignal;
  progress(step: string, done: number, total: number): void;
}
```

- `registry.ts` lists the providers. The UI's loader dropdown is built from that list, and "Vanilla" is not a provider.
- **Generic install flow** (`loaders/installLoader.ts`), the same for every loader:
  1. Make sure vanilla `<mc>` is installed (Scope 01 installer).
  2. `getLatestLoaderVersion()` → `getVersionJson()` → save as `versions/<id>/<id>.json`.
  3. Download every library of the merged version with the Scope 01 downloader.
  4. Run `postInstall` if the provider has one.
  5. Write the install marker last.
- Launching goes through the normal Scope 01 launch code, since the `inheritsFrom` merge produces a normal version.

### Merging a loader version with vanilla (`versionJson.ts`)

- **Child wins**: `mainClass`, `id`, `type` come from the loader version.
- **Arguments**: loader `jvm`/`game` arguments are **appended** to vanilla's.
- **Libraries**: loader libraries come first. If both have the same `group:artifact[:classifier]`, keep **only the loader's**. Duplicate ASM jars otherwise crash Fabric.
- `javaVersion`, `assetIndex`, `downloads` are inherited from vanilla unless the loader sets them.
- The merge follows the `inheritsFrom` chain to any depth, not just one level.

### Libraries without hashes

- Loader libraries use Maven coordinates (`name` + repository `url`) instead of `downloads`. Build the path from the coordinate: `group/as/path/artifact/version/artifact-version[-classifier].jar`.
- Fabric provides `sha1` and `size`. **Quilt provides neither**: fetch `<jar url>.sha1` from the same repository and verify against it. If that file doesn't exist, accept the download but record it as unverified.

### Loader servers

| Loader | Supported MC versions | Loader builds | Version JSON |
|---|---|---|---|
| Fabric | `https://meta.fabricmc.net/v2/versions/game` | `https://meta.fabricmc.net/v2/versions/loader/<mc>` | `https://meta.fabricmc.net/v2/versions/loader/<mc>/<loader>/profile/json` |
| Quilt | `https://meta.quiltmc.org/v3/versions/game` | `https://meta.quiltmc.org/v3/versions/loader/<mc>` | `https://meta.quiltmc.org/v3/versions/loader/<mc>/<loader>/profile/json` |

- **Latest build only** in this scope; there's no picker for a specific build. Fabric: first entry with `loader.stable: true`. Quilt: the list isn't sorted and contains betas, so drop versions containing `-beta`/`-pre`, then take the highest by version-number comparison.
- Cache the supported-versions lists in `launcher/loaders/<id>.json`. With no internet, installed loader versions still launch; only *new* loader installs need the network.
- An installed loader stays on its build. Updating a loader to a newer build is a later scope.

### Deleting

- Deleting a loader install removes `versions/<id>/` only, and asks before deleting `games/<id>/`.
- Deleting a vanilla version that loader installs depend on: warn and list them. The user can cancel, or delete the dependent installs too.

### Ready for Forge (do not build Forge now)

Forge/NeoForge (1.13 and later) install differently: they download an installer jar, read `install_profile.json` and a `version.json` from it, download extra libraries, then run **processors**, meaning Java programs that patch the game jar. The Scope 02 design must already allow that:

- `postInstall` gets Java, the downloader, paths, progress and cancel, which is everything processors need.
- Libraries can live in `libraries/` that were **produced locally** by a processor, not downloaded. The quick check before launch must treat "file exists" as enough for those (no download URL).
- Version JSON parsing must not assume every library has a `url`, `downloads` or hash.
- The merge supports multi-level `inheritsFrom`.
- Loader version IDs are opaque strings; never parse Fabric's naming pattern outside the Fabric provider.
- Arguments may contain `${library_directory}`, `${classpath_separator}` and `${version_name}` placeholders (used by modern Forge); support them in `arguments.ts` now.

### Code modules (`src/main/minecraft/loaders/`)

`types.ts` · `registry.ts` · `installLoader.ts` · `fabric.ts` · `quilt.ts` · `maven.ts` (coordinate → path/URL, `.sha1` fetch)

### Done when

- [ ] Install and launch Fabric on 1.18.2 and on the latest release; Quilt on 1.18.2.
- [ ] A Fabric mod dropped into `mods/` (e.g. Fabric API) loads in game.
- [ ] Vanilla 1.18.2 and Fabric 1.18.2 have separate game folders; the vanilla one has no mods.
- [x] Installing Fabric on an already-installed vanilla version downloads only the loader libraries. *(Dev CLI, real servers: 1.18.2 Fabric fetched 8 files, Quilt 5.)*
- [ ] An installed Fabric/Quilt version launches with the network off.
- [ ] The loader dropdown disables loaders that don't support the selected version (e.g. Fabric on 1.12.2).
- [x] Unit tests: the merge (child wins, library de-duplication, argument appending, multi-level chain), Maven coordinate paths, and Quilt "latest stable" selection.

## Scope 03: Profiles and worlds

### Goal

**Every game launch comes from a profile.** A profile is a name, a Minecraft version and a loader (Vanilla / Fabric / Quilt), plus its own mods and worlds. The user can have several profiles on the same version, e.g. two `1.18.2 · Fabric` profiles with different mods. All worlds are stored in one folder, and each profile only sees its own. Worlds can be moved between profiles. All mods are stored once in a shared **mod library**, and each profile picks which library mods it uses.

A launch always needs **a profile and an account**. This scope still has only the single offline account from Scope 01, but the account must be selected explicitly, not assumed (multiple accounts come in the next scope).

### User flow

1. **Create profile**: enter a name, pick a version (the Scope 01 version list), pick a loader (the Scope 02 dropdown). Nothing is downloaded yet.
2. **Home screen**: a list of profiles (name, version, loader badge, last played) and an account selector. **Play** is disabled until a profile and an account are both selected, with a hint saying what's missing.
3. **Play**: install the version/loader if needed (Scopes 01–02), sync the profile's worlds, launch.
4. **Edit profile**: name, version, loader, and optional settings can all be changed later.
   - Changing the **version** or **loader** shows a warning before saving: *"Changing the version or loader can break this profile. Worlds opened in an older version can be corrupted, and mods only work with the loader and version they were made for. Back up your worlds first."*
   - The new version/loader is installed on the next Play. The old install is left on disk (it can be removed from the Versions page).
5. **Worlds tab** on each profile: list its worlds, **Open folder**, **Move to another profile**.
6. **Mods tab** on each profile: tick or untick mods from the shared library; add new mods (file picker or drag and drop).
7. **Mod library page**: every stored mod, which profiles use it, and actions to add, remove, and **Remove unused**.
8. **Delete profile**: a dialog asks what to do with its worlds: **delete them** or **move them to another profile**. Mods and settings are deleted with the profile.
9. **First start with no profiles**: show the Create profile screen.

### Profile data

Stored in `launcher/profiles.json` (atomic write: temp file then rename):

```ts
interface Profile {
  id: string;                      // random UUID; never changes
  name: string;                    // 1–32 chars, shown in UI; renaming is always safe
  gameVersion: string;             // e.g. "1.18.2"
  loader: { id: string } | null;   // null = Vanilla; loader build is "latest" at install time (Scope 02)
  installedVersionId?: string;     // version id actually installed for this profile, e.g. "fabric-loader-0.19.5-1.18.2"
  memoryMaxMb?: number;            // empty = use global setting
  extraJvmArgs?: string[];         // empty = none
  createdAt: string;
  lastPlayedAt?: string;
}
```

- Settings also remember the last selected `profileId` and `accountId`.
- The launch function takes `(profileId, accountId)`. Profiles never store an account, so multi-account can be added without changing profiles.
- Per-profile `memoryMaxMb` and `extraJvmArgs` are applied on top of global settings; extra JVM args are passed as separate array items, never through a shell.

### Game folder

- The game folder is now per **profile**: `profiles/<profileId>/` (mods/, config/, options.txt, screenshots, saves/ …). Use the profile **id**, not the name, so renaming never moves files.
- Change `paths.gameDir()` to take a profile id. That's the only place this path is built.
- `games/<versionId>/` from Scopes 01–02 is replaced. On first start after this scope, turn each existing `games/<versionId>/` folder into a profile (name = version id) and move it to `profiles/<newId>/`.
- The version list is no longer the home screen. Installed versions get a **Versions** page (repair, delete, and which profiles use each one). Deleting a version used by a profile asks first; the profile will reinstall it on next Play.

### Worlds: one shared folder, linked into profiles

Minecraft shows every folder in `<gameDir>/saves/` and has no setting to hide worlds, so a flag alone can't separate them. Instead:

- **All worlds** live in `<data>/worlds/<worldId>/`. `worldId` is the world's folder name, with `-2`, `-3`… added if it's already taken.
- **Owner flag**: each world contains `ezlauncher-world.json` = `{ schema: 1, profileId }`. Minecraft ignores it. **The flag is the source of truth** for which profile owns a world.
- **Links**: `profiles/<profileId>/saves/<worldId>` is a link to `worlds/<worldId>`. On Windows use a **directory junction** (`fs.symlink(target, path, 'junction')`, absolute target, no admin rights needed); on Linux/macOS a symlink. Minecraft sees them as normal folders.
- If a link can't be created (e.g. data folder on a network drive), leave the world as a real folder in that profile's `saves/` and show a warning that it can't be moved.

**World sync** (`worlds.ts`) runs on launcher start, before a launch, and after the **last** running game of that profile exits. It **never touches a profile while any game of it is running** (Minecraft locks its worlds), so launching a profile that is already running skips sync:

1. **Adopt new worlds**: a real folder (not a link) containing `level.dat` in any `saves/` = a world created in-game. Move it into `worlds/`, write its flag, and replace it with a link. This also adopts worlds from the old `games/` folders.
2. **Fix links from flags**: make each profile's `saves/` contain links to exactly the worlds flagged with its id. Remove links whose world is gone.
3. **Worlds deleted in-game**: deleting a world in Minecraft can empty the target folder instead of removing the link. A world folder with no `level.dat` counts as deleted: remove it and its link.
4. **Orphans**: worlds whose `profileId` doesn't match any profile are shown in an **Unassigned worlds** list, where the user can assign them to a profile. They're never deleted automatically.

**Moving a world**: rewrite its flag, then run sync for both profiles. Blocked while either profile is running. If the target profile has an older version or a different loader, show the same warning as editing a profile.

### Mod library (shared mods)

Each mod jar is stored **once**, however many profiles use it.

- **Store**: `<data>/mods-store/<sha1>.jar`. Files are named by their SHA1 hash, so the same file is never stored twice. Metadata goes in `launcher/mods.json`: `{ sha1: { fileName, modId, name, version, loaders[], mcVersionRange?, iconPath?, addedAt } }`.
- **Profile mods = hard links**: `profiles/<id>/mods/<fileName>` is a **hard link** to the store file, meaning a second name for the same data that uses no extra space. Minecraft and the loaders see a normal file. Use hard links, not junctions (folders only) or symlinks (Windows file symlinks need admin rights).
  - If hard links fail (e.g. FAT32/exFAT drive), copy the file instead and show that storage isn't being shared.
- **Reading mod info**: open the jar and read `fabric.mod.json` (Fabric), `quilt.mod.json` (Quilt), or `META-INF/mods.toml` / `META-INF/neoforge.mods.toml` (Forge/NeoForge, read now so later scopes can use it) for id, name, version, supported loaders, the Minecraft version range, and the icon. A jar with none of these is still stored, named by its file name, marked "unknown".
- **Adding mods** (all three hash the jar, put it in the store if new, and link it into the profile):
  1. **Add mods** button (file picker, multiple `.jar` files), in the library or on a profile's Mods tab.
  2. **Drag and drop** `.jar` files onto the library or a profile's Mods tab.
  3. **Dropped into `mods/` by hand**: mod sync (below) finds real files in a profile's `mods/` and adopts them into the store. They stay enabled for that profile.
- **Enable / disable in a profile**: ticking creates the hard link, unticking removes it. The store file is never touched.
- **Compatibility in the profile's Mods tab** (`compat.ts`). Each library mod is one of:
  - **compatible**: supports the profile's loader (Quilt profiles also accept Fabric mods) and its Minecraft version range includes the profile's version;
  - **incompatible**: loader or Minecraft version is known not to match. Shown, but **cannot be selected**, with the reason ("Forge only", "Needs 1.20.1");
  - **unknown**: no readable info. Selectable, with a "compatibility unknown" warning.
  - Version ranges come from the jar metadata: Fabric/Quilt use semver-style predicates (`>=1.18.2`, `1.18.x`, `~1.18`, lists); Forge uses Maven ranges (`[1.18,1.19)`). A range that can't be parsed counts as unknown.
- **Same mod, two versions**: both can be in the library, but a profile can enable only one version of a given `modId`. Enabling one disables the other.
- **Unused mods are kept**, so they can be ticked again later. The library marks them "unused" (no profile links them) and has **Remove unused**, with a confirm step. Removing a mod that profiles still use lists those profiles and asks first.
- **Mod sync** (`mods.ts`) runs with world sync (launcher start, before launch, after the last game of a profile exits) and skips profiles with any game running:
  1. Adopt real (non-linked) `.jar` files in each `mods/`.
  2. Remove links in `mods/` whose store file is gone.
  3. Rebuild "which profiles use which mod" by comparing each `mods/` file with the store by file identity (hard links share the same file), not by name.
- Only mod jars are shared. `config/` and everything else stays per profile.
- Deleting a profile removes its links only; the mods stay in the library.

### Code modules

`src/main/profiles/`: `profiles.ts` (create/edit/delete, `profiles.json`) · `worlds.ts` (sync, move, orphans) · `mods.ts` (mod library, store, mod sync) · `modInfo.ts` (read mod metadata from jars) · `links.ts` (junction, symlink and hard link create, check, remove; the only place that knows about link types) · `migrate.ts` (`games/` → profiles).

### Done when

- [ ] Create two profiles on `1.18.2 · Fabric` with different mods; each loads only its own mods.
- [ ] Play is disabled until a profile and the account are selected.
- [ ] A world created in-game ends up in `worlds/` with a flag, and shows only in its own profile's world list and in-game list.
- [ ] Moving a world to another profile makes it appear only there, both in the launcher and in-game.
- [ ] Deleting a world in-game removes it from `worlds/` on the next sync.
- [ ] Deleting a profile offers delete vs move for its worlds; nothing is deleted without that choice.
- [ ] Changing a profile's version or loader shows the warning, and the new install happens on next Play.
- [ ] Renaming a profile doesn't move any files.
- [ ] Existing `games/<versionId>/` folders become profiles with their worlds intact.
- [ ] Works on Windows with junctions (no admin rights) and on Linux with symlinks.
- [ ] Two profiles using the same mod store it once on disk (same file, link count 2).
- [ ] A jar dropped into `mods/` by hand ends up in the store and stays enabled for that profile.
- [ ] Unticking a mod in every profile keeps it in the library as "unused"; **Remove unused** deletes it.
- [ ] Mod name, version and loader are read from Fabric and Quilt jars.
- [x] Unit tests for mod sync (adopt, missing store file, usage count), mod metadata parsing, and one-version-per-modId; plus unit tests for world sync (adopt, fix links, deleted world, orphan), name-collision handling, and profile validation.

## Scope 04: Mod manager (Modrinth downloads)

### Goal

Besides adding jar files by hand (Scope 03), the user can **download mods from Modrinth** into the mod library and enable them in the selected profile, together with their required dependencies. Mods added by hand are **identified** as Modrinth mods when possible. All Modrinth code sits behind a `ModSource` interface, so switching to or adding another site (e.g. CurseForge) means writing a new adapter only.

Not in this scope: fuzzy/browse search, mod updates, and deeper corruption and version-mismatch checks (a later scope).

### User flow

1. On a profile's **Mods tab**, press **Add mod**. A list of the **library** opens, with a search box that filters it:
   - compatible mods: selectable;
   - incompatible mods: shown but disabled, with the reason (Scope 03 rules);
   - unknown compatibility: selectable with a warning.
2. If the mod isn't in the library, the list shows **"Not in your library. Search Modrinth"**.
3. **Exact search** on Modrinth for the typed text, filtered to the profile's loader and Minecraft version:
   - **Exact match**: show a confirm card with icon, name, author, the mod version that will be downloaded, the required dependencies that will also be downloaded (or reused from the library), and total size. **Download** adds everything to the library and enables it in the profile.
   - **No exact match**: show "Not found". No suggestions.
4. Mods downloaded from Modrinth, and hand-added jars identified as Modrinth mods, show a Modrinth badge and a link to their page in the library.

### ModSource abstraction

Code in `src/main/modsources/`. The rest of the app (library, UI, IPC) only uses these types. Nothing outside the adapter knows Modrinth URLs, IDs or JSON shapes.

```ts
interface ModSource {
  id: string;                 // "modrinth" (later e.g. "curseforge")
  displayName: string;
  findExact(query: string, target: ModTarget): Promise<RemoteProject[]>;           // exact matches only
  getCompatibleVersion(projectId: string, target: ModTarget): Promise<RemoteVersion | null>; // newest fitting version
  getVersion(versionId: string): Promise<RemoteVersion>;
  identifyFiles(sha1s: string[]): Promise<Map<string, RemoteVersion>>;           // file hash → where it came from
}

interface ModTarget { gameVersion: string; loaders: string[] }  // Quilt profile → ["quilt", "fabric"]

interface RemoteProject { sourceId: string; projectId: string; slug: string; name: string; author: string; iconUrl?: string; pageUrl: string }

interface RemoteVersion {
  sourceId: string; projectId: string; versionId: string; versionNumber: string;
  channel: "release" | "beta" | "alpha";
  loaders: string[]; gameVersions: string[];
  file: { url: string; fileName: string; size: number; sha1: string; sha512?: string };
  dependencies: { projectId?: string; versionId?: string; kind: "required" | "optional" | "incompatible" }[];
}
```

- `registry.ts` lists sources. In this scope there's only `modrinth.ts`.
- The library stores where a mod came from as opaque data in `launcher/mods.json`: `source?: { sourceId, projectId, versionId, pageUrl }`, plus `sourceCheckedAt` for hand-added files. Compatibility uses the **jar metadata first**, because that's what the loader actually enforces. The source's `loaders` and `gameVersions` only fill in what the jar doesn't declare (Scope 05).

### Modrinth adapter (`modrinth.ts`)

- Base URL `https://api.modrinth.com/v2`. Every request sends a `User-Agent` like `ezlauncher/<app version> (<contact>)`; Modrinth requires one.
- **Rate limit**: 300 requests/minute. Read the `x-ratelimit-remaining` / `x-ratelimit-reset` headers, wait when needed, and batch hash lookups.
- **Exact search**:
  1. `GET /project/{query}`: the query as a slug or id (e.g. `fabric-api`).
  2. `GET /search?query=…&facets=[["project_type:mod"],["categories:<loader>"…],["versions:<mc>"]]`, keeping only hits whose `title` or `slug` equals the query (trimmed, ignoring case).
  3. Combine and de-duplicate by project id. Several exact matches (rare): show one card each.
- **Pick the version**: `GET /project/{id}/version?loaders=[…]&game_versions=["<mc>"]`. Take the newest `release`; if there is none, the newest `beta`; then `alpha`. Use the file marked `primary`.
- **Identify files**: `POST /version_files` with `{ hashes: [...sha1], algorithm: "sha1" }`. Store file names are already SHA1, so no extra hashing is needed.

### Downloading

- Download through the Scope 01 downloader (`.part` file, SHA1 check, retries) straight into `mods-store/<sha1>.jar`, then write metadata (including `source`) and hard-link into the profile.
- **Required dependencies**:
  - Resolve them recursively, stopping on cycles. A dependency with a `versionId` uses that version; otherwise the newest compatible one.
  - If the library already has a compatible version of that project, **reuse it**: just enable it.
  - If a required dependency has no compatible version, show it on the confirm card and **don't download anything**.
  - Optional dependencies are ignored. Incompatible ones are listed as a warning if they're enabled in the profile.
- The Scope 03 "one version per `modId`" rule still applies. If the profile already has another version of the same mod, the confirm card says it will be replaced.
- Downloads can be cancelled; a cancelled batch leaves nothing half-added.

### Identifying hand-added mods

- When a jar enters the library through the file picker, drag and drop, or `mods/` adoption, queue its SHA1 for `identifyFiles`. A match fills in `source` (badge, page link, exact compatibility data).
- With no internet, mark the mod "not checked yet". On launcher start, check pending ones in one batched request.
- No match: the mod stays a normal library mod using jar metadata. Checked again at most once a week.

### Code modules

`src/main/modsources/`: `types.ts` · `registry.ts` · `modrinth.ts` · `resolveDependencies.ts` (source-independent, uses the interface only).

### Done when

- [ ] Typing `Sodium` or `fabric-api` on a Fabric 1.18.2 profile shows one confirm card with the right 1.18.2 version.
- [ ] A name with no exact match shows "Not found" and makes no download.
- [ ] Downloading a mod that needs Fabric API downloads and enables both; if Fabric API is already in the library, it's reused.
- [ ] A jar downloaded from the Modrinth website by hand and dropped in gets the Modrinth badge.
- [ ] Incompatible library mods are disabled in the Add mod list, with a reason.
- [ ] Searching a Quilt profile also finds Fabric-only mods.
- [x] Unit tests with a fake `ModSource` (no network): dependency resolution (reuse, cycles, missing dependency), version picking (release before beta), exact-match filtering. The library and UI code must work with the fake source unchanged.

## Scope 05: Mod validation

### Goal

Before every launch, and whenever a profile's mods change, check that the profile's enabled mods can actually run: right loader, right Minecraft version, required mods present, no conflicts, files not damaged. It doesn't matter how a mod got in: download, file picker, dropped into `mods/`, or a profile whose version/loader changed afterwards. Problems are shown clearly, and at launch the user decides what to do.

### Where the information comes from

- **The jar's own metadata comes first**, because it's what the loader enforces: `fabric.mod.json`, `quilt.mod.json`, `META-INF/mods.toml`, `META-INF/neoforge.mods.toml`. Extend the Scope 03 reader (`modInfo.ts`) to also read:
  - `depends` / `requires` (other mod ids with version ranges, including `minecraft`, `fabricloader`, `java`), `breaks`, `conflicts` (Fabric/Quilt), and `type = "incompatible"` (Forge/NeoForge);
  - `provides` (extra mod ids the jar counts as);
  - **mods bundled inside the jar** (Fabric `jars` → `META-INF/jars/*.jar`, Quilt `jars`, Forge `META-INF/jarjar/`). Read them recursively: their ids and versions count as provided by the outer mod. Fabric API alone bundles ~40 modules, and without this they'd be reported as missing.
- **Mod source data** (Scope 04, Modrinth) only fills in what the jar doesn't declare, e.g. a Minecraft version for a jar with no `minecraft` requirement.
- **When unsure, warn; never error.** An error must only come from a clear, parsed rule.

### Version matching (`src/main/validation/versions/`)

- `fabricRange.ts`: Fabric/Quilt semver predicates (`>=1.18.2`, `<1.19`, `1.18.x`, `~1.18`, `^0.15`, `*`, lists meaning "any of").
- `mavenRange.ts`: Forge/NeoForge Maven ranges (`[1.18,1.19)`, `[1.20.1]`, `[47,)`).
- `mcVersion.ts`: turn Minecraft version ids into comparable versions the same way Fabric does (releases like `1.18.2` and `26.3` directly; snapshots and pre-releases mapped to their target release). If a version can't be mapped, results involving it are **unknown** (warning), not errors.

### Checks

| Check | Severity |
|---|---|
| Mod is for a different loader (Quilt profiles accept Fabric mods) | 🔴 error |
| Profile's Minecraft version is outside the mod's declared range | 🔴 error |
| Installed loader build is older than the mod requires (`fabricloader`, `forge`…) | 🔴 error |
| A required mod is missing (not enabled, not provided or bundled by another enabled mod) | 🔴 error |
| A required mod is enabled but its version is outside the required range | 🔴 error |
| Two enabled mods `break` each other / are marked `incompatible` | 🔴 error |
| Two enabled jars have the same mod id | 🔴 error |
| Java version used for the profile is older than a mod's `java` requirement | 🔴 error |
| File damaged: SHA1 doesn't match its store name, or the jar can't be opened | 🔴 error |
| `conflicts` between two enabled mods (Fabric's softer "may cause problems") | 🟡 warning |
| No metadata or unparseable range: compatibility unknown | 🟡 warning |
| Jar metadata and Modrinth data disagree | 🟡 warning (the jar's answer is used) |

Optional dependencies (`recommends`, `suggests`, optional `type`) are not checked.

### When it runs

- On opening a profile's Mods tab, after enabling/disabling/adding a mod, and after editing a profile's version or loader: show badges on problem mods and a summary at the top of the tab.
- **Before every launch**, after mod sync (Scope 03).
- **Damage check** costs time, so:
  - every launch: file exists, size matches, the jar's index opens;
  - full SHA1: when a file's modified time changed since the last check, and on a **Check mods** button.
- Cache results per profile. Recompute only when the enabled mods, version, loader build or Java changes.

### At launch

- **Only warnings**: launch normally and show a small notice ("2 mods with unknown compatibility").
- **Any error**: a dialog lists each problem (mod name, what's wrong, e.g. "Needs Fabric API", "Made for 1.20.1, profile is 1.18.2") with three buttons:
  1. **Disable problem mods and play**: disables every mod with an error, re-checks, and also disables mods that now miss a required dependency because of it. Shows the final list before confirming. Disabling only removes links (Scope 03); the mods stay in the library.
  2. **Play anyway**: launches as is.
  3. **Cancel**: back to the profile.
- **Fix suggestions** in the report and the Mods tab: for a missing required mod, try `ModSource.findExact(modId)` (Scope 04) and offer **Download**. For damaged files from a known source, offer **Re-download**.

### Code modules

`src/main/validation/`: `types.ts` (`Issue { severity, modSha1, code, message, fix? }`) · `validate.ts` (profile → issues; pure function, no file or network access) · `collect.ts` (gathers the input: enabled mods, nested mods, profile, loader build, Java version) · `integrity.ts` (damage checks) · `versions/`.

### Done when

- [ ] A Forge jar dropped into a Fabric profile's `mods/` is reported as wrong loader.
- [ ] A 1.20.1 Fabric mod in a 1.18.2 profile is reported with both versions in the message.
- [ ] A Fabric mod without Fabric API reports "missing Fabric API" with a working Download fix.
- [ ] Mods bundled inside Fabric API count as present (no false "missing" errors).
- [ ] Changing a profile's version to one its mods don't support shows the errors in the Mods tab right away.
- [ ] A jar with one changed byte is reported as damaged, with Re-download for Modrinth mods.
- [ ] "Disable problem mods and play" also disables mods that depended on the disabled ones, and shows the list first.
- [ ] "Play anyway" launches without changing anything.
- [x] Unit tests for `validate.ts` with fixture mod metadata (every check in the table), `fabricRange.ts`, `mavenRange.ts`, `mcVersion.ts`, and nested-jar collection.

## Scope 06: Accounts and settings

### Goal

The user can have **several offline accounts**, pick one per launch, and **rename** an account without losing their items and progress. A **Settings** page collects all launcher settings, with per-profile overrides for memory and arguments.

### Accounts

- **Account list** (next to the profile selector on the home screen): add, rename, delete, select. The selected account is remembered (Scope 03).
- **Adding**: username (3–16 chars, `A-Z a-z 0-9 _`). Names must be **unique among accounts** (ignoring case), because two accounts with the same name would get the same UUID and share progress.
- **The UUID is fixed**: created once when the account is created (Scope 01 offline rule) and stored. **Renaming changes only the name; the UUID stays.** The account keeps its:
  - stats (`<world>/stats/<uuid>.json`) and advancements (`<world>/advancements/<uuid>.json`);
  - player data on LAN / as a guest (`<world>/playerdata/<uuid>.dat`);
  - default skin (Steve/Alex is chosen from the UUID).
- **Singleplayer inventory and position are stored in the world's `level.dat`**, not by UUID, so they're kept after a rename (and are the same for every account playing that world).
- **Limitation, shown when renaming**: offline-mode multiplayer servers work out the UUID from the *name* themselves and ignore the launcher's, so on those servers a renamed account counts as a new player.
- The account screen shows the UUID with a **Copy** button (useful for server admins and backups).
- **Deleting an account** removes it from the launcher only. World files are not touched.
- Launch stays `(profileId, accountId)`. Accounts go through the Scope 01 `AuthProvider` interface; in this scope only the offline provider exists.
- **Several games at once**:
  - **Same profile**: allowed, but each running game of that profile must use a **different account**. Launching a profile with an account that's already playing it is blocked ("<name> is already playing this profile").
  - **Different profiles**: allowed with any account.
  - The launcher tracks running games as `{ profileId, accountId, pid }`. The home screen shows how many games of each profile are running.
- **Sharing one game folder** (several games of the same profile):
  - A world can be open in only one game at a time; Minecraft's own world lock refuses the second one. To play together, one player opens the world to LAN and the others join.
  - Both games write the same `options.txt`, `logs/latest.log` and mod config files, so the last one to save wins. The launcher's log view reads each game's output directly, so logs stay separate there.
  - While any game of a profile is running, block: editing the profile, enabling/disabling/adding mods, moving or deleting its worlds, deleting the profile, and repairing or deleting its version. Show "Close the game first".

### Settings page

Saved in `launcher/settings.json` (atomic write). Sections:

1. **Game**
   - **Memory**: default max RAM (`-Xmx`), slider plus number, in MB. Default 2048 MB. Show the computer's total RAM, and warn above 75% of it.
   - **Extra JVM arguments** (e.g. `-XX:+UseG1GC`) and **extra game arguments** (e.g. `--width 1280 --height 720`): text fields, split into array items with shell-style quoting but **never run through a shell**. Warn if JVM arguments contain `-Xmx`/`-Xms`, because Memory already sets them.
2. **Version list**: toggles **Show snapshots**, **Show old beta**, **Show old alpha**. All off by default: only releases are shown. These control the version list in Create/Edit profile; releases are always shown. A profile that already uses a hidden type keeps working and still shows its version.
3. **Launcher**: behaviour on game start (keep open / minimise / close, Scope 01), and the data directory. Changing it asks: **Move my data there** or **Start empty there**, and restarts the launcher.

### Per-profile overrides (profile edit screen)

- **Memory**, **extra JVM arguments** and **extra game arguments** each have an **"Use global setting"** checkbox, on by default. Off = the profile's value **replaces** the global one (it's not added to it).
- Profile fields: keep Scope 03's `memoryMaxMb?` and `extraJvmArgs?`, and add `extraGameArgs?`. A missing field means "use global".
- Resolve the final values in one function (`resolveLaunchSettings(profile, settings)`), used by the launch code and unit-tested.
- Where extra arguments go: extra JVM args after the version's JVM args and before the main class; extra game args after the version's game args.

### Done when

- [ ] Create two accounts and launch the same profile with each; each has its own stats and advancements in a world.
- [ ] Rename an account: its UUID is unchanged, and its stats and advancements in an existing world are kept.
- [ ] Adding an account with an existing name (in any case) is refused.
- [ ] The same profile runs twice at once with two different accounts; a third launch with an account already playing it is blocked.
- [ ] World and mod sync run only after the last game of a profile exits.
- [ ] Global memory applies to profiles set to "use global"; a profile override replaces it.
- [ ] Global extra args are replaced, not added to, by a profile's own args.
- [ ] Snapshots, old beta and old alpha appear in the version list only when their toggles are on.
- [ ] Changing the data directory with "Move my data there" keeps profiles, worlds, mods and accounts working.
- [x] Unit tests: `resolveLaunchSettings`, argument splitting (quotes, spaces, empty input), account name rules.

---

## Scope 07: Backups, library tools and UI polish (done)

### Goal

Protect worlds with backups, make the mod library and profiles easier to manage, show what each version changed, manage Java, and polish the UI.

### Items

- **World backups**:
  - **Storage**: one `.zip` per backup in `backups/<key>/`, with an `index.json` per world.
  - **By hand**: from a profile's Worlds tab (one world or all); refused while the profile's game runs.
  - **Automatic**: on every launch, or every N days. It runs before the game starts or after it closes, as the user chooses (Play waits for a before-start backup, and Skip still starts the game).
  - **Unchanged worlds**: a world that hasn't changed since its newest backup (same file names, sizes and modified times) isn't backed up again.
  - **Retention**: at most N backups per world, and none older than D days. Either limit can be off. The newest backup of each world is never deleted automatically.
  - **Restore**: always as a new world in the profile; the current world is never overwritten.
  - **Progress**: a bar in the top bar, with Cancel. Settings shows total size and the backups of deleted worlds.
- **Downloading mods for specific Minecraft versions**:
  - **For a version**: in the Mod library, pick a version and a loader, and the matching version of every library mod from a mod site is downloaded.
  - **After a version change**: when a profile's version or loader changes, the user is offered to switch its mods to matching versions. Mods with none are disabled but kept in the library.
  - **Library view**: mods that are only there as another mod's dependency are shown under that mod, not as rows of their own.
- **Changelog of Minecraft versions**: Mojang's patch notes for each version, on the Versions tab and wherever a version is picked. The HTML is rebuilt from safe elements only and never injected. Versions before 1.13 get a Minecraft Wiki link instead.
- **Profile duplication**: settings, icon and enabled mods are copied. Worlds are copied only when the user ticks it (off by default), and the copies belong to the new profile.
- **Profile icons**: built-in pixel-art icons, picked from a dropdown, shown in the profile list, the profile page and the Play bar.
- **Java version management** (Settings → Java): the Mojang Java runtimes for this computer can be installed, checked and removed. Java already installed on the computer is shown too.
- **UI/UX improvements**:
  - the app is named **EZLauncher**, from one source;
  - a top tab navbar with the account picker;
  - a Play button on every profile row;
  - right-click menus on profile and version rows;
  - search on Home and on the Versions tab;
  - a tidier profile form: the version picker is folded away when editing, and the loader sits under the version list;
  - only the page scrolls, never the whole window.
  - much more minor items for better UI/UX

---

## Parked decisions (do NOT implement yet)

Decisions already made for future scopes. Only build them when the matching scope is written above.

- **Later features**: Forge and NeoForge (which Forge versions to support is still open), picking a specific loader build, updating a loader, a CurseForge mod source, fuzzy/browse mod search, and mod updates. Each comes as its own scope when requested.
