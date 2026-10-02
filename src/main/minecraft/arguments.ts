import { formatServerAddress, type ServerAddress } from "@shared/serverAddress";
import type { LaunchIdentity } from "../auth/types";
import { AppError } from "../core/errors";
import type { Logger } from "../core/logger";
import { gameAssetsDir } from "./assets";
import type { InstalledVersion } from "./installer";
import type { Paths } from "./paths";
import type { Platform } from "./platform";
import { rulesAllow, type RuleEnv } from "./rules";
import type { Argument, VersionJson } from "./schemas";

export interface LaunchContext {
  installed: InstalledVersion;
  identity: LaunchIdentity;
  paths: Paths;
  platform: Platform;
  gameDir: string;
  memoryMaxMb: number;
  /** Extra JVM arguments (one item each), after the version's and before the main class. */
  extraJvmArgs?: readonly string[];
  /** Extra game arguments (one item each), after the version's. */
  extraGameArgs?: readonly string[];
  launcherName: string;
  launcherVersion: string;
  logger?: Logger;
  /** Start straight into a world (its folder in `saves/`) or onto a server. */
  quickPlay?: QuickPlayTarget;
}

export type QuickPlayTarget =
  | { kind: "world"; worldId: string }
  | { kind: "server"; address: ServerAddress };

const DEFAULT_PORT = 25565;

export interface LaunchCommand {
  javaPath: string;
  args: string[];
  cwd: string;
}

/** Launcher features referenced by `features` rules; Quick Play is turned on per launch. */
const FEATURES: Readonly<Record<string, boolean>> = {
  is_demo_user: false,
  has_custom_resolution: false,
  has_quick_plays_support: false,
  is_quick_play_singleplayer: false,
  is_quick_play_multiplayer: false,
  is_quick_play_realms: false,
};

/** Rule-filter a list of arguments into plain strings. */
export function flattenArguments(
  list: readonly Argument[],
  env: RuleEnv,
): string[] {
  const out: string[] = [];
  for (const arg of list) {
    if (typeof arg === "string") out.push(arg);
    else if (rulesAllow(arg.rules, env)) {
      out.push(...(Array.isArray(arg.value) ? arg.value : [arg.value]));
    }
  }
  return out;
}

/** JVM arguments old versions (before `arguments.jvm` existed) need. */
function legacyJvmArguments(platform: Platform): string[] {
  const args: string[] = [];
  if (platform.os === "osx") args.push("-XstartOnFirstThread");
  if (platform.os === "windows") {
    args.push(
      "-XX:HeapDumpPath=MojangTricksIntelDriversForPerformance_javaw.exe_minecraft.exe.heapdump",
    );
  }
  if (platform.arch === "x86") args.push("-Xss1M");
  args.push("-Djava.library.path=${natives_directory}", "-cp", "${classpath}");
  return args;
}

export function substitute(
  arg: string,
  values: Record<string, string>,
  onUnknown?: (name: string) => void,
): string {
  return arg.replace(/\$\{([A-Za-z0-9_]+)\}/g, (match, name: string) => {
    const value = values[name];
    if (value === undefined) {
      onUnknown?.(name);
      return match;
    }
    return value;
  });
}

/** Does a version's argument list name this feature (i.e. the game understands it)? */
function namesFeature(version: VersionJson, feature: string): boolean {
  return (version.arguments?.game ?? []).some(
    (a) =>
      typeof a !== "string" &&
      (a.rules ?? []).some((r) => r.features?.[feature] !== undefined),
  );
}

/**
 * What Quick Play a (merged) version supports: worlds only through Quick Play
 * (1.20+); servers through Quick Play, or the old `--server`/`--port` arguments.
 */
export function quickPlaySupport(version: VersionJson): {
  worlds: boolean;
  servers: "quickPlay" | "legacy";
} {
  return {
    worlds: namesFeature(version, "is_quick_play_singleplayer"),
    servers: namesFeature(version, "is_quick_play_multiplayer")
      ? "quickPlay"
      : "legacy",
  };
}

