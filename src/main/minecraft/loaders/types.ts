import type { InstallStep } from "@shared/launcher";
import type { Downloader } from "../downloader";
import type { Paths } from "../paths";
import type { VersionJson } from "../schemas";

/**
 * One mod loader (Fabric, Quilt; later Forge, NeoForge). Everything specific to a
 * loader lives behind this interface; the install and launch code never parses
 * loader version ids or knows loader server URLs.
 */
export interface LoaderProvider {
  /** Stable id stored in install markers, e.g. `fabric`. */
  id: string;
  displayName: string;
  /** Minecraft versions this loader supports. */
  listGameVersions(signal?: AbortSignal): Promise<string[]>;
  /** The newest stable loader build for a Minecraft version. */
  getLatestLoaderVersion(
    gameVersion: string,
    signal?: AbortSignal,
  ): Promise<string>;
  /** Every loader build for a Minecraft version, newest first. */
  listLoaderVersions(
    gameVersion: string,
    signal?: AbortSignal,
  ): Promise<LoaderBuild[]>;
  /** The loader's version JSON; it has `inheritsFrom` pointing at the game version. */
  getVersionJson(
    gameVersion: string,
    loaderVersion: string,
    signal?: AbortSignal,
  ): Promise<VersionJson>;
  /** Extra install steps (e.g. Forge processors). Not used by Fabric or Quilt. */
  postInstall?(ctx: LoaderInstallContext): Promise<void>;
}

export interface LoaderBuild {
  version: string;
  /** false = a beta or pre-release build. */
  stable: boolean;
}

export interface LoaderInstallContext {
  gameVersion: string;
  loaderVersion: string;
  versionId: string;
  paths: Paths;
  download: Downloader;
  /** Path to a Java executable for this Mojang runtime component. */
  getJava(component: string): Promise<string>;
  signal: AbortSignal;
  progress(step: InstallStep, done: number, total: number): void;
}
