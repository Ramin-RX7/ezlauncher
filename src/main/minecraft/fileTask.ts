/** One file that must exist on disk, and where to get it if it doesn't. */
export interface FileTask {
  /** Absolute destination path. */
  dest: string;
  /** Where to download it. Missing = the file is produced locally (e.g. by a mod loader installer). */
  url?: string;
  sha1?: string;
  size?: number;
}

/** Drop duplicate destinations, keeping the first. */
export function uniqueTasks(tasks: readonly FileTask[]): FileTask[] {
  const seen = new Set<string>();
  return tasks.filter((t) => {
    if (seen.has(t.dest)) return false;
    seen.add(t.dest);
    return true;
  });
}
