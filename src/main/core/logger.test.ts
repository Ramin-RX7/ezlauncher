import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLogger, LOG_FILE_NAME } from "./logger";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-log-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("logger", () => {
  it("writes lines with level and scope, and skips levels below the minimum", async () => {
    const log = createLogger({ dir, level: "info", console: false }).child(
      "ipc",
    );
    log.debug("hidden");
    log.info("hello");
    log.error("failed", new Error("boom"));

    const text = await readFile(join(dir, LOG_FILE_NAME), "utf8");
    expect(text).not.toContain("hidden");
    expect(text).toMatch(/INFO {2}\[ipc\] hello/);
    expect(text).toContain("Error: boom");
  });

  it("rotates files and keeps at most maxFiles old ones", async () => {
    const log = createLogger({
      dir,
      console: false,
      maxBytes: 50,
      maxFiles: 2,
    });
    for (let i = 0; i < 10; i++) log.info(`line number ${i} with some padding`);

    const files = (await readdir(dir)).sort();
    expect(files).toEqual(["launcher.1.log", "launcher.2.log", "launcher.log"]);
  });
});
