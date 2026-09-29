# ezlauncher

A desktop Minecraft: Java Edition launcher. **Offline mode only**: no Microsoft/Mojang authentication.

## Scopes

All scopes are defined in [scopes.md](scopes.md), the single source of truth for what to build. Read the scope you are working on before starting, and don't build features from later scopes. New scopes are added to that file, not as separate documents.

- Scope 00, Project setup: tooling, secure Electron window, typed IPC bridge, theming, i18n, packaging (done).
- Scope 01, Core launcher: version list, multi-version install, offline launch, abstract auth (done).
- Scope 02, Mod loaders: Fabric and Quilt through a loader provider interface built to also fit Forge/NeoForge later.
- Scope 03, Profiles and worlds: every launch uses a profile + account; per-profile settings; all worlds in one folder, linked into their profile; shared mod library with hard links into each profile.
- Scope 04, Mod manager: exact-name Modrinth download with dependencies, identify hand-added jars by hash; all behind a `ModSource` adapter.
- Scope 05, Mod validation: pre-launch checks of loader, Minecraft/loader/Java versions, dependencies, conflicts and damaged files; jar metadata first.
- Scope 06, Accounts and settings: multiple offline accounts with fixed UUIDs (rename-safe); settings page with per-profile memory and argument overrides.

Out of scope until a scope covers it: Microsoft login, Forge/NeoForge, CurseForge, mod updates, modpacks, skins, multiplayer server lists.

## Stack

- Electron 44 + TypeScript 6 (`strict`, `noUncheckedIndexedAccess`)
- electron-vite 5 (build/dev) on Vite 7; React 19 (renderer UI)
- Tailwind CSS 4 + Radix UI primitives (`radix-ui`), icons from `lucide-react`
- i18next / react-i18next, TanStack Query (async IPC data), react-router (hash routing)
- zod (validate every JSON read from disk or network), fflate (unzip native and mod jars)
- Vitest + Testing Library (tests), ESLint + Prettier, electron-builder (packaging)
- npm, Node 22

Version pins: electron-vite 5 needs **Vite ≤ 7** (so `@vitejs/plugin-react` 5.x), and typescript-eslint needs **TypeScript < 6.1**. Don't bump those past the limits. Fix peer conflicts by pinning, never with `--force` / `--legacy-peer-deps`.

`dependencies` holds only what the main/preload process loads at runtime. Renderer libraries go in `devDependencies`, because Vite bundles them and electron-builder would otherwise copy them into the app again.

## Architecture

