/**
 * Adds a published release to releases.json, the update feed the app reads.
 * Run by .github/workflows/feed.yml (see RELEASING.md):
 *
 *   npm run feed -- add <version> --assets <assets.json> --sums <SHA256SUMS.txt> --date <YYYY-MM-DD>
 *
 * `assets.json` is `gh release view v<version> --json assets` output. The notes
 * come from that version's CHANGELOG.md section.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { releaseNotes } from "./lib/changelog.mjs";
import { addRelease, readFeed, writeFeed } from "./lib/feed.mjs";

const REPO_URL = "https://github.com/Ramin-RX7/ezlauncher";

const root = join(import.meta.dirname, "..");
const feedPath = join(root, "releases.json");

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function option(args: string[], name: string): string {
  const i = args.indexOf(`--${name}`);
  const value = i >= 0 ? args[i + 1] : undefined;
  if (!value) fail(`Missing --${name}`);
  return value;
}

const [command, version, ...rest] = process.argv.slice(2);
if (command !== "add" || !version)
  fail(
    "Usage: npm run feed -- add <version> --assets <assets.json> --sums <SHA256SUMS.txt> --date <YYYY-MM-DD>",
  );

try {
  const { assets } = JSON.parse(
    readFileSync(option(rest, "assets"), "utf8"),
  ) as {
    assets: { name: string; size: number }[];
  };
  const feed = addRelease(
    readFeed(existsSync(feedPath) ? readFileSync(feedPath, "utf8") : undefined),
    {
      version,
      date: option(rest, "date"),
      notes: releaseNotes(
        readFileSync(join(root, "CHANGELOG.md"), "utf8"),
        version,
      ),
      assets,
      sums: readFileSync(option(rest, "sums"), "utf8"),
      repoUrl: REPO_URL,
    },
  );
  writeFileSync(feedPath, writeFeed(feed));
  console.log(`releases.json: added ${version}`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
