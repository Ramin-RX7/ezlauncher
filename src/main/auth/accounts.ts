import { AppError } from "../core/errors";
import type { AccountStore } from "./accountStore";
import { validateUsername } from "./providers/offline";
import type { Account, AuthProvider } from "./types";

/**
 * The launcher's accounts: add, rename, remove. Names are unique ignoring case,
 * because two offline accounts with the same name would share a UUID (and progress).
 * The UUID is made once when an account is added; renaming never changes it.
 */
export function createAccounts({
  store,
  provider,
  getProvider,
}: {
  store: AccountStore;
  /** The provider new accounts are made with (offline, for now). */
  provider: AuthProvider;
  /** The provider an existing account belongs to. */
  getProvider: (id: string) => AuthProvider;
}) {
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };

  function assertFree(accounts: readonly Account[], name: string, id?: string) {
    const taken = accounts.find(
      (a) => a.id !== id && a.username.toLowerCase() === name.toLowerCase(),
    );
    if (taken)
      throw new AppError(
        "ACCOUNT_NAME_TAKEN",
        `An account named ${taken.username} already exists.`,
      );
  }

  function find(accounts: readonly Account[], id: unknown): Account {
    const account = accounts.find((a) => a.id === id);
    if (!account) throw new AppError("NO_ACCOUNT", "Account not found.");
    return account;
  }

  return {
    async list(): Promise<Account[]> {
      return (await store.load()).accounts;
    },

    async get(id: string): Promise<Account | undefined> {
      return (await store.load()).accounts.find((a) => a.id === id);
    },

    add(username: unknown): Promise<Account> {
      return serial(async () => {
        const data = await store.load();
        assertFree(data.accounts, validateUsername(username));
        const account = await provider.createAccount({ username });
        await store.save({ ...data, accounts: [...data.accounts, account] });
        return account;
      });
    },

    rename(id: unknown, username: unknown): Promise<Account> {
      return serial(async () => {
        const data = await store.load();
        const account = find(data.accounts, id);
        const name = validateUsername(username);
        assertFree(data.accounts, name, account.id);
        const owner = getProvider(account.providerId);
        if (!owner.renameAccount)
          throw new AppError(
            "RENAME_UNSUPPORTED",
            "This account can't be renamed.",
          );
        const renamed = await owner.renameAccount(account, name);
        await store.save({
          ...data,
          accounts: data.accounts.map((a) =>
            a.id === account.id ? renamed : a,
          ),
        });
        return renamed;
      });
    },

    /** Removes the account from the launcher only; no world files are touched. */
    remove(id: unknown): Promise<void> {
      return serial(async () => {
        const data = await store.load();
        const account = find(data.accounts, id);
        await getProvider(account.providerId).removeAccount?.(account);
        await store.save({
          ...data,
          accounts: data.accounts.filter((a) => a.id !== account.id),
          selectedId: data.selectedId === account.id ? null : data.selectedId,
        });
      });
    },
  };
}

export type Accounts = ReturnType<typeof createAccounts>;
