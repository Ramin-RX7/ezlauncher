import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, strToU8, Zip, ZipDeflate, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readZipEntries } from "./zipEntries";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-zip-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function file(name: string, bytes: Uint8Array) {
  const path = join(dir, name);
  await writeFile(path, bytes);
  return path;
}

const readOne = async (path: string, name: string, max = 1024 * 1024) => {
  const result = await readZipEntries(
    path,
    (entries) => entries.filter((e) => e.name === name),
    max,
  );
  const data = result?.data.get(name);
  return data ? strFromU8(data) : data;
};

/** A zip written as a stream: sizes follow each entry in a data descriptor. */
function streamedZip(entries: Record<string, string>): Uint8Array {
  const chunks: Uint8Array[] = [];
  const zip = new Zip((err, data) => {
    if (err) throw err;
    chunks.push(data);
  });
  for (const [name, text] of Object.entries(entries)) {
    const entry = new ZipDeflate(name, { level: 6 });
    zip.add(entry);
    entry.push(strToU8(text), true);
  }
  zip.end();
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

describe("readZipEntries", () => {
  it("reads stored and deflated entries, and lists the index", async () => {
    const path = await file(
      "pack.zip",
      zipSync({
        "pack.mcmeta": [strToU8('{"pack":{}}'), { level: 0 }],
        "assets/big.txt": [strToU8("x".repeat(5000)), { level: 9 }],
      }),
    );
    expect(await readOne(path, "pack.mcmeta")).toBe('{"pack":{}}');
    expect(await readOne(path, "assets/big.txt")).toBe("x".repeat(5000));
    const result = await readZipEntries(path, () => [], 1024);
    expect(result?.entries.map((e) => e.name)).toEqual([
      "pack.mcmeta",
      "assets/big.txt",
    ]);
  });

  it("reads entries written with a data descriptor", async () => {
    const path = await file(
      "streamed.zip",
      streamedZip({ "pack.mcmeta": "streamed", other: "o" }),
    );
    expect(await readOne(path, "pack.mcmeta")).toBe("streamed");
  });

  it("finds the index behind an archive comment", async () => {
    const zip = zipSync({ "pack.mcmeta": strToU8("with comment") });
    const comment = strToU8("a comment at the end");
    const withComment = new Uint8Array(zip.length + comment.length);
    withComment.set(zip);
    withComment.set(comment, zip.length);
    // The comment length is the last field of the end record.
    new DataView(withComment.buffer).setUint16(
      zip.length - 2,
      comment.length,
      true,
    );
    const path = await file("comment.zip", withComment);
    expect(await readOne(path, "pack.mcmeta")).toBe("with comment");
  });

  it("leaves out entries bigger than the limit", async () => {
    const path = await file(
      "big.zip",
      zipSync({ "pack.png": strToU8("y".repeat(2000)) }),
    );
    expect(await readOne(path, "pack.png", 1000)).toBeUndefined();
  });

  it("treats zip64, damaged and non-zip files as unreadable", async () => {
    const zip = zipSync({ a: strToU8("a") });
    const zip64 = zip.slice();
    // Entry count 0xffff in the end record means "see the zip64 record".
    new DataView(zip64.buffer).setUint16(zip64.length - 12, 0xffff, true);
    for (const [name, bytes] of [
      ["zip64.zip", zip64],
      ["cut.zip", zip.slice(0, zip.length - 30)],
      ["text.zip", strToU8("not a zip at all")],
      ["empty.zip", new Uint8Array()],
    ] as const) {
      expect(
        await readZipEntries(await file(name, bytes), () => [], 1024),
      ).toBeUndefined();
    }
    expect(
      await readZipEntries(join(dir, "missing.zip"), () => [], 1024),
    ).toBeUndefined();
  });
});
