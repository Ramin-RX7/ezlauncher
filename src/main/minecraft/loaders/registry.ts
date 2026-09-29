import { AppError } from "../../core/errors";
import { readJson, writeJsonAtomic } from "../../core/fsAtomic";
import type { Logger } from "../../core/logger";
import type { Downloader } from "../downloader";
import type { Paths } from "../paths";
import { loaderGameVersionsCacheSchema } from "../schemas";
import { createFabricProvider } from "./fabric";
import { createQuiltProvider } from "./quilt";
import type { LoaderProvider } from "./types";

/** Every mod loader the launcher offers, in the order the UI lists them. */
export function createLoaderRegistry(deps: { downloader: Downloader }) {
  const providers: readonly LoaderProvider[] = [
    createFabricProvider(deps),
    createQuiltProvider(deps),
  ];
  return {
    providers,
    get(id: string): LoaderProvider {
      const provider = providers.find((p) => p.id === id);
      if (!provider)
        throw new AppError("LOADER_UNKNOWN", `Unknown mod loader: ${id}`);
      return provider;
    },
  };
}

export type LoaderRegistry = ReturnType<typeof createLoaderRegistry>;

/**
 * The Minecraft versions a loader supports. Uses the saved copy when there is one
 * (no network); asks the loader's server only with no copy yet, or on `refresh`.
 * A failed request keeps the saved copy; with none, the answer is `null` (unknown).
 */
export async function getSupportedGameVersions(
  provider: LoaderProvider,
  paths: Paths,
  { refresh = false, logger }: { refresh?: boolean; logger?: Logger } = {},
): Promise<string[] | null> {
  const file = paths.loaderCache(provider.id);
  const cached = await readJson(file, loaderGameVersionsCacheSchema).catch(
    () => undefined, // a broken cache is treated like no cache
  );
  if (cached && !refresh) return cached.versions;
  try {
    const versions = await provider.listGameVersions();
    await writeJsonAtomic(file, {
      schema: 1,
      fetchedAt: new Date().toISOString(),
      versions,
    });
    return versions;
  } catch (err) {
    logger?.warn(`${provider.id}: can't get supported versions`, err);
    return cached?.versions ?? null;
  }
}
