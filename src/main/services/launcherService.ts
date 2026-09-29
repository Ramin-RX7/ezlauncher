import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { app, BrowserWindow, net, shell } from "electron";
import type {
  AccountInfo,
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
  type InstallMode,
} from "../minecraft/installer";
import { InstallQueue } from "../minecraft/installQueue";
import { getVersionList } from "../minecraft/manifest";
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
  const settings = createSettingsStore(paths.launcherFile("settings.json"));
  const accounts = createAccountStore(paths.launcherFile("accounts.json"));
  const queue = new InstallQueue((event) => {
    broadcast("install:state", event);
  });
  const running = new Map<string, RunningGame>();

  function install(versionId: string, mode: InstallMode) {
    return queue.enqueue(versionId, (signal) =>
      installVersion(deps, versionId, {
        mode,
        signal,
        onProgress: (p) => {
          broadcast("install:progress", p);
        },
      }),
    );
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
      await install(versionId, "install");
    },

    async repairVersion(versionId: string): Promise<void> {
      await install(versionId, "repair");
    },

    cancelInstall(versionId: string): boolean {
      return queue.cancel(versionId);
    },

    async deleteVersion(
      versionId: string,
      deleteGameDir: boolean,
    ): Promise<void> {
      if (queue.isBusy(versionId)) {
        throw new AppError(
          "BUSY",
          "Wait for the install to finish or cancel it first.",
        );
      }
      if ([...running.values()].some((g) => g.versionId === versionId)) {
        throw new AppError("GAME_RUNNING", "Close the game first.");
      }
      await deleteVersion(paths, versionId, { deleteGameDir });
    },

    async openGameDir(versionId: string): Promise<void> {
      const { mkdir } = await import("node:fs/promises");
      await mkdir(paths.gameDir(versionId), { recursive: true });
      const error = await shell.openPath(paths.gameDir(versionId));
      if (error) throw new AppError("OPEN_FAILED", error);
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

    async launch(versionId: string): Promise<RunningGame> {
      const account = await selectedAccount();
      if (!account) throw new AppError("NO_ACCOUNT", "Enter a username first.");
      const identity = await getProvider(account.providerId).getLaunchIdentity(
        account,
      );
      const current = await settings.load();

      const mode: InstallMode = (await isInstalled(paths, versionId))
        ? "quick"
        : "install";
      const installed = await install(versionId, mode);

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
