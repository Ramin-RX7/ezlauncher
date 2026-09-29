/**
 * Dev CLI for the launcher core, without Electron.
 *
 *   npm run mc -- list    --data <dir> [--refresh]
 *   npm run mc -- install <id> --data <dir> [--mode install|quick|repair]
 *   npm run mc -- check   <id> --data <dir> [--full]
 *   npm run mc -- command <id> --data <dir> [--user Name]
 *   npm run mc -- launch  <id> --data <dir> [--user Name]
 *
 * With `--loader fabric|quilt`, <id> is the Minecraft version and the loader is
 * installed on top of it (or the existing install of that loader is reused).
 */
import { join } from "node:path";
import { parseArgs } from "node:util";
import { offlineProvider } from "../src/main/auth/providers/offline";
import { createLogger } from "../src/main/core/logger";
import { buildLaunchCommand } from "../src/main/minecraft/arguments";
import { applyLegacyAssets } from "../src/main/minecraft/assets";
import { createDownloader } from "../src/main/minecraft/downloader";
import { launchGame } from "../src/main/minecraft/gameProcess";
import {
  installVersion,
  readInstallMarker,
  type InstallMode,
  type InstallOptions,
} from "../src/main/minecraft/installer";
import {
  installLoader,
  prepareLoader,
} from "../src/main/minecraft/loaders/installLoader";
import { createLoaderRegistry } from "../src/main/minecraft/loaders/registry";
import {
  getVersionList,
  listInstalledVersions,
} from "../src/main/minecraft/manifest";
import { createPaths } from "../src/main/minecraft/paths";
import { detectPlatform } from "../src/main/minecraft/platform";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    data: { type: "string" },
    mode: { type: "string", default: "install" },
    full: { type: "boolean", default: false },
    refresh: { type: "boolean", default: false },
    user: { type: "string", default: "DevPlayer" },
    loader: { type: "string" },
  },
});
const [cmd, id] = positionals;
if (!cmd || !values.data) {
  console.error(
    "usage: mc <list|install|check|command|launch> [id] --data <dir>",
  );
  process.exit(2);
}

const logger = createLogger({ level: "info" });
const paths = createPaths(values.data);
const platform = detectPlatform();
const requests: string[] = [];
const downloader = createDownloader({
  fetch,
  userAgent: "ezlauncher-dev-cli/0.1",
  logger,
  onRequest: (url) => requests.push(url),
});

function requireId(): string {
  if (!id) throw new Error(`${cmd} needs a version id`);
  return id;
}

const controller = new AbortController();
process.on("SIGINT", () => {
  console.log("\ncancelling…");
  controller.abort();
});

const loaders = createLoaderRegistry({ downloader });
const deps = { paths, downloader, platform, logger, loaders };

let lastLine = 0;
const options = (mode: InstallMode): InstallOptions => ({
  mode,
  signal: controller.signal,
  onProgress: (p) => {
    if (Date.now() - lastLine < 1000) return;
    lastLine = Date.now();
    const mb = (n: number) => (n / 1024 / 1024).toFixed(1);
    console.log(
      `  ${p.step}: ${p.files}/${p.totalFiles} files, ${mb(p.bytes)}/${mb(p.totalBytes)} MB`,
    );
  },
});

/** Resolve `<id> [--loader x]` to the version id to install and launch. */
async function install(id: string, mode: InstallMode) {
  const started = Date.now();
  let versionId = id;
  let result;
  if (values.loader) {
    const loaderId = values.loader;
    const existing = (await listInstalledVersions(paths)).find(
      (v) => v.loader?.id === loaderId && v.loader.gameVersion === id,
    );
    const request = existing?.loader
      ? {
          providerId: loaderId,
          gameVersion: id,
          loaderVersion: existing.loader.loaderVersion,
          versionId: existing.id,
        }
      : await prepareLoader(deps, loaderId, id);
    versionId = request.versionId;
    result = await installLoader(deps, request, options(mode));
  } else {
    const loader = (await readInstallMarker(paths, id))?.loader;
    result = loader
      ? await installLoader(
          deps,
          {
            providerId: loader.id,
            gameVersion: loader.gameVersion,
            loaderVersion: loader.loaderVersion,
            versionId: id,
          },
          options(mode),
        )
      : await installVersion(deps, id, options(mode));
  }
  console.log(
    `${versionId}: ${mode} done in ${((Date.now() - started) / 1000).toFixed(1)}s, ` +
      `${requests.length} network requests`,
  );
  return { versionId, installed: result };
}

async function command(id: string) {
  const { versionId, installed } = await install(id, "quick");
  await applyLegacyAssets(
    installed.assetIndex,
    installed.assetIndexId,
    paths,
    paths.devGameDir(versionId),
  );
  const account = await offlineProvider.createAccount({
    username: values.user,
  });
  const identity = await offlineProvider.getLaunchIdentity(account);
  const cmd = buildLaunchCommand({
    installed,
    identity,
    paths,
    platform,
    gameDir: paths.devGameDir(versionId),
    memoryMaxMb: 2048,
    launcherName: "ezlauncher",
    launcherVersion: "dev",
    logger,
  });
  return { versionId, cmd };
}

try {
  switch (cmd) {
    case "list": {
      const list = await getVersionList(
        { paths, downloader },
        { refresh: values.refresh },
      );
      console.log(
        `${list.versions.length} versions (source: ${list.source}, fetched ${list.fetchedAt ?? "never"})`,
      );
      console.log(
        `latest: ${JSON.stringify(list.latest)}; requests: ${requests.length}`,
      );
      if (list.refreshError) console.log(`refresh error: ${list.refreshError}`);
      break;
    }
    case "install":
      await install(requireId(), values.mode as InstallMode);
      break;
    case "check":
      await install(requireId(), values.full ? "repair" : "quick");
      break;
    case "command": {
      const { cmd: c } = await command(requireId());
      console.log(
        [c.javaPath, ...c.args].map((a) => JSON.stringify(a)).join(" \\\n  "),
      );
      break;
    }
    case "launch": {
      const { versionId, cmd: c } = await command(requireId());
      const game = await launchGame(c, {
        logFile: join(
          paths.devGameDir(versionId),
          "logs",
          "ezlauncher-output.log",
        ),
      });
      console.log(`started pid ${game.pid}`);
      game.onLog((lines) => {
        for (const l of lines) console.log(`[game] ${l}`);
      });
      await new Promise<void>((resolve) => {
        game.onExit((exit) => {
          console.log(`game exited: ${JSON.stringify(exit)}`);
          resolve();
        });
      });
      break;
    }
    default:
      throw new Error(`unknown command ${cmd}`);
  }
} catch (err) {
  console.error("failed:", err);
  process.exit(1);
}
