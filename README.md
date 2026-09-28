# ezlauncher

A desktop launcher for Minecraft: Java Edition, focused on offline play: multiple versions, mod loaders, profiles and a shared mod library.

The plan for every feature is in [scopes.md](scopes.md). Guidance for contributors and AI agents is in [CLAUDE.md](CLAUDE.md).

## Requirements

- Node.js 22 or newer, npm
- Windows 10/11 (primary target), Linux or macOS

## Getting started

```bash
npm install
npm run dev
```

## Commands

| Command                                 | What it does                                      |
| --------------------------------------- | ------------------------------------------------- |
| `npm run dev`                           | Start the app with hot reload                     |
| `npm run build`                         | Type check and build into `out/`                  |
| `npm run typecheck`                     | TypeScript checks for main/preload and renderer   |
| `npm run lint`                          | ESLint                                            |
| `npm run format`                        | Format with Prettier (`format:check` only checks) |
| `npm test`                              | Run the tests (`test:watch` to keep watching)     |
| `npm run package:win` / `package:linux` | Build an installer into `release/`                |

## License

[MIT](LICENSE)
