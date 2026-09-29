/** "2 days ago", "5 minutes ago", … in the UI language. */
export function relativeTime(language: string, iso: string, now = Date.now()) {
  const seconds = (Date.parse(iso) - now) / 1000;
  const format = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 365 * 86400],
    ["month", 30 * 86400],
    ["week", 7 * 86400],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size)
      return format.format(Math.round(seconds / size), unit);
  }
  return format.format(0, "minute");
}
