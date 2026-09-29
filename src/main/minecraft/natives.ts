import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, normalize, sep } from "node:path";
import { unzipSync } from "fflate";
import type { NativeJar } from "./libraries";

/**
 * Extract old-style native jars (≤ 1.18) into the version's natives folder.
 * The folder is cleared first so files from an older extraction never linger.
 */
export async function extractNatives(
  jars: readonly NativeJar[],
  targetDir: string,
): Promise<void> {
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });
  const root = normalize(targetDir + sep);

  for (const { task, exclude } of jars) {
    const entries = unzipSync(new Uint8Array(await readFile(task.dest)), {
      filter: (file) =>
        !file.name.endsWith("/") &&
        !exclude.some((prefix) => file.name.startsWith(prefix)),
    });
    for (const [name, data] of Object.entries(entries)) {
      const target = normalize(join(targetDir, name));
      if (!target.startsWith(root)) continue; // ignore entries that escape the folder ("zip slip")
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, data);
    }
  }
}
