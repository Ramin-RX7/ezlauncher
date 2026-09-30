# ezlauncher

A desktop launcher for Minecraft: Java Edition, focused on offline play: multiple versions, mod loaders, profiles and a shared mod library.

## Download

Get the latest version from the [Releases page](https://github.com/Ramin-RX7/ezlauncher/releases/latest):

- **Windows:** `EZLauncher-<version>-x64-setup.exe` (installer) or `EZLauncher-<version>-x64-portable.exe` (no installation needed).
- **Linux:** `EZLauncher-<version>-x86_64.AppImage`: make it executable (`chmod +x`) and run it.

The app is not code-signed yet, so Windows may show "Windows protected your PC". Click **More info → Run anyway**. Changes in each version are listed in [CHANGELOG.md](CHANGELOG.md).

Minecraft files are always downloaded from Mojang's servers, never bundled. EZLauncher is not an official Minecraft product and is not approved by or associated with Mojang or Microsoft.

## Development

The plan for every feature is in [scopes.md](scopes.md). Guidance for contributors and AI agents is in [CLAUDE.md](CLAUDE.md).

### Requirements

- Node.js 22 or newer, npm
- Windows 10/11 (primary target), Linux or macOS

### Getting started

```bash
npm install
npm run dev
```

### Commands

| Command                                 | What it does                                      |
| --------------------------------------- | ------------------------------------------------- |
| `npm run dev`                           | Start the app with hot reload                     |
| `npm run build`                         | Type check and build into `out/`                  |
| `npm run typecheck`                     | TypeScript checks for main/preload and renderer   |
| `npm run lint`                          | ESLint                                            |
| `npm run format`                        | Format with Prettier (`format:check` only checks) |
| `npm test`                              | Run the tests (`test:watch` to keep watching)     |
| `npm run package:win` / `package:linux` | Build the installers into `release/`              |

Releasing a new version is described in [RELEASING.md](RELEASING.md).

## License

[MIT](LICENSE)
