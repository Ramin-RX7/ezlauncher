import type {
  LauncherSettings,
  LibraryMod,
  LoaderInfo,
  ProfileInfo,
  VersionListResult,
} from "@shared/launcher";

export const versionList: VersionListResult = {
  source: "cache",
  fetchedAt: "2026-09-01T10:00:00.000Z",
  latest: { release: "26.3", snapshot: "26.4-snapshot-1" },
  versions: [
    {
      id: "26.4-snapshot-1",
      type: "snapshot",
      releaseTime: "2026-09-22T00:00:00Z",
      installed: false,
    },
    {
      id: "26.3",
      type: "release",
      releaseTime: "2026-09-01T00:00:00Z",
      installed: true,
    },
    {
      id: "fabric-loader-0.19.5-1.18.2",
      type: "release",
      releaseTime: "2022-02-28T00:00:00Z",
      installed: true,
      loader: { id: "fabric", loaderVersion: "0.19.5", gameVersion: "1.18.2" },
    },
    {
      id: "1.18.2",
      type: "release",
      releaseTime: "2022-02-28T00:00:00Z",
      installed: true,
    },
    {
      id: "1.12.2",
      type: "release",
      releaseTime: "2017-09-18T00:00:00Z",
      installed: false,
    },
  ],
};

export const loaders: LoaderInfo[] = [
  { id: "fabric", displayName: "Fabric", gameVersions: ["26.3", "1.18.2"] },
  { id: "quilt", displayName: "Quilt", gameVersions: ["1.18.2"] },
];

export function profile(overrides: Partial<ProfileInfo> = {}): ProfileInfo {
  return {
    id: "p1",
    name: "Survival",
    gameVersion: "1.18.2",
    loader: { id: "fabric" },
    installedVersionId: "fabric-loader-0.19.5-1.18.2",
    createdAt: "2026-09-01T00:00:00Z",
    running: 0,
    ...overrides,
  };
}

export function settings(
  overrides: Partial<LauncherSettings> = {},
): LauncherSettings {
  return {
    memoryMaxMb: 2048,
    extraJvmArgs: [],
    extraGameArgs: [],
    onGameStart: "keep",
    showSnapshots: false,
    showOldBeta: false,
    showOldAlpha: false,
    selectedProfileId: null,
    selectedAccountId: null,
    ...overrides,
  };
}

export const steve = { id: "a1", username: "Steve", uuid: "u" };

/** A library mod as a profile sees it: compatible, not enabled. */
export function libraryMod(overrides: Partial<LibraryMod> = {}): LibraryMod {
  return {
    sha1: "a".repeat(40),
    fileName: "m.jar",
    name: "Mod",
    loaders: ["fabric"],
    hasIcon: false,
    addedAt: "2026-09-01T00:00:00Z",
    usedBy: [],
    enabled: false,
    checked: true,
    compat: { status: "compatible" },
    ...overrides,
  };
}
