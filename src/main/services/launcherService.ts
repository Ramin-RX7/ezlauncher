import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { app, BrowserWindow, net, shell } from "electron";
import { mkdir } from "node:fs/promises";
import type {
  AccountInfo,
  InstallProgress,
  LaunchTarget,
  LoaderInfo,
  RunningGame,
  VersionListResult,
} from "@shared/launcher";
import { createAccountStore } from "../auth/accountStore";
import { OFFLINE_PROVIDER_ID } from "../auth/providers/offline";
import { getProvider } from "../auth/registry";
import type { Account } from "../auth/types";
import { AppError } from "../core/errors";
import type { Logger } from "../core/logger";
import { broadcast } from "../ipc/register";
import { buildLaunchCommand } from "../minecraft/arguments";
import { createDownloader } from "../minecraft/downloader";
import { launchGame } from "../minecraft/gameProcess";
import {
  deleteVersion,
  installVersion,
  isInstalled,
  listDependents,
  readInstallMarker,
  type InstalledVersion,
  type InstallMode,
} from "../minecraft/installer";
import { InstallQueue } from "../minecraft/installQueue";
import {
  installLoader,
  prepareLoader,
  type LoaderInstallRequest,
} from "../minecraft/loaders/installLoader";
import {
  createLoaderRegistry,
  getSupportedGameVersions,
} from "../minecraft/loaders/registry";
import { getVersionList, listInstalledVersions } from "../minecraft/manifest";
import { createPaths } from "../minecraft/paths";
import { detectPlatform } from "../minecraft/platform";
import { createSettingsStore } from "../settings/settings";

/**
 * The composition root for one data folder: wires the Electron-free core
 * (downloads, installs, launches) to Electron (network, windows, IPC events).
 */
