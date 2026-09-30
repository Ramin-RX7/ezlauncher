import { describe, expect, it } from "vitest";
import {
  releaseChangelog,
  releaseNotes,
  unreleasedHasEntries,
} from "./changelog.mjs";

const REPO = "https://github.com/o/r";

const header = `# Changelog

Intro text.
`;

describe("unreleasedHasEntries", () => {
  it("needs at least one list entry", () => {
    expect(unreleasedHasEntries(`${header}\n## [Unreleased]\n`)).toBe(false);
    expect(
      unreleasedHasEntries(`${header}\n## [Unreleased]\n\n### Added\n`),
    ).toBe(false);
    expect(
      unreleasedHasEntries(`${header}\n## [Unreleased]\n\n### Added\n\n- A\n`),
    ).toBe(true);
  });

  it("does not look past the Unreleased section", () => {
    const text = `${header}\n## [Unreleased]\n\n## [0.1.0] - 2026-01-01\n\n- Old\n`;
    expect(unreleasedHasEntries(text)).toBe(false);
  });
});

describe("releaseChangelog", () => {
  it("releases the first version", () => {
    const text = `${header}\n## [Unreleased]\n\n### Added\n\n- A thing\n`;
    expect(releaseChangelog(text, "0.1.0", "2026-10-01", REPO)).toBe(
      `${header}
## [Unreleased]

## [0.1.0] - 2026-10-01

### Added

- A thing

[Unreleased]: ${REPO}/compare/v0.1.0...HEAD
[0.1.0]: ${REPO}/releases/tag/v0.1.0
`,
    );
  });

  it("links a later version to the previous one", () => {
    const text = `${header}
## [Unreleased]

### Fixed

- A bug

## [0.1.0] - 2026-10-01

- A thing

[Unreleased]: ${REPO}/compare/v0.1.0...HEAD
[0.1.0]: ${REPO}/releases/tag/v0.1.0
`;
    expect(releaseChangelog(text, "0.2.0-beta.1", "2026-11-02", REPO)).toBe(
      `${header}
## [Unreleased]

## [0.2.0-beta.1] - 2026-11-02

### Fixed

- A bug

## [0.1.0] - 2026-10-01

- A thing

[Unreleased]: ${REPO}/compare/v0.2.0-beta.1...HEAD
[0.2.0-beta.1]: ${REPO}/compare/v0.1.0...v0.2.0-beta.1
[0.1.0]: ${REPO}/releases/tag/v0.1.0
`,
    );
  });

  it("refuses an empty Unreleased section or a repeated version", () => {
    expect(() =>
      releaseChangelog(`${header}\n## [Unreleased]\n`, "0.1.0", "d", REPO),
    ).toThrow(/empty/);
    const text = `${header}\n## [Unreleased]\n\n- New\n\n## [0.1.0] - d\n\n- Old\n`;
    expect(() => releaseChangelog(text, "0.1.0", "d", REPO)).toThrow(/already/);
  });

  it("accepts CRLF line endings", () => {
    const text = `${header}\n## [Unreleased]\n\n- A\n`.replace(/\n/g, "\r\n");
    expect(releaseChangelog(text, "1.0.0", "d", REPO)).toContain(
      "## [1.0.0] - d\n\n- A\n",
    );
  });
});

describe("releaseNotes", () => {
  const text = `${header}
## [Unreleased]

- Not yet

## [0.2.0] - 2026-11-02

### Added

- Two

## [0.1.0] - 2026-10-01

- One

[0.1.0]: ${REPO}/releases/tag/v0.1.0
`;

  it("returns only that version's body", () => {
    expect(releaseNotes(text, "0.2.0")).toBe("### Added\n\n- Two\n");
    expect(releaseNotes(text, "0.1.0")).toBe("- One\n");
  });

  it("fails for a missing version", () => {
    expect(() => releaseNotes(text, "9.9.9")).toThrow(/no section/);
  });
});
