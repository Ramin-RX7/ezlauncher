import { AppError } from "../core/errors";
import { createModrinthSource, type ModrinthOptions } from "./modrinth";
import type { ModSource } from "./types";

/** Every mod website the launcher can search and download from. */
export function createModSourceRegistry(deps: ModrinthOptions) {
  const sources: readonly ModSource[] = [createModrinthSource(deps)];
  return {
    sources,
    get(id: string): ModSource {
      const source = sources.find((s) => s.id === id);
      if (!source)
        throw new AppError("SOURCE_UNKNOWN", `Unknown mod source: ${id}`);
      return source;
    },
  };
}

export type ModSourceRegistry = ReturnType<typeof createModSourceRegistry>;
