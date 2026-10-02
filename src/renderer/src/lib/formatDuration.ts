import type { TFunction } from "i18next";

/** A play time: "12 h 30 min", "45 min", "< 1 min". */
export function formatDuration(t: TFunction, ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return t("time.lessThanMinute");
  const hours = Math.floor(minutes / 60);
  if (hours === 0) return t("time.minutes", { m: minutes });
  return t("time.hoursMinutes", { h: hours, m: minutes % 60 });
}
