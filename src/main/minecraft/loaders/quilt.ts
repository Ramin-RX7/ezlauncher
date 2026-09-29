import { z } from "zod";
import { AppError } from "../../core/errors";
import type { Downloader } from "../downloader";
import { versionJsonSchema } from "../schemas";
import { fetchJson } from "./fetchJson";
import type { LoaderProvider } from "./types";

export const QUILT_META_URL = "https://meta.quiltmc.org/v3";

const gameVersionsSchema = z.array(z.looseObject({ version: z.string() }));
const loaderBuildsSchema = z.array(
  z.looseObject({ loader: z.looseObject({ version: z.string() }) }),
);

/** Compare dotted loader versions by their numeric parts (`0.26.10` > `0.26.9`). */
export function compareLoaderVersions(a: string, b: string): number {
  const parts = (v: string) => v.split(/[.+-]/).map((p) => Number(p) || 0);
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Quilt's list is unsorted and has betas: drop pre-releases, then take the highest. */
export function pickQuiltLoader(
  versions: readonly string[],
): string | undefined {
  const stable = versions.filter((v) => !/-(beta|pre)/i.test(v));
  return stable.sort(compareLoaderVersions).at(-1);
}

export function createQuiltProvider({
  downloader,
}: {
  downloader: Downloader;
}): LoaderProvider {
  const seg = encodeURIComponent;
  return {
    id: "quilt",
    displayName: "Quilt",

    async listGameVersions(signal) {
      const list = await fetchJson(
        downloader,
        `${QUILT_META_URL}/versions/game`,
        gameVersionsSchema,
        signal,
      );
      return list.map((v) => v.version);
    },

    async getLatestLoaderVersion(gameVersion, signal) {
      const builds = await fetchJson(
        downloader,
        `${QUILT_META_URL}/versions/loader/${seg(gameVersion)}`,
        loaderBuildsSchema,
        signal,
      );
      const version = pickQuiltLoader(builds.map((b) => b.loader.version));
      if (!version) {
        throw new AppError(
          "LOADER_UNSUPPORTED",
          `Quilt has no stable build for ${gameVersion}.`,
        );
      }
      return version;
    },

    getVersionJson(gameVersion, loaderVersion, signal) {
      return fetchJson(
        downloader,
        `${QUILT_META_URL}/versions/loader/${seg(gameVersion)}/${seg(loaderVersion)}/profile/json`,
        versionJsonSchema,
        signal,
      );
    },
  };
}
