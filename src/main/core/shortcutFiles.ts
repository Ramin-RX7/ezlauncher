/*
 * The files behind a profile's desktop shortcut that don't need Electron: a
 * Windows icon (`.ico`) wrapping a PNG, and a Linux `.desktop` entry.
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length > 24 && PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}

/**
 * An `.ico` holding one PNG image (Windows Vista and later read PNG inside ICO).
 * The size comes from the PNG's header; 256 and more is written as 0.
 */
export function pngToIco(png: Uint8Array): Uint8Array {
  if (!isPng(png)) throw new Error("not a PNG");
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const out = new Uint8Array(6 + 16 + png.length);
  const o = new DataView(out.buffer);
  o.setUint16(0, 0, true); // reserved
  o.setUint16(2, 1, true); // type: icon
  o.setUint16(4, 1, true); // one image
  o.setUint8(6, width >= 256 ? 0 : width);
  o.setUint8(7, height >= 256 ? 0 : height);
  o.setUint8(8, 0); // no palette
  o.setUint8(9, 0); // reserved
  o.setUint16(10, 1, true); // colour planes
  o.setUint16(12, 32, true); // bits per pixel
  o.setUint32(14, png.length, true);
  o.setUint32(18, 22, true); // the image starts after these headers
  out.set(png, 22);
  return out;
}

/** One `Exec` argument, quoted as the desktop entry spec asks. */
function execArg(arg: string): string {
  const quoted = arg.replace(/["`$\\]/g, (c) => `\\${c}`);
  // The whole value is a string value too: its backslashes are escaped again.
  return `"${quoted.replace(/\\/g, "\\\\").replace(/%/g, "%%")}"`;
}

/** A value on one line: no line breaks, backslashes escaped. */
const value = (s: string) =>
  s
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n|\r/g, " ")
    .replace(/\t/g, " ");

export const DESKTOP_PROFILE_KEY = "X-EZLauncher-Profile";

/** A Linux `.desktop` entry that runs `exec` (the program, then its arguments). */
export function desktopEntry({
  name,
  comment,
  exec,
  icon,
  profileId,
}: {
  name: string;
  comment: string;
  exec: readonly string[];
  icon?: string;
  profileId: string;
}): string {
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Version=1.0",
    `Name=${value(name)}`,
    `Comment=${value(comment)}`,
    `Exec=${exec.map(execArg).join(" ")}`,
    ...(icon ? [`Icon=${value(icon)}`] : []),
    "Terminal=false",
    "Categories=Game;",
    `${DESKTOP_PROFILE_KEY}=${value(profileId)}`,
    "",
  ].join("\n");
}

/** A profile name as a file name (Windows and Linux): unsafe characters become `_`. */
export function shortcutFileName(name: string): string {
  const safe = name
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/, "")
    .trim();
  return safe.length > 0 && !/^\.+$/.test(safe) ? safe.slice(0, 64) : "Profile";
}
