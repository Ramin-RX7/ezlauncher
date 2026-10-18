/*
 * Diagnostics are pasted into public bug reports, so what identifies the user is
 * replaced: their folders, their computer user name, their Minecraft names and
 * UUIDs, and any access token that slipped into a log.
 */

export interface Secrets {
  /** The data folder. */
  dataDir?: string;
  /** The home folder (`C:\Users\name`, `/home/name`). */
  homeDir?: string;
  /** The computer's user name. */
  userName?: string;
  /** Minecraft account names. */
  playerNames?: string[];
  /** Account UUIDs (with or without dashes). */
  uuids?: string[];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A path in either slash style, ignoring case (Windows paths do). */
function pathPattern(path: string): RegExp {
  const parts = path
    .split(/[\\/]+/)
    .filter(Boolean)
    .map(escape);
  const lead = /^[\\/]/.test(path) ? "[\\\\/]" : "";
  return new RegExp(lead + parts.join("[\\\\/]+"), "gi");
}

/** `text` with every secret replaced by a placeholder. */
export function redact(text: string, secrets: Secrets): string {
  let out = text;
  // Longest first: the data folder is often inside the home folder.
  const paths = [
    [secrets.dataDir, "<data>"],
    [secrets.homeDir, "~"],
  ]
    .filter((p): p is [string, string] => Boolean(p[0] && p[0].length > 2))
    .sort((a, b) => b[0].length - a[0].length);
  for (const [path, label] of paths)
    out = out.replace(pathPattern(path), label);

  for (const uuid of secrets.uuids ?? []) {
    const plain = uuid.replace(/-/g, "");
    if (plain.length < 8) continue;
    out = out.replace(new RegExp(escape(uuid), "gi"), "<uuid>");
    out = out.replace(new RegExp(escape(plain), "gi"), "<uuid>");
  }

  // Whole words only, so a short name doesn't eat parts of other words.
  const words: [string, string][] = [
    ...(secrets.playerNames ?? []).map((n): [string, string] => [
      n,
      "<player>",
    ]),
    ...(secrets.userName
      ? [[secrets.userName, "<user>"] as [string, string]]
      : []),
  ];
  for (const [word, label] of words.sort((a, b) => b[0].length - a[0].length)) {
    if (word.length < 2) continue;
    out = out.replace(
      new RegExp(`(?<![A-Za-z0-9_])${escape(word)}(?![A-Za-z0-9_])`, "gi"),
      label,
    );
  }

  // Tokens: `--accessToken <x>`, `accessToken=<x>`, `"accessToken": "<x>"`.
  out = out.replace(
    /((?:access_?token|auth_access_token|auth_session|session)["']?\s*[:=]?\s*["']?)[A-Za-z0-9._-]{8,}/gi,
    "$1<hidden>",
  );
  out = out.replace(/(--accessToken\s+)\S+/g, "$1<hidden>");
  return out;
}
