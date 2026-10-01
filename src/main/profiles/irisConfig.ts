/*
 * Iris's `config/iris.properties`: which shader pack is active. Iris writes it
 * with Java's `Properties.store` (ISO-8859-1, `\uXXXX` escapes, a comment and a
 * date line, keys sorted) and rewrites the whole file each time the game starts.
 * Only two keys are ever changed here, and every other line is kept as it was:
 *   shaderPack=<entry in shaderpacks/>   (`Foo.zip` or a folder name; empty or
 *                                         `(internal)` means none)
 *   enableShaders=true|false             (missing means true)
 * Read and write the file as latin1, so every byte survives.
 */

export interface IrisSelection {
  /** The entry in `shaderpacks/`; null when none. */
  shaderPack: string | null;
  enabled: boolean;
}

/** Changes to make: a key left out stays as it is; `shaderPack: null` removes it. */
export interface IrisChanges {
  shaderPack?: string | null;
  enabled?: boolean;
}

interface Entry {
  key: string;
  value: string;
  /** First and last physical line of the entry (continuation lines). */
  first: number;
  last: number;
}

/** Odd number of backslashes at the end: the line continues on the next. */
const continues = (line: string) => /(^|[^\\])(\\\\)*\\$/.test(line);

function unescape(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    if (c !== "\\") {
      out += c;
      continue;
    }
    const n = text.charAt(++i);
    if (n === "u" && /^[0-9a-fA-F]{4}$/.test(text.slice(i + 1, i + 5))) {
      out += String.fromCharCode(parseInt(text.slice(i + 1, i + 5), 16));
      i += 4;
    } else {
      out += { t: "\t", n: "\n", r: "\r", f: "\f" }[n] ?? n;
    }
  }
  return out;
}

/** Split a logical line into key and value, as `Properties.load` does. */
function splitEntry(line: string): { key: string; value: string } {
  let i = 0;
  let key = "";
  for (; i < line.length; i++) {
    const c = line.charAt(i);
    if (c === "\\") {
      key += c + line.charAt(++i);
      continue;
    }
    if (c === "=" || c === ":" || c === " " || c === "\t" || c === "\f") break;
    key += c;
  }
  while (i < line.length && /[ \t\f]/.test(line.charAt(i))) i++;
  if (line.charAt(i) === "=" || line.charAt(i) === ":") i++;
  while (i < line.length && /[ \t\f]/.test(line.charAt(i))) i++;
  return { key: unescape(key), value: unescape(line.slice(i)) };
}

function parse(lines: readonly string[]): Entry[] {
  const entries: Entry[] = [];
  for (let i = 0; i < lines.length; i++) {
    const first = i;
    const start = (lines[i] ?? "").replace(/^[ \t\f]+/, "");
    if (start === "" || start.startsWith("#") || start.startsWith("!"))
      continue;
    let logical = start;
    while (continues(logical) && i + 1 < lines.length) {
      logical =
        logical.slice(0, -1) + (lines[++i] ?? "").replace(/^[ \t\f]+/, "");
    }
    if (continues(logical)) logical = logical.slice(0, -1);
    entries.push({ ...splitEntry(logical), first, last: i });
  }
  return entries;
}

const splitLines = (text: string) => text.split(/\r?\n/);
const eolOf = (text: string) => (text.includes("\r\n") ? "\r\n" : "\n");

/** Escape a value the way `Properties.store` does, so Iris reads it back exactly. */
export function escapeValue(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const c = value.charAt(i);
    const code = value.charCodeAt(i);
    if (c === "\\") out += "\\\\";
    else if (c === " ") out += i === 0 ? "\\ " : " ";
    else if (c === "\t") out += "\\t";
    else if (c === "\n") out += "\\n";
    else if (c === "\r") out += "\\r";
    else if (c === "\f") out += "\\f";
    else if ("=:#!".includes(c)) out += `\\${c}`;
    else if (code < 0x20 || code > 0x7e)
      out += `\\u${code.toString(16).toUpperCase().padStart(4, "0")}`;
    else out += c;
  }
  return out;
}

export function readIrisSelection(text: string): IrisSelection {
  const entries = parse(splitLines(text));
  // Properties keeps the last value of a repeated key.
  const get = (key: string) => entries.findLast((e) => e.key === key)?.value;
  const pack = get("shaderPack")?.trim();
  const enabled = get("enableShaders")?.trim().toLowerCase();
  return {
    shaderPack: pack && pack !== "(internal)" ? pack : null,
    enabled: enabled === undefined ? true : enabled === "true",
  };
}

/** Apply the changes, keeping every other line and the line endings. */
export function writeIrisSelection(text: string, changes: IrisChanges): string {
  const eol = eolOf(text);
  const lines = splitLines(text);
  const trailing = lines.at(-1) === "";
  if (trailing) lines.pop();
  const entries = parse(lines);
  const wanted = new Map<string, string | null>();
  if (changes.enabled !== undefined)
    wanted.set("enableShaders", String(changes.enabled));
  if (changes.shaderPack !== undefined)
    wanted.set(
      "shaderPack",
      changes.shaderPack === null ? null : escapeValue(changes.shaderPack),
    );

  const drop = new Set<number>();
  const replace = new Map<number, string>();
  for (const [key, value] of wanted) {
    const found = entries.filter((e) => e.key === key);
    found.forEach((e, n) => {
      for (let i = e.first; i <= e.last; i++) drop.add(i);
      if (n === found.length - 1 && value !== null)
        replace.set(e.first, `${key}=${value}`);
    });
    if (found.length === 0 && value !== null) lines.push(`${key}=${value}`);
  }
  const out = lines.flatMap((line, i) => {
    const r = replace.get(i);
    if (r !== undefined) return [r];
    return drop.has(i) ? [] : [line];
  });
  return out.join(eol) + (trailing || out.length > 0 ? eol : "");
}

/** A new file for a profile that has none yet (Iris adds its other keys on start). */
export function newIrisConfig(changes: IrisChanges, eol: string): string {
  return writeIrisSelection(
    `#This file stores configuration options for Iris, such as the currently active shaderpack${eol}`,
    changes,
  );
}
