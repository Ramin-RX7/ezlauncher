/**
 * CHANGELOG.md tool used by the release process (see RELEASING.md).
 *
 *   npm run changelog -- check            fail if [Unreleased] has no entries
 *   npm run changelog -- release          move [Unreleased] to the package.json version
 *   npm run changelog -- notes <version>  print that version's section (release notes)
 *
 * `check` runs in the npm `preversion` hook and `release` in the `version`
 * hook, so `npm version <x>` updates the changelog in the release commit.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  releaseChangelog,
  releaseNotes,
  unreleasedHasEntries,
} from "./lib/changelog.mjs";

const REPO_URL = "https://github.com/Ramin-RX7/ezlauncher";

const root = join(import.meta.dirname, "..");
const changelogPath = join(root, "CHANGELOG.md");

function packageVersion(): string {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    version: string;
  };
  return pkg.version;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const [command, arg] = process.argv.slice(2);
const text = readFileSync(changelogPath, "utf8");

try {
  switch (command) {
    case "check":
      if (!unreleasedHasEntries(text)) {
        fail(
          "The ## [Unreleased] section of CHANGELOG.md is empty. Add the changes of this release first.",
        );
      }
      break;
    case "release": {
      const version = packageVersion();
      const date = new Date().toISOString().slice(0, 10);
      writeFileSync(
        changelogPath,
        releaseChangelog(text, version, date, REPO_URL),
      );
      console.log(`CHANGELOG.md: [Unreleased] is now [${version}] - ${date}`);
      break;
    }
    case "notes":
      if (!arg) fail("Usage: npm run changelog -- notes <version>");
      process.stdout.write(releaseNotes(text, arg));
      break;
    default:
      fail("Usage: npm run changelog -- <check|release|notes <version>>");
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
