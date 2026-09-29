import type { TFunction } from "i18next";
import type { CompatReason } from "@shared/launcher";

const LOADERS = ["fabric", "quilt", "forge", "neoforge"] as const;

export function loaderLabel(t: TFunction, id: string): string {
  const known = LOADERS.find((l) => l === id);
  return known ? t(`mods.loaderNames.${known}`) : id;
}

/** "Forge only", "Needs 1.20.1", … */
export function reasonText(t: TFunction, reason: CompatReason): string {
  switch (reason.code) {
    case "vanilla":
      return t("mods.reason.vanilla");
    case "loader":
      return t("mods.reason.loader", {
        loaders: reason.loaders.map((l) => loaderLabel(t, l)).join(" / "),
      });
    case "mcVersion":
      return t("mods.reason.mcVersion", { range: reason.range });
  }
}

/** "Modrinth" for `modrinth`; other ids as they are. */
export function sourceName(t: TFunction, sourceId: string): string {
  return sourceId === "modrinth" ? t("mods.sources.modrinth") : sourceId;
}
