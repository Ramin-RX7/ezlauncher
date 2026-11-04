import type { JavaInstallProgress, JavaListResult } from "@shared/launcher";
import { AppError } from "../core/errors";
import type { Downloader } from "../minecraft/downloader";
import type { InstallQueue } from "../minecraft/installQueue";
import { ensureJava } from "../minecraft/java";
import {
  isJavaComponent,
  javaUsage,
  listJavaRuntimes,
  removeJavaRuntime,
} from "../minecraft/javaRuntimes";
import type { Paths } from "../minecraft/paths";
import type { Platform } from "../minecraft/platform";
import { detectSystemJava } from "../minecraft/systemJava";
import type { Runtime } from "./runtime";

export interface JavaServiceDeps {
  paths: Paths;
  downloader: Downloader;
  platform: Platform;
  /** Version installs (they use the same runtime files). */
  queue: Pick<InstallQueue, "isAnyBusy">;
  runtime: Runtime;
  /** Resolves once startup (migration, first sync) is done. */
  whenReady: () => Promise<void>;
  progress: (p: JavaInstallProgress) => void;
}

/** Java runtimes from Settings: list, install, cancel, remove. */
export function createJavaService(deps: JavaServiceDeps) {
  const { paths, downloader, platform, queue, runtime, whenReady } = deps;

  /** A Java runtime install from Settings; version installs wait for it (same files). */
  let javaInstall:
    | { component: string; controller: AbortController; done: Promise<void> }
    | undefined;

  return {
    /** Resolves once a Java install from Settings (if any) is over, however it ends. */
    afterJava: (): Promise<void> =>
      javaInstall ? javaInstall.done.catch(() => undefined) : Promise.resolve(),

    /** A Java install is running. */
    isBusy: (): boolean => javaInstall !== undefined,

    api: {
      /** Mojang runtimes (installed and offered) and Java found on the computer. */
      async listJava(): Promise<JavaListResult> {
        await whenReady();
        const [{ runtimes, offline }, system] = await Promise.all([
          listJavaRuntimes({ paths, downloader, platform }),
          detectSystemJava({ platform, exclude: [paths.runtimesDir] }),
        ]);
        return { runtimes, system, offline };
      },

      /** Download (or complete) a Mojang Java runtime, checking every file. */
      async installJava(component: string): Promise<void> {
        await whenReady();
        if (typeof component !== "string" || !isJavaComponent(component))
          throw new AppError("JAVA_UNAVAILABLE", "Unknown Java runtime.");
        if (runtime.moving)
          throw new AppError("BUSY", "The data folder is moving.");
        if (javaInstall)
          throw new AppError("BUSY", "Java is already being installed.");
        if (queue.isAnyBusy())
          throw new AppError("BUSY", "Wait for installs to finish.");
        const controller = new AbortController();
        const done = ensureJava({
          component,
          platform,
          paths,
          downloader,
          mode: "full",
          signal: controller.signal,
          onProgress: (p) => {
            deps.progress({ component, ...p });
          },
        }).then(() => undefined);
        javaInstall = { component, controller, done };
        try {
          await done;
        } finally {
          javaInstall = undefined;
        }
      },

      cancelJavaInstall(): void {
        javaInstall?.controller.abort();
      },

      /**
       * Delete a Mojang runtime. Versions that use it download it again when played;
       * refused while a game runs on it or something is installing.
       */
      async removeJava(component: string): Promise<void> {
        await whenReady();
        if (typeof component !== "string" || !isJavaComponent(component))
          throw new AppError("JAVA_UNAVAILABLE", "Unknown Java runtime.");
        if (javaInstall || queue.isAnyBusy())
          throw new AppError("BUSY", "Wait for installs to finish.");
        const users = (await javaUsage(paths)).get(component) ?? [];
        if (
          [...runtime.running.values()].some((g) => users.includes(g.versionId))
        )
          throw new AppError("GAME_RUNNING", "Close the game first.");
        await removeJavaRuntime(paths, component);
      },
    },
  };
}
