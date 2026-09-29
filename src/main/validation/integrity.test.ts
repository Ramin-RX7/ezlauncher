import {
  mkdtemp,
  readFile,
  rm,
  truncate,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sha1 } from "../minecraft/testing/fakeFetch";
import { fabricMod } from "../profiles/testing/modJars";
import { checkIntegrity, jarIndexOpens } from "./integrity";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-integrity-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function storeJar(id = "sodium") {
  const bytes = fabricMod(id, "0.4.1");
  const hash = sha1(bytes);
  const path = join(dir, `${hash}.jar`);
  await writeFile(path, bytes);
  return { sha1: hash, path, size: bytes.length };
}

describe("checkIntegrity", () => {
  it("passes a good jar and records its hash check", async () => {
    const jar = await storeJar();
    expect(await jarIndexOpens(jar.path, jar.size)).toBe(true);
    const result = await checkIntegrity([jar]);
    expect(result.damaged.size).toBe(0);
    expect(result.verified).toEqual([
      expect.objectContaining({ sha1: jar.sha1, size: jar.size }),
    ]);
  });

  it("skips the SHA1 when the file hasn't changed since it was verified", async () => {
    const jar = await storeJar();
    const [verified] = (await checkIntegrity([jar])).verified;
    const again = await checkIntegrity([{ ...jar, verified: verified! }]);
    expect(again.verified).toEqual([]);
    expect(again.damaged.size).toBe(0);
  });

  it("finds one changed byte once the file's modified time changed", async () => {
    const jar = await storeJar();
    const [verified] = (await checkIntegrity([jar])).verified;
    // Change a byte inside the compressed data; size and zip index stay intact.
    const bytes = await readFile(jar.path);
    bytes[40] = (bytes[40] ?? 0) ^ 0xff;
    await writeFile(jar.path, bytes);
    const later = new Date(Date.now() + 5000);
    await utimes(jar.path, later, later);
    const result = await checkIntegrity([{ ...jar, verified: verified! }]);
    expect(result.damaged.get(jar.sha1)).toBe("sha1");
  });

  it("hashes every file on Check mods, even unchanged ones", async () => {
    const jar = await storeJar();
    const [verified] = (await checkIntegrity([jar])).verified;
    const bytes = await readFile(jar.path);
    bytes[40] = (bytes[40] ?? 0) ^ 0xff;
    await writeFile(jar.path, bytes);
    const same = verified!.mtimeMs / 1000; // same time, as if nothing happened
    await utimes(jar.path, same, same);
    const quick = await checkIntegrity([{ ...jar, verified: verified! }]);
    expect([...quick.damaged.values()]).toEqual([]);
    const full = await checkIntegrity([{ ...jar, verified: verified! }], {
      full: true,
    });
    expect(full.damaged.get(jar.sha1)).toBe("sha1");
  });

  it("reports missing, resized and unreadable files", async () => {
    const gone = await storeJar("gone");
    await rm(gone.path);
    const resized = await storeJar();
    const cut = { ...resized, path: join(dir, "cut.jar") };
    await writeFile(cut.path, await readFile(resized.path));
    await truncate(cut.path, resized.size - 10);
    const noIndex = { ...cut, size: resized.size - 10 };
    const result = await checkIntegrity([
      gone,
      { ...cut, sha1: "a".repeat(40) },
      { ...noIndex, sha1: "b".repeat(40) },
    ]);
    expect([...result.damaged.values()]).toEqual([
      "missing",
      "size",
      "unreadable",
    ]);
  });

  it("checks profile copies too", async () => {
    const jar = await storeJar();
    const copy = join(dir, "copy.jar");
    await writeFile(copy, new Uint8Array([1, 2, 3]));
    const result = await checkIntegrity([{ ...jar, copies: [copy] }]);
    expect(result.damaged.get(jar.sha1)).toBe("size");
  });
});
