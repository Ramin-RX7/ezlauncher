import { describe, expect, it } from "vitest";
import { offlineProvider, offlineUuid } from "./offline";

describe("offline provider", () => {
  it("matches Java's nameUUIDFromBytes for a known player", () => {
    // Known offline UUID for "Notch": b50ad385-829d-3141-a216-7e7d7539ba7f
    expect(offlineUuid("Notch")).toBe("b50ad385829d3141a2167e7d7539ba7f");
  });

  it("validates usernames", async () => {
    await expect(
      offlineProvider.createAccount({ username: "ab" }),
    ).rejects.toMatchObject({
      code: "INVALID_USERNAME",
    });
    await expect(
      offlineProvider.createAccount({ username: "bad name" }),
    ).rejects.toMatchObject({
      code: "INVALID_USERNAME",
    });
    await expect(
      offlineProvider.createAccount({ username: "x".repeat(17) }),
    ).rejects.toBeTruthy();
    await expect(
      offlineProvider.createAccount({ username: " Steve_1 " }),
    ).resolves.toMatchObject({
      username: "Steve_1",
    });
  });

  it("keeps the UUID when renaming", async () => {
    const account = await offlineProvider.createAccount({ username: "Steve" });
    const renamed = await offlineProvider.renameAccount!(account, "Alex");
    expect(renamed.username).toBe("Alex");
    expect(renamed.uuid).toBe(account.uuid);
    expect(renamed.uuid).toBe(offlineUuid("Steve"));
  });

  it("gives a legacy launch identity", async () => {
    const account = await offlineProvider.createAccount({ username: "Steve" });
    await expect(offlineProvider.getLaunchIdentity(account)).resolves.toEqual({
      username: "Steve",
      uuid: account.uuid,
      accessToken: "0",
      userType: "legacy",
    });
  });
});
