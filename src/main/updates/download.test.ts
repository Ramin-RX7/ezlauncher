import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeFetch } from "../minecraft/testing/fakeFetch";
import { downloadVerified } from "./download";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-update-dl-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const body = new Uint8Array(4096).map((_, i) => i % 251);
const sha256 = createHash("sha256").update(body).digest("hex");
const URL = "https://example.test/EZ.exe";
const file = { name: "EZ.exe", url: URL, size: body.length, sha256 };

describe("downloadVerified", () => {
  it("writes a file that matches the feed", async () => {
    const { fetch } = createFakeFetch({ [URL]: body });
    const progress: number[] = [];
    await downloadVerified(fetch, file, join(dir, "EZ.exe"), {
      onProgress: (n) => progress.push(n),
    });
    expect(new Uint8Array(await readFile(join(dir, "EZ.exe")))).toEqual(body);
    expect(progress.at(-1)).toBe(body.length);
  });

  it("deletes a download that doesn't match", async () => {
    const { fetch } = createFakeFetch({ [URL]: body });
    await expect(
      downloadVerified(
        fetch,
        { ...file, sha256: "0".repeat(64) },
        join(dir, "x"),
      ),
    ).rejects.toMatchObject({ code: "UPDATE_DAMAGED" });
    await expect(
      downloadVerified(fetch, { ...file, size: 10 }, join(dir, "x")),
    ).rejects.toMatchObject({ code: "UPDATE_DAMAGED" });
    expect(await readdir(dir)).toEqual([]);
  });

  it("tells offline from a missing file", async () => {
    const fake = createFakeFetch({});
    await expect(
      downloadVerified(fake.fetch, file, join(dir, "x")),
    ).rejects.toMatchObject({ code: "UPDATE_FAILED" });
    fake.setOffline(true);
    await expect(
      downloadVerified(fake.fetch, file, join(dir, "x")),
    ).rejects.toMatchObject({ code: "OFFLINE" });
  });
});