export function createLauncherService(dataDir: string, logger: Logger) {
  const log = logger.child("launcher");
  const paths = createPaths(dataDir);
  const platform = detectPlatform();
  const downloader = createDownloader({
    // Electron's fetch uses the system proxy settings.
    fetch: (url, init) => net.fetch(url, init),
    userAgent: `ezlauncher/${app.getVersion()}`,
    logger: logger.child("download"),
  });
  const deps = { paths, downloader, platform, logger: log };
  const loaders = createLoaderRegistry({ downloader });
  const loaderDeps = { ...deps, loaders };
  const settings = createSettingsStore(paths.launcherFile("settings.json"));
  const accounts = createAccountStore(paths.launcherFile("accounts.json"));
  const queue = new InstallQueue((event) => {
    broadcast("install:state", event);
  });
  const running = new Map<string, RunningGame>();

  const onProgress = (p: InstallProgress): void => {
    broadcast("install:progress", p);
  };

  function queueLoaderInstall(
    request: LoaderInstallRequest,
    mode: InstallMode,
  ): Promise<InstalledVersion> {
    return queue.enqueue(request.versionId, (signal) =>
      installLoader(loaderDeps, request, { mode, signal, onProgress }),
    );
  }

  /** Install, check or repair an installed version; loader installs go through their loader. */
  async function ensureInstalled(
    versionId: string,
    mode: InstallMode,
  ): Promise<InstalledVersion> {
    const loader = (await readInstallMarker(paths, versionId))?.loader;
    if (loader) {
      return queueLoaderInstall(
        {
          providerId: loader.id,
          gameVersion: loader.gameVersion,
          loaderVersion: loader.loaderVersion,
          versionId,
        },
        mode,
      );
    }
    return queue.enqueue(versionId, (signal) =>
      installVersion(deps, versionId, { mode, signal, onProgress }),
    );
  }

  /** Get a launch target ready: the version to start, installed or checked first. */
  async function prepareTarget(
    target: LaunchTarget,
  ): Promise<{ versionId: string; installed: InstalledVersion }> {
    if ("versionId" in target) {
      const { versionId } = target;
      const mode = (await isInstalled(paths, versionId)) ? "quick" : "install";
      return { versionId, installed: await ensureInstalled(versionId, mode) };
    }
    // An installed loader stays on its build: reuse it.
    const { gameVersion, loaderId } = target;
    const existing = (await listInstalledVersions(paths)).find(
      (v) => v.loader?.id === loaderId && v.loader.gameVersion === gameVersion,
    );
    if (existing) {
      return {
        versionId: existing.id,
        installed: await ensureInstalled(existing.id, "quick"),
      };
    }
    const request = await prepareLoader(loaderDeps, loaderId, gameVersion);
    return {
      versionId: request.versionId,
      installed: await queueLoaderInstall(request, "install"),
    };
  }

  function assertNotBusy(versionId: string): void {
    if (queue.isBusy(versionId)) {
      throw new AppError(
        "BUSY",
        "Wait for the install to finish or cancel it first.",
      );
    }
    if ([...running.values()].some((g) => g.versionId === versionId)) {
      throw new AppError("GAME_RUNNING", "Close the game first.");
    }
  }

  async function openFolder(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
    const error = await shell.openPath(dir);
    if (error) throw new AppError("OPEN_FAILED", error);
  }

  function toInfo(a: {
    id: string;
    username: string;
    uuid: string;
  }): AccountInfo {
    return { id: a.id, username: a.username, uuid: a.uuid };
  }

  async function selectedAccount() {
    const { accounts: list, selectedId } = await accounts.load();
    return list.find((a) => a.id === selectedId) ?? list[0];
  }

  function applyOnGameStart(mode: "keep" | "minimize" | "close"): void {
    if (mode === "minimize") {
      for (const w of BrowserWindow.getAllWindows()) w.minimize();
    }
    if (mode === "close") app.quit(); // the game keeps running on its own
  }

  return {
    paths,

    listVersions(options: { refresh?: boolean }): Promise<VersionListResult> {
      return getVersionList(deps, options);
    },

    async installVersion(versionId: string): Promise<void> {
      await ensureInstalled(versionId, "install");
    },

    async repairVersion(versionId: string): Promise<void> {
      await ensureInstalled(versionId, "repair");
    },

    listLoaders({ refresh }: { refresh?: boolean }): Promise<LoaderInfo[]> {
      return Promise.all(
        loaders.providers.map(async (p) => ({
          id: p.id,
          displayName: p.displayName,
          gameVersions: await getSupportedGameVersions(p, paths, {
            ...(refresh !== undefined && { refresh }),
            logger: log,
          }),
        })),
      );
    },

    dependents: (versionId: string) => listDependents(paths, versionId),

    cancelInstall(versionId: string): boolean {
      return queue.cancel(versionId);
    },

    async deleteVersion(
      versionId: string,
      deleteGameDir: boolean,
      deleteDependents: boolean,
    ): Promise<void> {
      const dependents = await listDependents(paths, versionId);
      if (dependents.length > 0 && !deleteDependents) {
        throw new AppError(
          "HAS_DEPENDENTS",
          `Other installs use ${versionId}: ${dependents.join(", ")}`,
        );
      }
      for (const id of [...dependents, versionId]) assertNotBusy(id);
      // Dependents first, so a failure never leaves one without its base version.
      for (const id of dependents) {
        await deleteVersion(paths, id, { deleteGameDir });
      }
      await deleteVersion(paths, versionId, { deleteGameDir });
    },

    async openGameDir(versionId: string): Promise<void> {
      await openFolder(paths.gameDir(versionId));
    },

    async openModsDir(versionId: string): Promise<void> {
      await openFolder(paths.modsDir(versionId));
    },

    async getAccount(): Promise<AccountInfo | null> {
      const account = await selectedAccount();
      return account ? toInfo(account) : null;
    },

    /** Scope 01 has one offline account: create it, or rename it (keeping its UUID). */
    async setUsername(username: string): Promise<AccountInfo> {
      const data = await accounts.load();
      const provider = getProvider(OFFLINE_PROVIDER_ID);
      const current =
        data.accounts.find((a) => a.id === data.selectedId) ?? data.accounts[0];
      let account: Account;
      if (current && provider.renameAccount) {
        account = await provider.renameAccount(current, username);
        data.accounts = data.accounts.map((a) =>
          a.id === account.id ? account : a,
        );
      } else {
        account = await provider.createAccount({ username });
        data.accounts.push(account);
      }
      data.selectedId = account.id;
      await accounts.save(data);
      return toInfo(account);
    },

    getSettings: () => settings.load(),
    updateSettings: (patch: unknown) => settings.update(patch),

    runningGames: (): RunningGame[] => [...running.values()],

    async launch(target: LaunchTarget): Promise<RunningGame> {
      const account = await selectedAccount();
      if (!account) throw new AppError("NO_ACCOUNT", "Enter a username first.");
      const identity = await getProvider(account.providerId).getLaunchIdentity(
        account,
      );
      const current = await settings.load();

      const { versionId, installed } = await prepareTarget(target);

      const gameDir = paths.gameDir(versionId);
      const command = buildLaunchCommand({
        installed,
        identity,
        paths,
        platform,
        gameDir,
        memoryMaxMb: current.memoryMaxMb,
        launcherName: "ezlauncher",
        launcherVersion: app.getVersion(),
        logger: log,
      });
      log.info(`launching ${versionId} as ${identity.username}`);
      log.debug([command.javaPath, ...command.args].join(" "));

      const handle = await launchGame(command, {
        logFile: join(gameDir, "logs", "ezlauncher-output.log"),
      });
      const game: RunningGame = {
        launchId: randomUUID(),
        versionId,
        pid: handle.pid,
      };
      running.set(game.launchId, game);
      handle.onLog((lines) => {
        broadcast("game:log", { launchId: game.launchId, versionId, lines });
      });
      handle.onExit(({ code, crashed }) => {
        running.delete(game.launchId);
        log.info(
          `${versionId} exited with code ${String(code)}${crashed ? " (crashed)" : ""}`,
        );
        broadcast("game:exit", {
          launchId: game.launchId,
          versionId,
          code,
          crashed,
        });
      });
      broadcast("game:started", game);

      applyOnGameStart(current.onGameStart);
      return game;
    },
  };
}

export type LauncherService = ReturnType<typeof createLauncherService>;
