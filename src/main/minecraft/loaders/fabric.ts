import { z } from "zod";
import { AppError } from "../../core/errors";
import type { Downloader } from "../downloader";
import { versionJsonSchema } from "../schemas";
import { fetchJson } from "./fetchJson";
import type { LoaderProvider } from "./types";

export const FABRIC_META_URL = "https://meta.fabricmc.net/v2";

const gameVersionsSchema = z.array(z.looseObject({ version: z.string() }));
const loaderBuildsSchema = z.array(
  z.looseObject({
    loader: z.looseObject({ version: z.string(), stable: z.boolean() }),
  }),
);
export type FabricLoaderBuilds = z.infer<typeof loaderBuildsSchema>;

/** Fabric lists builds newest first: take the first stable one. */
export function pickFabricLoader(
  builds: FabricLoaderBuilds,
): string | undefined {
  return builds.find((b) => b.loader.stable)?.loader.version;
}

export function createFabricProvider({
  downloader,
}: {
  downloader: Downloader;
}): LoaderProvider {
  const seg = encodeURIComponent;
  return {
    id: "fabric",
    displayName: "Fabric",

    async listGameVersions(signal) {
      const list = await fetchJson(
        downloader,
        `${FABRIC_META_URL}/versions/game`,
        gameVersionsSchema,
        signal,
      );
      return list.map((v) => v.version);
    },

    async getLatestLoaderVersion(gameVersion, signal) {
      const builds = await fetchJson(
        downloader,
        `${FABRIC_META_URL}/versions/loader/${seg(gameVersion)}`,
        loaderBuildsSchema,
        signal,
      );
      const version = pickFabricLoader(builds);
      if (!version) {
        throw new AppError(
          "LOADER_UNSUPPORTED",
          `Fabric has no stable build for ${gameVersion}.`,
        );
      }
      return version;
    },

    getVersionJson(gameVersion, loaderVersion, signal) {
      return fetchJson(
        downloader,
        `${FABRIC_META_URL}/versions/loader/${seg(gameVersion)}/${seg(loaderVersion)}/profile/json`,
        versionJsonSchema,
        signal,
      );
    },
  };
}