export function buildLaunchCommand(ctx: LaunchContext): LaunchCommand {
  const { installed, identity, paths, platform, gameDir, quickPlay } = ctx;
  const { version, libraries, clientJar, assetIndex, assetIndexId } = installed;
  const support = quickPlay ? quickPlaySupport(version) : undefined;
  if (quickPlay?.kind === "world" && !support?.worlds)
    throw new AppError(
      "QUICKPLAY_UNSUPPORTED",
      "Starting straight into a world needs Minecraft 1.20 or newer.",
    );
  const quickServer =
    quickPlay?.kind === "server" && support?.servers === "quickPlay";
  const env: RuleEnv = {
    platform,
    features: {
      ...FEATURES,
      is_quick_play_singleplayer: quickPlay?.kind === "world",
      is_quick_play_multiplayer: quickServer,
    },
  };
  // Old versions take a server as two plain arguments.
  const legacyServer =
    quickPlay?.kind === "server" && !quickServer
      ? [
          "--server",
          quickPlay.address.host,
          "--port",
          String(quickPlay.address.port ?? DEFAULT_PORT),
        ]
      : [];

  const classpath = [...libraries.classpath.map((t) => t.dest), clientJar].join(
    platform.classpathSeparator,
  );

  const values: Record<string, string> = {
    auth_player_name: identity.username,
    auth_uuid: identity.uuid,
    auth_access_token: identity.accessToken,
    auth_session: identity.accessToken,
    auth_xuid: identity.xuid ?? "0",
    clientid: identity.clientId ?? "0",
    user_type: identity.userType,
    user_properties: "{}",
    version_name: version.id,
    version_type: version.type ?? "release",
    game_directory: gameDir,
    assets_root: paths.assetsDir,
    game_assets: gameAssetsDir(assetIndex, assetIndexId, paths, gameDir),
    assets_index_name: assetIndexId,
    natives_directory: paths.nativesDir(version.id),
    library_directory: paths.librariesDir,
    classpath,
    classpath_separator: platform.classpathSeparator,
    launcher_name: ctx.launcherName,
    launcher_version: ctx.launcherVersion,
    ...(quickPlay?.kind === "world" && {
      quickPlaySingleplayer: quickPlay.worldId,
    }),
    ...(quickPlay?.kind === "server" && {
      quickPlayMultiplayer: formatServerAddress(quickPlay.address),
    }),
  };
  const unknown = new Set<string>();
  const fill = (a: string) => substitute(a, values, (n) => unknown.add(n));

  // Old versions have no JVM arguments of their own. A mod loader may still add some,
  // so the legacy ones are needed whenever nothing sets the classpath.
  const versionJvm = flattenArguments(version.arguments?.jvm ?? [], env);
  const setsClasspath = versionJvm.some((a) => a.includes("${classpath}"));
  const jvm = [
    `-Xmx${ctx.memoryMaxMb}M`,
    ...(setsClasspath ? [] : legacyJvmArguments(platform)),
    ...versionJvm,
  ].map(fill);

  const logging = version.logging?.client;
  if (logging) {
    jvm.push(
      logging.argument.replace("${path}", paths.logConfig(logging.file.id)),
    );
  }

  // Old versions: one space-separated string. New: a list. A mod loader may add to either.
  const game = [
    ...(version.minecraftArguments?.split(/\s+/).filter(Boolean) ?? []),
    ...flattenArguments(version.arguments?.game ?? [], env),
  ].map(fill);
  game.push(...legacyServer);

  if (unknown.size > 0) {
    ctx.logger?.warn(`unknown launch placeholders: ${[...unknown].join(", ")}`);
  }

  const mainClass = version.mainClass ?? "net.minecraft.client.main.Main";
  return {
    javaPath: installed.javaPath,
    // Extra arguments are passed as they are: never through a shell, no placeholders.
    args: [
      ...jvm,
      ...(ctx.extraJvmArgs ?? []),
      mainClass,
      ...game,
      ...(ctx.extraGameArgs ?? []),
    ],
    cwd: gameDir,
  };
}
