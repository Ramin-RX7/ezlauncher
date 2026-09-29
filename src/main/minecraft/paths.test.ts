import { describe, expect, it } from "vitest";
import { createPaths, safeId } from "./paths";

describe("paths", () => {
  it("accepts real version ids", () => {
    for (const id of [
      "1.21.4",
      "26.4-snapshot-1",
      "b1.7.3",
      "fabric-loader-0.16.10-1.18.2",
      "1.14 Pre-Release 1",
      "rd-132211",
    ]) {
      expect(safeId(id)).toBe(id);
    }
  });

  it("rejects ids that could escape the data folder", () => {
    const paths = createPaths("/data");
    for (const id of ["..", "../x", "a/b", "a\\b", "", "x..y"]) {
      expect(() => paths.versionDir(id)).toThrow(
        expect.objectContaining({ code: "INVALID_ID" }),
      );
    }
    expect(() => paths.library("a/../../etc/passwd")).toThrow();
    expect(() => paths.assetObject("../../x")).toThrow();
  });
});
