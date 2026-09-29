import { homedir } from "node:os";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, join, relative } from "node:path";
import type { SystemJavaInfo } from "@shared/launcher";
import { javaMajor } from "./javaRuntimes";
import type { Platform } from "./platform";

/*
 * Java installed on the computer outside the launcher: JAVA_HOME, the PATH, and the
 * usual install folders of each OS. Only files are read (each Java's `release` file);
 * nothing is run.
 */

export interface DetectSystemJavaOptions {
  platform: Platform;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  /** Folders whose sub-folders are Java homes; replaces the OS defaults (tests). */
  roots?: string[];
  /** Folders to leave out (the launcher's own runtimes). */
  exclude?: string[];
}

/** Vendor folders under Program Files that hold one Java per sub-folder. */
const WINDOWS_VENDORS = [
  "Java",
  "Eclipse Adoptium",
  "Eclipse Foundation",
  "AdoptOpenJDK",
  "Microsoft",
  "Zulu",
  "BellSoft",
  "Amazon Corretto",
  "Semeru",
  "OpenJDK",
];

function defaultRoots(
  platform: Platform,
  env: NodeJS.ProcessEnv,
  home: string,
): string[] {
  const roots = [
    join(home, ".jdks"),
    join(home, ".sdkman", "candidates", "java"),
  ];
  switch (platform.os) {
    case "windows": {
      const bases = new Set(
        [
          env["ProgramFiles"],
          env["ProgramFiles(x86)"],
          env["ProgramW6432"],
        ].filter((b): b is string => Boolean(b)),
      );
      for (const base of bases)
        for (const vendor of WINDOWS_VENDORS) roots.push(join(base, vendor));
      break;
    }
    case "osx":
      roots.push(
        "/Library/Java/JavaVirtualMachines",
        join(home, "Library", "Java", "JavaVirtualMachines"),
      );
      break;
    case "linux":
      roots.push("/usr/lib/jvm", "/usr/java", "/opt/java", "/opt/jdk");
      break;
  }
  return roots;
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function children(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).map((name) => join(dir, name));
  } catch {
    return [];
  }
}

/** `KEY="value"` lines of a Java home's `release` file. */
export function parseRelease(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z_]+)=("?)(.*)\2\s*$/.exec(line.trim());
    if (m?.[1] && m[3] !== undefined) out[m[1]] = m[3];
  }
  return out;
}

const inside = (child: string, parent: string) => {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

export async function detectSystemJava({
  platform,
  env = process.env,
  homeDir = homedir(),
  roots,
  exclude = [],
}: DetectSystemJavaOptions): Promise<SystemJavaInfo[]> {
  const exe = platform.os === "windows" ? "java.exe" : "java";
  const candidates: string[] = [];
  for (const key of ["JAVA_HOME", "JDK_HOME"]) {
    const value = env[key];
    if (value) candidates.push(value);
  }
  // PATH entries: `<home>/bin/java` → `<home>` (following links, e.g. /usr/bin/java).
  const pathVar = env["PATH"] ?? env["Path"] ?? "";
  for (const dir of pathVar.split(delimiter)) {
    if (!dir) continue;
    const file = join(dir, exe);
    if (!(await isFile(file))) continue;
    const real = await realpath(file).catch(() => file);
    candidates.push(dirname(dirname(real)));
  }
  for (const root of roots ?? defaultRoots(platform, env, homeDir)) {
    for (const child of await children(root)) {
      // macOS bundles keep the home inside Contents/Home.
      const mac = join(child, "Contents", "Home");
      candidates.push((await isFile(join(mac, "bin", exe))) ? mac : child);
    }
  }

  const excluded = await Promise.all(
    exclude.map((d) => realpath(d).catch(() => d)),
  );
  const seen = new Set<string>();
  const found: SystemJavaInfo[] = [];
  for (const candidate of candidates) {
    const executable = join(candidate, "bin", exe);
    if (!(await isFile(executable))) continue;
    const home = await realpath(candidate).catch(() => candidate);
    const key = platform.os === "windows" ? home.toLowerCase() : home;
    if (seen.has(key) || excluded.some((d) => inside(home, d))) continue;
    seen.add(key);
    const release = parseRelease(
      await readFile(join(home, "release"), "utf8").catch(() => ""),
    );
    const version = release["JAVA_VERSION"];
    const major = javaMajor(version);
    const vendor = release["IMPLEMENTOR"];
    found.push({
      home,
      executable: join(home, "bin", exe),
      ...(version && { version }),
      ...(major !== undefined && { major }),
      ...(vendor && { vendor }),
    });
  }
  found.sort(
    (a, b) => (b.major ?? 0) - (a.major ?? 0) || a.home.localeCompare(b.home),
  );
  return found;
}
