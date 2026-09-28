# ezlauncher

A desktop Minecraft: Java Edition launcher. **Offline mode only**: no Microsoft/Mojang authentication.

## Scopes

All scopes are defined in [scopes.md](scopes.md), the single source of truth for what to build. Read the scope you are working on before starting, and don't build features from later scopes. New scopes are added to that file, not as separate documents.

- Scope 01, Core launcher: version list, multi-version install, offline launch, abstract auth.
- Scope 02, Mod loaders: Fabric and Quilt through a loader provider interface built to also fit Forge/NeoForge later.
- Scope 03, Profiles and worlds: every launch uses a profile + account; per-profile settings; all worlds in one folder, linked into their profile; shared mod library with hard links into each profile.
- Scope 04, Mod manager: exact-name Modrinth download with dependencies, identify hand-added jars by hash; all behind a `ModSource` adapter.
- Scope 05, Mod validation: pre-launch checks of loader, Minecraft/loader/Java versions, dependencies, conflicts and damaged files; jar metadata first.
- Scope 06, Accounts and settings: multiple offline accounts with fixed UUIDs (rename-safe); settings page with per-profile memory and argument overrides.

Out of scope until a scope covers it: Microsoft login, Forge/NeoForge, CurseForge, mod updates, modpacks, skins, multiplayer server lists.

## Stack

- Electron + TypeScript (`strict`)
- electron-vite (build/dev), React (renderer UI)
- Vitest (tests), electron-builder (packaging)
- npm

## Architecture

- `src/main/`: Electron main process. Does all file system, network and process work.
  - `src/main/minecraft/`: core launcher logic (version list, installing, launching). Plain TypeScript with **no Electron imports**, so it can be tested on its own.
- `src/preload/`: exposes a small typed API to the renderer via `contextBridge`.
- `src/renderer/`: React UI only. No Node or file system access.
- `src/shared/`: types and IPC channel names shared by the processes.

Security: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.

## Rules

- **Never bundle or re-host Mojang files.** Always download from Mojang's servers.
- Verify every download against its SHA1 hash, and skip files that are already present and valid.
- Follow each library's OS/architecture `rules` from the version JSON; never hard-code platform lists.
- Version IDs are not semver (e.g. `1.21.4`, `26.3`, `26.4-snapshot-1`). Treat them as opaque strings and sort by `releaseTime`.
- Support both argument formats: the older `minecraftArguments` string and the newer `arguments` object.
- Offline identity: user-chosen username; UUID generated **once** at account creation as `UUID.nameUUIDFromBytes("OfflinePlayer:" + name)` (MD5, version 3) and stored. Never recompute it: renaming keeps the UUID. Access token is a placeholder.
- Data directory is **user-configurable**. Never hard-code `.minecraft` or any other path.
- Start the game with `spawn` and an array of arguments (no shell strings), `detached: true`, so closing the launcher doesn't kill the game.
- Launcher behaviour on game start is a user setting: keep open / minimise / close.
- Cross-platform: Windows is the primary target, and code must stay portable (use `path`, no Windows-only APIs). macOS needs `-XstartOnFirstThread`.

## Mojang endpoints

- Version list: `https://piston-meta.mojang.com/mc/game/version_manifest_v2.json`
- Java runtimes: `https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json`
- Assets: `https://resources.download.minecraft.net/<first 2 hash chars>/<hash>`

## Development environment

Code is written in WSL2. Test the actual launcher and game on **native Windows**; OpenGL graphics support inside WSL is unreliable.

## Commands

To be filled in once the project is scaffolded (`dev`, `build`, `test`, `lint`, `package`).
