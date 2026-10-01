import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readShaderFolder, readShaderZip } from "./shaderMeta";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-shadermeta-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function zip(name: string, files: Record<string, string>) {
  const path = join(dir, name);
  const entries = Object.fromEntries(
    Object.entries(files).map(([n, t]) => [n, strToU8(t)]),
  );
  await writeFile(path, zipSync(entries));
  return path;
}

describe("readShaderZip", () => {
  it("accepts a zip with shaders/ at the root", async () => {
    const path = await zip("A.zip", { "shaders/final.fsh": "void main(){}" });
    expect(await readShaderZip(path)).toEqual({
      status: "ok",
      meta: { description: "" },
    });
  });

  it("accepts shaders/ inside a wrapper folder, as Iris does", async () => {
    const path = await zip("B.zip", { "Pack v1/shaders/final.fsh": "x" });
    expect((await readShaderZip(path)).status).toBe("ok");
  });

  it("rejects a zip without shaders/", async () => {
    const path = await zip("C.zip", {
      "pack.mcmeta": "{}",
      "myshaders.txt": "x",
    });
    expect(await readShaderZip(path)).toEqual({ status: "invalid" });
  });

  it("reports a damaged zip as unreadable", async () => {
    const path = join(dir, "D.zip");
    await writeFile(path, "not a zip");
    expect(await readShaderZip(path)).toEqual({ status: "unreadable" });
  });
});

describe("readShaderFolder", () => {
  it("accepts a folder with shaders/", async () => {
    await mkdir(join(dir, "Pack", "shaders"), { recursive: true });
    expect((await readShaderFolder(join(dir, "Pack"))).status).toBe("ok");
  });

  it("reports a pack one folder too deep", async () => {
    await mkdir(join(dir, "Outer", "Inner", "shaders"), { recursive: true });
    expect(await readShaderFolder(join(dir, "Outer"))).toEqual({
      status: "nested",
      folder: "Inner",
    });
  });

  it("rejects a folder without shaders/", async () => {
    await mkdir(join(dir, "Empty"), { recursive: true });
    expect(await readShaderFolder(join(dir, "Empty"))).toEqual({
      status: "invalid",
    });
  });
});
