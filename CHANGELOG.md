# Changelog

All notable changes to EZLauncher are documented in this file. Add every user-facing change to the `[Unreleased]` section as it lands; `npm version` turns that section into the next release (see [RELEASING.md](RELEASING.md)).

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Group entries under `### Added`, `### Changed`, `### Deprecated`, `### Removed`, `### Fixed` or `### Security`.

## [Unreleased]

## [0.2.0] - 2026-10-02

### Added

- Resource packs: a shared library where each pack is stored once, however many profiles use it.
  - Integrated with Modrinth to search and add them to the library
  - Included when duplicating a profile
  - Version control
  - Dependency and compatibility checks
  - Order handling inside the launcher
- Shader packs: a shared shader library, stored once for every profile, with a Shaders tab in each profile to choose the shader Iris uses (or turn shaders off)
  - Integrated with Modrinth to search and add them to the library
  - Compatibility and dependency checks
  - Included when duplicating a profile
  - Version control
- Data packs: a shared data pack library, stored once, added to or removed from each world (a Data packs button on every world)
  - Add one pack to several worlds at once from the library
  - Integrated with Modrinth to search and download data packs (never the mod version of a project)
  - Compatibility checks against the world's Minecraft version
  - Shows packs turned off in game, and packs that need experimental features the world doesn't have
  - Included when duplicating a profile with its worlds, and in world backups
- Mod packs: import Modrinth mod packs (`.mrpack`) as profiles, from a file or by searching Modrinth (New profile → From a mod pack)
  - A mod pack profile is a normal profile; the same pack can be imported more than once
  - Its mods, resource packs and shaders go into the shared libraries (nothing already there is downloaded again)
  - Optional files can be left out when importing
  - Update a pack profile to another version: see what changes first; mods you added, files you changed and your worlds are kept, and replaced files are zipped first
  - Export any profile as a mod pack: mods from Modrinth are linked, everything else you choose goes inside the file
  - Pack profiles show the pack's icon, name and version
  - Packs for Forge or NeoForge are shown but can't be imported yet
- Profiles can pin a loader build (Fabric/Quilt) instead of always using the newest; mod packs use the build they were made for

### Changed

- The `Mod library` page is now the `Library`, with Mods, `Resource packs`, `Shaders` and `Data packs` tabs.
- The launcher remembers games that are still running after it is closed and opened again, and won't change those profiles' files until the game closes.

### Fixed

- A profile's mods and worlds could be changed while its game was still starting.

## [0.1.0] - 2026-09-30

### Added

- Initial items mentioned in the SCOPES document

[Unreleased]: https://github.com/Ramin-RX7/ezlauncher/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Ramin-RX7/ezlauncher/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Ramin-RX7/ezlauncher/releases/tag/v0.1.0
