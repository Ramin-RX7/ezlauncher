import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAccountStore } from "./accountStore";
import { createAccounts } from "./accounts";
import { offlineProvider, offlineUuid } from "./providers/offline";
import { getProvider } from "./registry";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezl-accounts-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const accounts = () =>
  createAccounts({
    store: createAccountStore(join(dir, "accounts.json")),
    provider: offlineProvider,
    getProvider,
  });

describe("accounts", () => {
  it("adds several accounts, each with its offline UUID", async () => {
    const a = accounts();
    const steve = await a.add("Steve");
    const alex = await a.add("Alex");
    expect(steve.uuid).toBe(offlineUuid("Steve"));
    expect((await a.list()).map((x) => x.username)).toEqual(["Steve", "Alex"]);
    expect(alex.id).not.toBe(steve.id);
  });

  it("refuses a name that is taken, in any case", async () => {
    const a = accounts();
    await a.add("Steve");
    await expect(a.add("steve")).rejects.toMatchObject({
      code: "ACCOUNT_NAME_TAKEN",
    });
    const alex = await a.add("Alex");
    await expect(a.rename(alex.id, "STEVE")).rejects.toMatchObject({
      code: "ACCOUNT_NAME_TAKEN",
    });
  });

  it("follows the name rules", async () => {
    const a = accounts();
    for (const bad of ["ab", "x".repeat(17), "has space", "dash-y", ""])
      await expect(a.add(bad)).rejects.toMatchObject({
        code: "INVALID_USERNAME",
      });
    expect((await a.add("  Under_Score9 ")).username).toBe("Under_Score9");
  });

  it("keeps the UUID when renaming, also to another case of the same name", async () => {
    const a = accounts();
    const steve = await a.add("Steve");
    const renamed = await a.rename(steve.id, "Steve2");
    expect(renamed).toMatchObject({ id: steve.id, uuid: steve.uuid });
    expect((await a.rename(steve.id, "STEVE2")).uuid).toBe(steve.uuid);
    expect(await a.get(steve.id)).toMatchObject({ username: "STEVE2" });
  });

  it("removes one account and leaves the others", async () => {
    const a = accounts();
    const steve = await a.add("Steve");
    const alex = await a.add("Alex");
    await a.remove(steve.id);
    expect((await a.list()).map((x) => x.id)).toEqual([alex.id]);
    await expect(a.remove(steve.id)).rejects.toMatchObject({
      code: "NO_ACCOUNT",
    });
  });

  it("keeps every add when several happen at once", async () => {
    const a = accounts();
    await Promise.all(["One", "Two", "Three"].map((n) => a.add(n)));
    expect((await a.list()).map((x) => x.username).sort()).toEqual([
      "One",
      "Three",
      "Two",
    ]);
  });
});
