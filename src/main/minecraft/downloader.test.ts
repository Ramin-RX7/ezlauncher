import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { createDownloader } from "./downloader";
import { sha1 } from "./testing/fakeFetch";

const BODY = "hello minecraft";
let server: Server;
let base: string;
let flakyHits = 0;
let active = 0;
let maxActive = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    active++;
    maxActive = Math.max(maxActive, active);
    const done = () => {
      active--;
    };
    res.on("close", done);
    switch (req.url) {
      case "/ok":
        setTimeout(() => res.end(BODY), 10);
        return;
      case "/flaky":
        if (flakyHits++ === 0) {
          res.statusCode = 500;
          res.end("oops");
        } else res.end(BODY);
        return;
      case "/slow":
        res.write("partial ");
        return; // never finishes
      default:
        res.statusCode = 404;
        res.end("nope");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-dl-"));
  flakyHits = 0;
  maxActive = 0;
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const downloader = (concurrency = 4) =>
  createDownloader({
    fetch,
    userAgent: "test",
    retries: 2,
    retryDelayMs: 1,
    concurrency,
  });

async function listAll(path: string): Promise<string[]> {
  return (await readdir(path, { recursive: true })).map(String);
}

describe("downloader", () => {
  it("downloads and verifies a file, creating folders", async () => {
    const dest = join(dir, "a", "b.txt");
    const progress: number[] = [];
    await downloader().run(
      [{ url: `${base}/ok`, dest, sha1: sha1(BODY), size: BODY.length }],
      { onProgress: (p) => progress.push(p.files) },
    );
    expect(await readFile(dest, "utf8")).toBe(BODY);
    expect(progress.at(-1)).toBe(1);
  });

  it("rejects a wrong checksum after retrying, and leaves no .part file", async () => {
    const dest = join(dir, "bad.txt");
    await expect(
      downloader().run([{ url: `${base}/ok`, dest, sha1: "0".repeat(40) }]),
    ).rejects.toMatchObject({ code: "HASH_MISMATCH" });
    expect(await listAll(dir)).toEqual([]);
  });

  it("retries server errors", async () => {
    const dest = join(dir, "flaky.txt");
    await downloader().run([{ url: `${base}/flaky`, dest, sha1: sha1(BODY) }]);
    expect(await readFile(dest, "utf8")).toBe(BODY);
    expect(flakyHits).toBe(2);
  });

  it("fails fast on 404", async () => {
    await expect(
      downloader().run([{ url: `${base}/missing`, dest: join(dir, "x") }]),
    ).rejects.toMatchObject({ code: "DOWNLOAD_FAILED" });
  });

  it("reports NOT_FOUND when fetching a missing resource", async () => {
    await expect(
      downloader().fetchText(`${base}/missing.sha1`),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("reports OFFLINE when the server can't be reached", async () => {
    const offline = createDownloader({
      fetch: () => Promise.reject(new TypeError("fetch failed")),
      userAgent: "t",
      retries: 1,
      retryDelayMs: 1,
    });
    await expect(
      offline.run([{ url: "http://x/y", dest: join(dir, "y") }]),
    ).rejects.toMatchObject({
      code: "OFFLINE",
    });
  });

  it("cancels mid-download and cleans up the partial file", async () => {
    const controller = new AbortController();
    const run = downloader().run(
      [{ url: `${base}/slow`, dest: join(dir, "slow.bin") }],
      {
        signal: controller.signal,
      },
    );
    setTimeout(() => {
      controller.abort();
    }, 100);
    await expect(run).rejects.toMatchObject({ code: "CANCELLED" });
    expect(await listAll(dir)).toEqual([]);
  });

  it("never runs more downloads at once than the concurrency limit", async () => {
    const tasks = Array.from({ length: 10 }, (_, i) => ({
      url: `${base}/ok`,
      dest: join(dir, `f${i}.txt`),
    }));
    await downloader(3).run(tasks);
    expect(maxActive).toBeLessThanOrEqual(3);
    expect(await listAll(dir)).toHaveLength(10);
  });

  it("refuses tasks that have no url", async () => {
    await expect(
      downloader().run([{ dest: join(dir, "local.jar") }]),
    ).rejects.toMatchObject({
      code: "MISSING_FILE",
    });
  });
});
