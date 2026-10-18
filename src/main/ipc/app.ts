import { statfs } from "node:fs/promises";
import { homedir, release, totalmem, type as osType, userInfo } from "node:os";
import { join } from "node:path";
import { app } from "electron";
import { APP_DISPLAY_NAME } from "@shared/app";
import { formatDiagnostics } from "../diagnostics/diagnostics";
import { LOG_SECTION_BYTES, readTail } from "../diagnostics/logTail";
import { getService, hasService } from "../services/current";
import { currentBuild } from "../services/updates";
import { canCreateShortcuts } from "../shortcuts";
import { handle } from "./register";

function osUserName(): string | undefined {
  try {
    return userInfo().username;
  } catch {
    return undefined;
  }
}

async function freeMb(dir: string): Promise<number | undefined> {
  try {
    const s = await statfs(dir);
    return Math.floor((s.bavail * s.bsize) / (1024 * 1024));
  } catch {
    return undefined;
  }
}

export function registerAppIpc(): void {
  handle("app:getInfo", () => ({
    appName: APP_DISPLAY_NAME,
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    node: process.versions.node,
    totalMemoryMb: Math.floor(totalmem() / (1024 * 1024)),
    canCreateShortcuts: canCreateShortcuts(),
  }));

  // "Copy diagnostics": the app part always, the data-folder part once there is one.
  handle("app:diagnostics", async (_e, options) => {
    const data = hasService()
      ? await getService().diagnostics(
          typeof options?.profileId === "string"
            ? options.profileId
            : undefined,
        )
      : undefined;
    const userName = osUserName();
    return formatDiagnostics({
      createdAt: new Date().toISOString(),
      app: {
        version: app.getVersion(),
        build: currentBuild().kind,
        electron: process.versions.electron,
        os: `${osType()} ${release()}`,
        arch: process.arch,
        totalMemoryMb: Math.floor(totalmem() / (1024 * 1024)),
        ...(data && {
          dataDriveFreeMb: await freeMb(data.secrets.dataDir),
        }),
      },
      ...(data?.settings && { settings: data.settings }),
      ...(data?.java && { java: data.java }),
      ...(data?.profile && { profile: data.profile }),
      launcherLog: await readTail(
        join(app.getPath("logs"), "launcher.log"),
        150,
        LOG_SECTION_BYTES,
      ),
      secrets: {
        homeDir: homedir(),
        ...(userName && { userName }),
        ...(data && data.secrets),
      },
    });
  });
}
