import type { TFunction } from "i18next";

/** Bytes as KB / MB / GB, through i18n (units are user-facing text too). */
export function formatSize(t: TFunction, bytes: number): string {
  const kb = bytes / 1024;
  if (kb < 1024)
    return t("units.sizeKb", { size: Math.max(1, Math.round(kb)) });
  const mb = kb / 1024;
  return mb >= 1024
    ? t("units.sizeGb", { size: (mb / 1024).toFixed(1) })
    : t("units.sizeMb", { size: Math.round(mb) });
}
