# Changelog

All notable changes to EZLauncher are documented in this file. Add every user-facing change to the `[Unreleased]` section as it lands; `npm version` turns that section into the next release (see [RELEASING.md](RELEASING.md)).

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Group entries under `### Added`, `### Changed`, `### Deprecated`, `### Removed`, `### Fixed` or `### Security`.

## [Unreleased]

### Added

- Resource packs: a shared library where each pack is stored once, however many profiles use it.
  + Integrated with Mondrith API to search and them to library.
  + Included when duplicating a profile
  + Version control
  + Dependency and Compatibility checks
  + Order handling inside the launcher
- Shader packs: a shared shader library, stored once for every profile, with a Shaders tab in each profile to choose the shader Iris uses (or turn shaders off)
  + integrated with Mondrith to search and add to library.
  + Compatibility and Dependency checks
  + in cluded when duplicating a profile
  + Version control

### Changed

- The `Mod library` page is now the `Library`, with Mods, Resource packs and Shaders tabs.
- The launcher remembers games that are still running after it is closed and opened again, and won't change those profiles' files until the game closes.

### Fixed

- A profile's mods and worlds could be changed while its game was still starting.

## [0.1.0] - 2026-09-30

### Added

- Initial items mentioned in the SCOPES document

[Unreleased]: https://github.com/Ramin-RX7/ezlauncher/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Ramin-RX7/ezlauncher/releases/tag/v0.1.0
