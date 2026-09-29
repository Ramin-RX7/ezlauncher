import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { mkdir, open, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { AppError } from "../core/errors";
import type { LaunchCommand } from "./arguments";
import { createGameLogParser } from "./gameLog";

export interface GameExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  crashed: boolean;
}

export interface GameHandle {
  pid: number;
  /** Receives new log lines as the game writes them (while the launcher runs). */
  onLog(listener: (lines: string[]) => void): void;
  onExit(listener: (exit: GameExit) => void): void;
  /** Stop following the log (the game keeps running). */
  detach(): void;
}

async function countCrashReports(gameDir: string): Promise<number> {
  try {
    return (await readdir(join(gameDir, "crash-reports"))).length;
  } catch {
    return 0;
  }
}

/**
 * Start the game. Its output goes to a file (not a pipe), so the game keeps running
 * even if the launcher quits; the launcher follows that file for the live log view.
 */
export async function launchGame(
  command: LaunchCommand,
  { logFile, pollMs = 250 }: { logFile: string; pollMs?: number },
): Promise<GameHandle> {
  await mkdir(command.cwd, { recursive: true });
  await mkdir(dirname(logFile), { recursive: true });
  const crashReportsBefore = await countCrashReports(command.cwd);

  const fd = openSync(logFile, "w");
  let child;
  try {
    child = spawn(command.javaPath, command.args, {
      cwd: command.cwd,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", fd, fd],
    });
  } finally {
    closeSync(fd); // the child has its own copy
  }

  const pid = await new Promise<number>((resolve, reject) => {
    child.once("spawn", () => {
      resolve(child.pid ?? -1);
    });
    child.once("error", (err) => {
      reject(
        new AppError("LAUNCH_FAILED", `Could not start Java: ${err.message}`, {
          cause: err,
        }),
      );
    });
  });
  child.unref();

  const logListeners: ((lines: string[]) => void)[] = [];
  const exitListeners: ((exit: GameExit) => void)[] = [];

  // Follow the log file.
  const reader = await open(logFile, "r");
  const decoder = new StringDecoder("utf8");
  const parseLog = createGameLogParser();
  let position = 0;
  let partial = "";
  let detached = false;
  const buffer = Buffer.alloc(64 * 1024);

  const readOnce = async (flush: boolean): Promise<void> => {
    if (detached) return;
    for (;;) {
      const { bytesRead } = await reader.read(
        buffer,
        0,
        buffer.length,
        position,
      );
      if (bytesRead === 0) break;
      position += bytesRead;
      partial += decoder.write(buffer.subarray(0, bytesRead));
    }
    const lines = partial.split(/\r?\n/);
    // The last piece may be an unfinished line; keep it for next time unless flushing.
    partial = flush ? "" : (lines.pop() ?? "");
    const complete = parseLog(lines.filter((l) => l.length > 0));
    if (complete.length > 0) for (const l of logListeners) l(complete);
  };

  // Reads run one after another, never overlapping.
  let chain = Promise.resolve();
  const readNew = (flush = false): Promise<void> => {
    chain = chain.then(() => readOnce(flush)).catch(() => undefined);
    return chain;
  };

  const timer = setInterval(() => {
    void readNew();
  }, pollMs);

  const stop = async (): Promise<void> => {
    clearInterval(timer);
    detached = true;
    await reader.close().catch(() => undefined);
  };

  child.once("exit", (code, signal) => {
    void (async () => {
      await readNew(true);
      await stop();
      const crashed =
        (code !== 0 && code !== null) ||
        (await countCrashReports(command.cwd)) > crashReportsBefore;
      for (const l of exitListeners) l({ code, signal, crashed });
    })();
  });

  return {
    pid,
    onLog: (listener) => {
      logListeners.push(listener);
    },
    onExit: (listener) => {
      exitListeners.push(listener);
    },
    detach: () => {
      void stop();
    },
  };
}
