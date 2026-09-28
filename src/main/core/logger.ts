import {
  appendFileSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { inspect } from "node:util";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface LoggerOptions {
  /** Folder for log files. Without it, logs go to the console only. */
  dir?: string;
  level?: LogLevel;
  /** Rotate when the current file grows past this size. */
  maxBytes?: number;
  /** How many rotated files to keep (`launcher.1.log` … `launcher.N.log`). */
  maxFiles?: number;
  console?: boolean;
}

export interface Logger {
  debug(message: string, ...details: unknown[]): void;
  info(message: string, ...details: unknown[]): void;
  warn(message: string, ...details: unknown[]): void;
  error(message: string, ...details: unknown[]): void;
  child(scope: string): Logger;
}

export const LOG_FILE_NAME = "launcher.log";

export function createLogger(
  options: LoggerOptions = {},
  scope?: string,
): Logger {
  const {
    dir,
    level = "info",
    maxBytes = 5 * 1024 * 1024,
    maxFiles = 3,
    console: toConsole = true,
  } = options;
  const file = dir ? join(dir, LOG_FILE_NAME) : undefined;
  if (dir) mkdirSync(dir, { recursive: true });

  function rotateIfNeeded(): void {
    if (!file || !dir) return;
    let size: number;
    try {
      size = statSync(file).size;
    } catch {
      return;
    }
    if (size < maxBytes) return;
    rmSync(join(dir, `launcher.${maxFiles}.log`), { force: true });
    for (let i = maxFiles - 1; i >= 1; i--) {
      try {
        renameSync(
          join(dir, `launcher.${i}.log`),
          join(dir, `launcher.${i + 1}.log`),
        );
      } catch {
        // file doesn't exist yet
      }
    }
    renameSync(file, join(dir, "launcher.1.log"));
  }

  function write(lvl: LogLevel, message: string, details: unknown[]): void {
    if (LEVELS[lvl] < LEVELS[level]) return;
    const extra = details.map((d) =>
      d instanceof Error ? (d.stack ?? d.message) : inspect(d),
    );
    const line = [
      new Date().toISOString(),
      lvl.toUpperCase().padEnd(5),
      scope ? `[${scope}]` : "",
      message,
      ...extra,
    ]
      .filter(Boolean)
      .join(" ");

    if (toConsole) {
      const out =
        lvl === "error"
          ? console.error
          : lvl === "warn"
            ? console.warn
            : console.log;
      out(line);
    }
    if (file) {
      try {
        rotateIfNeeded();
        appendFileSync(file, `${line}\n`);
      } catch {
        // Logging must never crash the launcher.
      }
    }
  }

  return {
    debug: (m, ...d) => {
      write("debug", m, d);
    },
    info: (m, ...d) => {
      write("info", m, d);
    },
    warn: (m, ...d) => {
      write("warn", m, d);
    },
    error: (m, ...d) => {
      write("error", m, d);
    },
    child: (childScope) =>
      createLogger(options, scope ? `${scope}:${childScope}` : childScope),
  };
}
