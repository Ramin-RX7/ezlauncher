/*
 * Command-line flags an update starts the new version with (see apply.ts).
 * No Electron imports: index.ts reads them before anything else starts.
 */

/** `--ezl-updated=<pid>`: wait for that (old) process to exit before starting. */
export const UPDATED_FLAG = "--ezl-updated=";
/** `--ezl-update-finish=<target>`: put the new version in place of `target`, then exit (no window). */
export const UPDATE_FINISH_FLAG = "--ezl-update-finish=";
/** With the finish flag: the new version to copy in (default `<target>.new`). */
export const UPDATE_FROM_FLAG = "--ezl-update-from=";
/** With the finish flag: don't start the app afterwards (it was installed on quit). */
export const NO_RESTART_FLAG = "--ezl-no-restart";
/** The update couldn't be finished and the old version was started again. */
export const UPDATE_FAILED_FLAG = "--ezl-update-failed";

export interface UpdateFlags {
  waitPid?: number;
  /** `--ezl-update-finish`: what to replace, and with what. */
  finishTarget?: string;
  finishSource?: string;
  restart: boolean;
  failed: boolean;
}

export function readUpdateFlags(argv: readonly string[]): UpdateFlags {
  const flags: UpdateFlags = { restart: true, failed: false };
  for (const arg of argv) {
    if (arg.startsWith(UPDATED_FLAG)) {
      const pid = Number(arg.slice(UPDATED_FLAG.length));
      if (Number.isInteger(pid) && pid > 0) flags.waitPid = pid;
    } else if (arg.startsWith(UPDATE_FINISH_FLAG)) {
      const target = arg.slice(UPDATE_FINISH_FLAG.length);
      if (target) flags.finishTarget = target;
    } else if (arg.startsWith(UPDATE_FROM_FLAG)) {
      const source = arg.slice(UPDATE_FROM_FLAG.length);
      if (source) flags.finishSource = source;
    } else if (arg === NO_RESTART_FLAG) flags.restart = false;
    else if (arg === UPDATE_FAILED_FLAG) flags.failed = true;
  }
  return flags;
}
