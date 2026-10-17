import { describe, expect, it } from "vitest";
import { parseNotes } from "./parseReleaseNotes";

describe("parseNotes", () => {
  it("reads headings, items and nested items", () => {
    expect(
      parseNotes(
        "### Added\r\n\r\n- One\n  - One.a\n- Two\n\n### Fixed\n\n* Three\nplain <b>text</b>",
      ),
    ).toEqual([
      { kind: "heading", text: "Added" },
      {
        kind: "list",
        items: [
          { text: "One", children: ["One.a"] },
          { text: "Two", children: [] },
        ],
      },
      { kind: "heading", text: "Fixed" },
      { kind: "list", items: [{ text: "Three", children: [] }] },
      { kind: "text", text: "plain <b>text</b>" },
    ]);
  });

  it("treats a nested item without a parent as a top-level one", () => {
    expect(parseNotes("  - Orphan")).toEqual([
      { kind: "list", items: [{ text: "Orphan", children: [] }] },
    ]);
  });
});
