import { describe, expect, it } from "vitest";
import {
  desktopEntry,
  isPng,
  pngToIco,
  shortcutFileName,
} from "./shortcutFiles";

/** The first bytes of a PNG with its IHDR (enough for the header reads). */
function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(40);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // IHDR
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

describe("pngToIco", () => {
  it("wraps a PNG in a one-image icon", () => {
    const image = png(256, 256);
    const ico = pngToIco(image);
    const view = new DataView(ico.buffer);
    expect(view.getUint16(2, true)).toBe(1); // icon
    expect(view.getUint16(4, true)).toBe(1); // one image
    expect(ico[6]).toBe(0); // 256 is written as 0
    expect(view.getUint16(12, true)).toBe(32);
    expect(view.getUint32(14, true)).toBe(image.length);
    expect(view.getUint32(18, true)).toBe(22);
    expect(ico.subarray(22)).toEqual(image);
    expect(pngToIco(png(48, 32))[6]).toBe(48);
  });

  it("refuses what isn't a PNG", () => {
    expect(isPng(new Uint8Array(40))).toBe(false);
    expect(() => pngToIco(new Uint8Array(40))).toThrow();
  });
});

describe("desktopEntry", () => {
  it("quotes the command and keeps every value on one line", () => {
    const text = desktopEntry({
      name: "My\nPack",
      comment: "Open it",
      exec: ["/opt/EZ Launcher.AppImage", "--ezl-profile=abc", 'a"b$c\\d%e'],
      icon: "/home/u/icons/abc.png",
      profileId: "abc",
    });
    expect(text).toContain("Name=My Pack\n");
    expect(text).toContain(
      // The spec escapes twice: `"` and `$` become `\\"` / `\\$`, a backslash four.
      'Exec="/opt/EZ Launcher.AppImage" "--ezl-profile=abc" "a\\\\"b\\\\$c\\\\\\\\d%%e"\n',
    );
    expect(text).toContain("Icon=/home/u/icons/abc.png\n");
    expect(text).toContain("X-EZLauncher-Profile=abc\n");
    expect(text.startsWith("[Desktop Entry]\n")).toBe(true);
  });
});

describe("shortcutFileName", () => {
  it.each([
    ["Survival", "Survival"],
    ['A/B:C*D?"E', "A_B_C_D__E"],
    ["Trailing. ", "Trailing"],
    ["...", "Profile"],
    ["", "Profile"],
  ])("%j → %j", (name, file) => {
    expect(shortcutFileName(name)).toBe(file);
  });
});
