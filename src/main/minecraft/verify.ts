import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { FileTask } from "./fileTask";

export type CheckMode = "quick" | "full";

export async function sha1File(path: string): Promise<string> {
  const hash = createHash("sha1");
  for await (const chunk of createReadStream(path))
    hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/**
 * Is this file present and correct?
 * `quick`: exists with the expected size. `full`: the SHA1 also matches.
 */
export async function isFileValid(
  task: FileTask,
  mode: CheckMode,
): Promise<boolean> {
  let size: number;
  try {
    const s = await stat(task.dest);
    if (!s.isFile()) return false;
    size = s.size;
  } catch {
    return false;
  }
  if (task.size !== undefined && size !== task.size) return false;
  if (mode === "full" && task.sha1) {
    return (await sha1File(task.dest)) === task.sha1.toLowerCase();
  }
  return true;
}

/** Return the tasks whose files are missing or invalid. Checks run a few at a time. */
export async function checkFiles(
  tasks: readonly FileTask[],
  mode: CheckMode,
  concurrency = 32,
): Promise<FileTask[]> {
  const bad: FileTask[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      const task = tasks[next++] as FileTask;
      if (!(await isFileValid(task, mode))) bad.push(task);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()),
  );
  // Keep the original order for predictable downloads and tests.
  const order = new Map(tasks.map((t, i) => [t.dest, i]));
  return bad.sort(
    (a, b) => (order.get(a.dest) ?? 0) - (order.get(b.dest) ?? 0),
  );
}
