import { describe, expect, it } from "vitest";
import i18n from "../i18n";
import { formatDuration } from "./formatDuration";

describe("formatDuration", () => {
  it.each([
    [10_000, "< 1 min"],
    [45 * 60_000, "45 min"],
    [12 * 3_600_000 + 30 * 60_000, "12 h 30 min"],
    [3_600_000, "1 h 0 min"],
  ])("%d ms → %s", (ms, text) => {
    expect(formatDuration(i18n.t, ms)).toBe(text);
  });
});
