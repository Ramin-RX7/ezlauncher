import {
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sha1 } from "../minecraft/testing/fakeFetch";
import { sameFile } from "./links";
import { createLinkedStore, type ProfileLinks } from "./linkedStore";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-store-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function packStore() {
  return createLinkedStore({
    storeDir: join(dir, "store"),
    storeFile: (sha1) => join(dir, "store", `${sha1}.zip`),
    profileDir: (id) => join(dir, "profiles", id, "resourcepacks"),
    ext: ".zip",
    label: "pack",
  });
}
const folder = (id: string) => join(dir, "profiles", id, "resourcepacks");

async function addPack(name: string, bytes: string) {
  const path = join(dir, name);
  await writeFile(path, bytes);
  return packStore().storeCopy(path);
}

describe("linked store", () => {
  it("stores a file once, hashed while copying", async () => {
    const first = await addPack("a.zip", "pack A");
    const again = await addPack("copy.zip", "pack A");
    expect(first).toEqual({ sha1: sha1("pack A"), added: true });
    expect(again).toEqual({ sha1: sha1("pack A"), added: false });
    expect(await readdir(join(dir, "store"))).toEqual([
      `${sha1("pack A")}.zip`,
    ]);
  });

  it("only manages files with its extension, never folders or other files", async () => {
    await mkdir(join(folder("p"), "Folder pack"), { recursive: true });
    await writeFile(join(folder("p"), "notes.txt"), "hi");
    await writeFile(join(folder("p"), "Real.ZIP"), "zip");
    expect(await packStore().files(folder("p"))).toEqual(["Real.ZIP"]);
  });

  it("reports renamed, removed and adopted files when reconciling", async () => {
    const store = packStore();
    const a = await addPack("a.zip", "pack A");
    const b = await addPack("b.zip", "pack B");
    const links: ProfileLinks = {};
    await store.linkInto(links, "p", a.sha1, "A.zip");
    await store.linkInto(links, "p", b.sha1, "B.zip");

    await rename(
      join(folder("p"), "A.zip"),
      join(folder("p"), "A renamed.zip"),
    );
    await rm(join(folder("p"), "B.zip"));
    await writeFile(join(folder("p"), "New.zip"), "pack N");

    const adopted: string[] = [];
    const diff = await store.reconcile(
      links,
      "p",
      [a.sha1, b.sha1],
      (sha1, name) => {
        adopted.push(`${name}:${sha1}`);
        return Promise.resolve();
      },
    );
    expect(diff).toEqual({
      removed: ["B.zip"],
      renamed: [{ from: "A.zip", to: "A renamed.zip", sha1: a.sha1 }],
      adopted: [{ name: "New.zip", sha1: sha1("pack N") }],
    });
    expect(adopted).toEqual([`New.zip:${sha1("pack N")}`]);
    expect(Object.keys(links).sort()).toEqual(["A renamed.zip", "New.zip"]);
    expect(
      await sameFile(
        join(folder("p"), "New.zip"),
        join(dir, "store", `${sha1("pack N")}.zip`),
      ),
    ).toBe(true);
  });

  it("names a link after the wanted file, adding the extension and avoiding clashes", async () => {
    const store = packStore();
    const a = await addPack("a.zip", "pack A");
    const b = await addPack("b.zip", "pack B");
    const links: ProfileLinks = {};
    expect((await store.linkInto(links, "p", a.sha1, "Faithful")).name).toBe(
      "Faithful.zip",
    );
    expect(
      (await store.linkInto(links, "p", b.sha1, "Faithful.zip")).name,
    ).toBe(`Faithful-${b.sha1.slice(0, 8)}.zip`);
  });

  it("removes a stored file everywhere but leaves other files alone", async () => {
    const store = packStore();
    const a = await addPack("a.zip", "pack A");
    const all = { p: {}, q: {} } as Record<string, ProfileLinks>;
    await store.linkInto(all.p!, "p", a.sha1, "A.zip");
    await store.linkInto(all.q!, "q", a.sha1, "A.zip");
    await writeFile(join(folder("p"), "Mine.zip"), "mine");
    expect(store.usage(all).get(a.sha1)?.sort()).toEqual(["p", "q"]);

    await store.removeEverywhere(all, a.sha1);
    expect(await readdir(folder("p"))).toEqual(["Mine.zip"]);
    expect(await readdir(folder("q"))).toEqual([]);
    expect(await readdir(join(dir, "store"))).toEqual([]);
    expect(store.usage(all).size).toBe(0);
  });
});
