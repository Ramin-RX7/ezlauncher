import { z } from "zod";
import { readJson, writeJsonAtomic } from "../core/fsAtomic";
import type { Account } from "./types";

const accountsFileSchema = z.object({
  schema: z.literal(1),
  accounts: z.array(
    z.object({
      id: z.string(),
      providerId: z.string(),
      username: z.string(),
      uuid: z.string(),
      data: z.unknown().optional(),
    }),
  ),
  selectedId: z.string().nullable(),
});

export interface AccountsFile {
  accounts: Account[];
  selectedId: string | null;
}

/** `launcher/accounts.json`: all accounts and the selected one. */
export function createAccountStore(file: string) {
  return {
    async load(): Promise<AccountsFile> {
      const data = await readJson(file, accountsFileSchema);
      return data ?? { accounts: [], selectedId: null };
    },
    async save(data: AccountsFile): Promise<void> {
      await writeJsonAtomic(file, { schema: 1, ...data });
    },
  };
}

export type AccountStore = ReturnType<typeof createAccountStore>;
