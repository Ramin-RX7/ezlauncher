import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { AppError } from "./errors";
import { readJson, writeFileAtomic, writeJsonAtomic } from "./fsAtomic";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-fs-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("writeFileAtomic", () => {
  it("creates missing parent folders and leaves no temp files", async () => {
    const file = join(dir, "a", "b", "file.txt");
    await writeFileAtomic(file, "hello");
    expect(await readFile(file, "utf8")).toBe("hello");
    expect(await readdir(join(dir, "a", "b"))).toEqual(["file.txt"]);
  });

  it("replaces an existing file", async () => {
    const file = join(dir, "file.txt");
    await writeFileAtomic(file, "old");
    await writeFileAtomic(file, "new");
    expect(await readFile(file, "utf8")).toBe("new");
  });
});

describe("readJson", () => {
  const schema = z.object({ name: z.string() });

  it("round-trips with writeJsonAtomic", async () => {
    const file = join(dir, "data.json");
    await writeJsonAtomic(file, { name: "Steve" });
    expect(await readJson(file, schema)).toEqual({ name: "Steve" });
  });

  it("returns undefined for a missing file", async () => {
    expect(await readJson(join(dir, "missing.json"), schema)).toBeUndefined();
  });

  it("throws INVALID_JSON for broken or wrongly shaped files", async () => {
    const broken = join(dir, "broken.json");
    await writeFile(broken, "{ nope");
    await expect(readJson(broken, schema)).rejects.toMatchObject({
      code: "INVALID_JSON",
    });

    const wrong = join(dir, "wrong.json");
    await writeFile(wrong, '{"name": 42}');
    await expect(readJson(wrong, schema)).rejects.toBeInstanceOf(AppError);
  });
});