- `src/main/`: Electron main process. Does all file system, network and process work.
  - `src/main/minecraft/`: core launcher logic (version list, installing, launching). Plain TypeScript with **no Electron imports**, so it can be tested on its own.
  - `src/main/core/`: helpers every scope uses: `fsAtomic.ts` (`writeJsonAtomic`, `readJson` with a zod schema), `logger.ts`, `errors.ts` (`AppError` with a `code`). No Electron imports.
  - `src/main/auth/`: login providers behind `AuthProvider` (`providers/offline.ts`), and `accountStore.ts`. No Electron imports.
  - `src/main/profiles/`: profiles (`launcher/profiles.json`), world sync (worlds live in `worlds/`, linked into `profiles/<id>/saves/`, owner flag in each world), and migration of old `games/<versionId>/` folders. `links.ts` is the only place that knows link types; delete folders with its `removeTree`, which never follows links. `mods.ts` is the shared mod library (`mods-store/<sha1>.jar`, hard-linked into profiles, `launcher/mods.json`). No Electron imports.
  - `src/main/modsources/`: mod websites behind `ModSource` (`modrinth.ts` is the only adapter; nothing else knows Modrinth URLs or JSON). `resolveDependencies.ts` and `downloadMods.ts` use the interface only; tests use `testing/fakeModSource.ts`. No Electron imports.
  - `src/main/validation/`: mod checks before launch and on the Mods tab. `validate.ts` is a pure function (profile + enabled mods → issues, and which mod needs which); `collect.ts` gathers its input, `integrity.ts` checks files for damage, `versions/` parses Fabric/Maven ranges and Minecraft ids. Issues carry a `code` + params; the renderer words them. No Electron imports.
  - `src/main/settings/`: `bootstrap.json` (where the data folder is, in Electron's userData) and `launcher/settings.json`.
  - `src/main/services/`: `launcherService.ts` is the composition root that wires the core to Electron (`net.fetch`, windows, events); `current.ts` holds the service for the chosen data folder.
  - `src/main/ipc/`: one `register…Ipc()` file per feature, using `handle()` and `broadcast()` from `register.ts`.
- `src/preload/`: exposes a small typed API to the renderer via `contextBridge`.
- `src/renderer/`: React UI only. No Node or file system access.
- `src/shared/`: types and IPC channel names shared by the processes. No Node or DOM types here.

Security: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. The CSP lives in a `<meta>` tag in `src/renderer/index.html` (it's removed only in dev). New windows and navigation are blocked; http(s) links open in the system browser.

## Code rules

- **IPC**: every channel is declared in `src/shared/ipc.ts` (the contract plus `INVOKE_CHANNELS` / `EVENT_CHANNELS`). Main registers it with `handle()`; the renderer calls `invoke()` from `src/renderer/src/lib/api.ts`. Handlers throw `AppError(code, message)`, and the renderer receives an `IpcCallError` with the same `code`.
- **UI text** only through i18n keys in `src/renderer/src/i18n/locales/en.json` (`t('…')` is type-checked). No hard-coded user-facing strings.
- **Styling**: use the theme tokens only (`bg-surface`, `text-muted`, `border-border`, `bg-accent`, `rounded-ezl`, …, defined in `src/renderer/src/styles/theme.css`). No raw colour values in components. Use logical properties (`ms-`, `pe-`, `start-`, `border-e`) so right-to-left works.
- **Files on disk**: write JSON with `writeJsonAtomic`, read it with `readJson(path, schema)`. Build every path under the data folder with `src/main/minecraft/paths.ts` (it validates ids so renderer input can't escape the folder; use `safeJoin` for relative paths from downloaded data).
- **Core modules take their dependencies as arguments** (`paths`, `downloader`, `platform`, `fetch`), so tests use fakes (`src/main/minecraft/testing/fakeFetch.ts`) and never touch the network.
- **Tests** sit next to the file: `foo.ts` → `foo.test.ts`. Node tests for `src/main` and `src/shared`, jsdom tests for `src/renderer`.
- ESLint enforces the process boundaries: the renderer can't import Electron/Node/main code, and `core/` + `minecraft/` can't import Electron.

## Launcher rules

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

Development happens on **native Windows** (the project lives in `C:\Users\Ramin\Desktop\pprojects\ezlauncher`; use PowerShell). The game must be tested on Windows: inside WSL it has no GPU (Mesa `llvmpipe` software rendering) and runs too slowly to judge. `node_modules` holds platform-specific binaries (Electron), so never share it between Windows and WSL; each checkout runs its own `npm install`.

## Commands

- `npm run dev`: start the app with hot reload
- `npm run build`: type check, then build into `out/`
- `npm run typecheck` · `npm run lint` · `npm run format` (`format:check` in checks) · `npm test` (`test:watch`)
- `npm run package` / `package:win` / `package:linux`: build installers into `release/`
- `npm run mc -- <list|install|check|command|launch> [id] --data <dir>`: Node-only dev CLI for the launcher core (no Electron). Handy for testing installs against Mojang's real servers, e.g. `npm run mc -- install 1.8.9 --data /tmp/mc`.

Before finishing any change: `npm run typecheck && npm run lint && npm run format:check && npm test`.

If Electron starts as plain Node (`Cannot read properties of undefined (reading 'isPackaged')`), the shell has `ELECTRON_RUN_AS_NODE=1` (VS Code's extension host sets it). Run with `env -u ELECTRON_RUN_AS_NODE npm run dev`.
