import { AppError } from "../../core/errors";
import { readJson, writeJsonAtomic } from "../../core/fsAtomic";
import {
  installVersion,
  isInstalled,
  readInstallMarker,
  writeInstallMarker,
  type InstallDeps,
  type InstalledVersion,
  type InstallMode,
  type InstallOptions,
} from "../installer";
import { ensureJava } from "../java";
import { safeId } from "../paths";
import { versionJsonSchema, type VersionJson } from "../schemas";
import { addMissingHashes } from "./maven";
import type { LoaderRegistry } from "./registry";

export interface LoaderInstallDeps extends InstallDeps {
  loaders: LoaderRegistry;
}

export interface LoaderInstallRequest {
  providerId: string;
  gameVersion: string;
  loaderVersion: string;
  /** The loader install's version id, as given by the loader's server. */
  versionId: string;
  /** Already fetched by the caller (see `prepareLoader`); saves a request. */
  versionJson?: VersionJson;
}

/**
 * Work out what a new loader install will be: its latest stable build and
 * version JSON (whose `id` becomes the install's version id). Needs the network.
 */
export async function prepareLoader(
  deps: Pick<LoaderInstallDeps, "loaders">,
  providerId: string,
  gameVersion: string,
  signal?: AbortSignal,
): Promise<Required<LoaderInstallRequest>> {
  const provider = deps.loaders.get(providerId);
  const loaderVersion = await provider.getLatestLoaderVersion(
    gameVersion,
    signal,
  );
  const versionJson = await provider.getVersionJson(
    gameVersion,
    loaderVersion,
    signal,
  );
  return {
    providerId,
    gameVersion,
    loaderVersion,
    versionId: safeId(versionJson.id),
    versionJson,
  };
}

/**
 * Install (or check, or repair) a mod loader on top of its Minecraft version.
 * The same flow for every loader:
 * 1. make sure vanilla is installed, 2. save the loader's version JSON,
 * 3. download everything the merged version needs, 4. the provider's `postInstall`,
 * 5. the install marker, last.
 */
export async function installLoader(
  deps: LoaderInstallDeps,
  request: LoaderInstallRequest,
  { mode, signal, onProgress }: Omit<InstallOptions, "managedVersionIds">,
): Promise<InstalledVersion> {
  const { paths, downloader, platform, loaders } = deps;
  const { providerId, gameVersion, loaderVersion, versionId } = request;
  const provider = loaders.get(providerId);
  const report: InstallOptions["onProgress"] = (p) =>
    onProgress?.({ ...p, versionId });

  // A half-finished install (no marker) is finished like a new one.
  const marker = await readInstallMarker(paths, versionId);
  const effectiveMode: InstallMode =
    mode === "quick" && !marker ? "install" : mode;

  // 1. Vanilla, with its own marker: it shows as installed and can be deleted on its own.
  let vanillaMode: InstallMode = "repair";
  if (effectiveMode !== "repair") {
    vanillaMode = (await isInstalled(paths, gameVersion)) ? "quick" : "install";
  }
  await installVersion(deps, gameVersion, {
    mode: vanillaMode,
    ...(signal && { signal }),
    onProgress: report,
  });

  // 2. The loader's version JSON. A quick check uses the saved one (no network).
  let unverified = marker?.unverified ?? [];
  const saved = await readJson(paths.versionJson(versionId), versionJsonSchema);
  if (effectiveMode !== "quick" || !saved) {
    report({
      versionId,
      step: "loader",
      files: 0,
      totalFiles: 0,
      bytes: 0,
      totalBytes: 0,
    });
    const fetched =
      request.versionJson ??
      (await provider.getVersionJson(gameVersion, loaderVersion, signal));
    if (fetched.id !== versionId) {
      throw new AppError(
        "BAD_RESPONSE",
        `${provider.displayName} sent version ${fetched.id} instead of ${versionId}.`,
      );
    }
    const withHashes = await addMissingHashes(fetched, downloader, signal);
    unverified = withHashes.unverified;
    await writeJsonAtomic(paths.versionJson(versionId), withHashes.json);
  }

  // 3. Everything the merged version needs; vanilla's files are already there.
  const installed = await installVersion(deps, versionId, {
    mode: effectiveMode,
    ...(signal && { signal }),
    onProgress: report,
    managedVersionIds: [versionId],
    writeMarker: false,
  });

  // 4. Extra steps (none for Fabric and Quilt).
  if (provider.postInstall) {
    const checkMode = effectiveMode === "repair" ? "full" : "quick";
    await provider.postInstall({
      gameVersion,
      loaderVersion,
      versionId,
      paths,
      download: downloader,
      getJava: (component) =>
        ensureJava({
          component,
          platform,
          paths,
          downloader,
          mode: checkMode,
          ...(signal && { signal }),
        }),
      signal: signal ?? new AbortController().signal,
      progress: (step, done, total) => {
        report({
          versionId,
          step,
          files: done,
          totalFiles: total,
          bytes: 0,
          totalBytes: 0,
        });
      },
    });
  }

  // 5. The marker comes last.
  if (effectiveMode !== "quick" || !marker) {
    await writeInstallMarker(paths, versionId, {
      loader: { id: providerId, loaderVersion, gameVersion },
      unverified,
    });
  }
  return installed;
}
