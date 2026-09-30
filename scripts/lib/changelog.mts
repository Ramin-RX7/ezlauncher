/**
 * CHANGELOG.md helpers (Keep a Changelog format).
 *
 * The file has one `## [Unreleased]` section that collects changes as they
 * land, released sections `## [x.y.z] - YYYY-MM-DD` below it (newest first),
 * and a block of link references (`[x.y.z]: https://…`) at the end.
 */

const UNRELEASED = "Unreleased";
const linkRef = /^\[[^\]]+\]:\s/;

export interface Section {
  /** Index of the `## [name]` heading line. */
  start: number;
  /** Index one past the section's last line. */
  end: number;
  body: string[];
}

function headingName(line: string): string | undefined {
  return /^## \[([^\]]+)\]/.exec(line)?.[1];
}

export function findSection(
  lines: readonly string[],
  name: string,
): Section | undefined {
  const start = lines.findIndex((line) => headingName(line) === name);
  if (start < 0) return undefined;
  let end = start + 1;
  while (
    end < lines.length &&
    !lines[end]?.startsWith("## ") &&
    !linkRef.test(lines[end] ?? "")
  ) {
    end++;
  }
  return { start, end, body: lines.slice(start + 1, end) };
}

/** A section counts as empty until it has at least one list entry. */
export function hasEntries(body: readonly string[]): boolean {
  return body.some((line) => /^\s*[-*] \S/.test(line));
}

function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").split("\n");
}

export function unreleasedHasEntries(text: string): boolean {
  const section = findSection(splitLines(text), UNRELEASED);
  return section !== undefined && hasEntries(section.body);
}

/**
 * Turns the Unreleased section into a `## [version] - date` section, opens a
 * new empty Unreleased section above it and updates the link references.
 */
export function releaseChangelog(
  text: string,
  version: string,
  date: string,
  repoUrl: string,
): string {
  const lines = splitLines(text);
  const unreleased = findSection(lines, UNRELEASED);
  if (!unreleased)
    throw new Error("CHANGELOG.md has no ## [Unreleased] section.");
  if (!hasEntries(unreleased.body)) {
    throw new Error(
      "The ## [Unreleased] section of CHANGELOG.md is empty. Add the changes of this release first.",
    );
  }
  if (findSection(lines, version)) {
    throw new Error(`CHANGELOG.md already has a section for ${version}.`);
  }

  // The newest released version before this one, for the compare link.
  const previous = lines
    .slice(unreleased.end)
    .map(headingName)
    .find((name) => name !== undefined);

  const out = [
    ...lines.slice(0, unreleased.start),
    `## [${UNRELEASED}]`,
    "",
    `## [${version}] - ${date}`,
    ...lines.slice(unreleased.start + 1),
  ].filter((line) => !line.startsWith(`[${UNRELEASED}]:`));

  const links = [
    `[${UNRELEASED}]: ${repoUrl}/compare/v${version}...HEAD`,
    previous
      ? `[${version}]: ${repoUrl}/compare/v${previous}...v${version}`
      : `[${version}]: ${repoUrl}/releases/tag/v${version}`,
  ];
  const firstLink = out.findIndex((line) => linkRef.test(line));
  if (firstLink >= 0) {
    out.splice(firstLink, 0, ...links);
  } else {
    while (out.length > 0 && out[out.length - 1] === "") out.pop();
    out.push("", ...links, "");
  }
  return out.join("\n");
}

/** The body of one released version, used as the GitHub release notes. */
export function releaseNotes(text: string, version: string): string {
  const section = findSection(splitLines(text), version);
  if (!section) throw new Error(`CHANGELOG.md has no section for ${version}.`);
  if (!hasEntries(section.body)) {
    throw new Error(`The CHANGELOG.md section for ${version} is empty.`);
  }
  return section.body.join("\n").trim() + "\n";
}
