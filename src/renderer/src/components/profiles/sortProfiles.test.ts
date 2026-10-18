import { describe, expect, it } from "vitest";
import { profile } from "../../test/fixtures";
import { sortProfiles } from "./sortProfiles";

const list = [
  profile({
    id: "a",
    name: "alpha 10",
    createdAt: "2026-01-01T00:00:00Z",
    lastPlayedAt: "2026-03-01T00:00:00Z",
    playTimeMs: 100,
  }),
  profile({
    id: "b",
    name: "Alpha 9",
    createdAt: "2026-02-01T00:00:00Z",
    playTimeMs: 500,
  }),
  profile({
    id: "c",
    name: "beta",
    createdAt: "2026-01-15T00:00:00Z",
    lastPlayedAt: "2026-04-01T00:00:00Z",
    playTimeMs: 100,
    pinned: true,
  }),
];
const ids = (r: ReturnType<typeof sortProfiles>) => ({
  pinned: r.pinned.map((p) => p.id),
  others: r.others.map((p) => p.id),
});

describe("sortProfiles", () => {
  it("keeps pinned profiles apart, in the same order", () => {
    expect(ids(sortProfiles(list, "lastPlayed", "en"))).toEqual({
      pinned: ["c"],
      others: ["a", "b"],
    });
  });

  it("sorts by name with numbers in order, ignoring case", () => {
    expect(sortProfiles(list, "name", "en").others.map((p) => p.name)).toEqual([
      "Alpha 9",
      "alpha 10",
    ]);
  });

  it("sorts by play time, then last played", () => {
    const all = list.map((p) => ({ ...p, pinned: false }));
    expect(ids(sortProfiles(all, "playTime", "en")).others).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("sorts by creation, newest first", () => {
    expect(ids(sortProfiles(list, "created", "en")).others).toEqual(["b", "a"]);
  });
});
