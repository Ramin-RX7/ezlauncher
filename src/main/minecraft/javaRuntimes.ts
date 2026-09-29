import { readdir, rm } from "node:fs/promises";
import type { JavaRuntimeInfo } from "@shared/launcher";
import { readJson } from "../core/fsAtomic";
import type { Downloader } from "./downloader";
import { DEFAULT_JAVA_COMPONENT, loadJavaAll } from "./java";
import { listInstalledVersions } from "./manifest";
import type { Paths } from "./paths";
import { javaPlatformKeys, type Platform } from "./platform";
import { runtimeManifestSchema, runtimeMarkerSchema } from "./schemas";
import { diskVersionLoader, resolveVersion } from "./versionJson";

/*
 * The Java runtimes the launcher manages (Mojang's builds in `runtimes/`): which are
 * installed, which Mojang offers for this computer, and which versions use each.
 */

/** Major version from a Java version string: `17.0.8` → 17, `1.8.0_51` / `8u51` → 8. */
export function javaMajor(version: string | undefined): number | undefined {
  if (!version) return undefined;
  const m = /^(?:1\.)?(\d+)/.exec(version.trim());
  return m ? Number(m[1]) : undefined;
}

/** Mojang's list also has non-Java components (e.g. the Windows launcher exe). */
export const isJavaComponent = (name: string): boolean =>
  name.startsWith("java-runtime") || name.startsWith("jre-");

/** Java component → the installed Minecraft versions that run on it. */
export async function javaUsage(paths: Paths): Promise<Map<string, string[]>> {
  const usage = new Map<string, string[]>();
  for (const v of await listInstalledVersions(paths)) {
    try {
      const resolved = await resolveVersion(v.id, diskVersionLoader(paths));
      const component =
        resolved.javaVersion?.component ?? DEFAULT_JAVA_COMPONENT;
      const list = usage.get(component) ?? [];
      list.push(v.id);
      usage.set(component, list);
    } catch {
      // unreadable version files: it doesn't count
    }
  }
  return usage;
}

async function installedRuntimes(paths: Paths) {
  const found = new Map<string, { versionName?: string; size?: number }>();
  let dirs: string[];
  try {
    dirs = await readdir(paths.runtimesDir);
  } catch {
    return found;
  }
  for (const dir of dirs) {
    const marker = await readJson(
      paths.runtimeMarker(dir),
      runtimeMarkerSchema,
    ).catch(() => undefined);
    if (!marker) continue; // half-installed: reads as not installed
    const manifest = await readJson(
      paths.runtimeManifest(dir),
      runtimeManifestSchema,
    ).catch(() => undefined);
    let size: number | undefined;
    if (manifest) {
      size = 0;
      for (const entry of Object.values(manifest.files))
        if (entry.type === "file") size += entry.downloads.raw.size;
    }
    found.set(marker.component, {
      ...(marker.versionName && { versionName: marker.versionName }),
      ...(size !== undefined && { size }),
    });
  }
  return found;
}

export async function listJavaRuntimes({
  paths,
  downloader,
  platform,
  signal,
}: {
  paths: Paths;
  downloader: Downloader;
  platform: Platform;
  signal?: AbortSignal;
}): Promise<{ runtimes: JavaRuntimeInfo[]; offline: boolean }> {
  const installed = await installedRuntimes(paths);
  const available = new Map<string, { versionName?: string }>();
  let offline = false;
  try {
    const all = await loadJavaAll(paths, downloader, signal);
    for (const key of javaPlatformKeys(platform)) {
      for (const [component, entries] of Object.entries(all[key] ?? {})) {
        const entry = entries[0];
        if (!entry || !isJavaComponent(component) || available.has(component))
          continue;
        available.set(component, {
          ...(entry.version?.name && { versionName: entry.version.name }),
        });
      }
    }
  } catch {
    offline = true;
  }
  const usage = await javaUsage(paths);

  const components = new Set([...installed.keys(), ...available.keys()]);
  const runtimes = [...components].map((component): JavaRuntimeInfo => {
    const own = installed.get(component);
    const offered = available.get(component);
    const versionName = own?.versionName ?? offered?.versionName;
    const major = javaMajor(versionName);
    return {
      component,
      ...(versionName && { versionName }),
      ...(major !== undefined && { major }),
      installed: own !== undefined,
      available: offered !== undefined,
      ...(own?.size !== undefined && { sizeBytes: own.size }),
      usedBy: usage.get(component) ?? [],
    };
  });
  runtimes.sort(
    (a, b) =>
      (b.major ?? 0) - (a.major ?? 0) || a.component.localeCompare(b.component),
  );
  return { runtimes, offline };
}

/** Delete an installed runtime. The marker goes first, so a partial delete reads as not installed. */
export async function removeJavaRuntime(
  paths: Paths,
  component: string,
): Promise<void> {
  await rm(paths.runtimeMarker(component), { force: true });
  await rm(paths.runtimeDir(component), { recursive: true, force: true });
}
