import { createHash, randomUUID } from "node:crypto";
import { USERNAME_PATTERN } from "@shared/launcher";
import { AppError } from "../../core/errors";
import type { Account, AuthProvider } from "../types";

export const OFFLINE_PROVIDER_ID = "offline";

/**
 * Java's `UUID.nameUUIDFromBytes("OfflinePlayer:" + name)`: an MD5-based (version 3) UUID.
 * This is the UUID offline-mode servers give a player. Returned without dashes.
 */
export function offlineUuid(username: string): string {
  const hash = createHash("md5")
    .update(`OfflinePlayer:${username}`, "utf8")
    .digest();
  hash[6] = ((hash[6] ?? 0) & 0x0f) | 0x30; // version 3
  hash[8] = ((hash[8] ?? 0) & 0x3f) | 0x80; // IETF variant
  return hash.toString("hex");
}

export function validateUsername(input: unknown): string {
  const username = typeof input === "string" ? input.trim() : "";
  if (!USERNAME_PATTERN.test(username)) {
    throw new AppError(
      "INVALID_USERNAME",
      "Usernames are 3–16 characters: letters, numbers and _ only.",
    );
  }
  return username;
}

export const offlineProvider: AuthProvider = {
  id: OFFLINE_PROVIDER_ID,
  displayName: "Offline",

  // eslint-disable-next-line @typescript-eslint/require-await -- async so validation errors reject
  async createAccount(input) {
    const username = validateUsername(
      (input as { username?: unknown } | null)?.username,
    );
    return {
      id: randomUUID(),
      providerId: OFFLINE_PROVIDER_ID,
      username,
      uuid: offlineUuid(username),
    };
  },

  // eslint-disable-next-line @typescript-eslint/require-await -- async so validation errors reject
  async renameAccount(account: Account, username: string) {
    // The UUID stays: stats, advancements and player data belong to it.
    return { ...account, username: validateUsername(username) };
  },

  getLaunchIdentity(account) {
    return Promise.resolve({
      username: account.username,
      uuid: account.uuid,
      accessToken: "0",
      userType: "legacy",
    });
  },
};
