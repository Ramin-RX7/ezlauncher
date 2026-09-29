import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import { invoke } from "../../lib/api";
import { keys, useAccounts, useSelection } from "../../state/queries";
import { Button } from "../ui/Button";
import { Select } from "../ui/Select";
import { AccountsDialog, NameForm } from "./AccountsDialog";

const NONE = "";

/** Pick the account to play with; create the first one; Manage opens the account list. */
export function AccountPicker() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const accounts = useAccounts();
  const { accountId, selectAccount } = useSelection();
  const [managing, setManaging] = useState(false);
  const list = accounts.data ?? [];
  const selected = list.find((a) => a.id === accountId);

  const create = useMutation({
    mutationFn: (username: string) => invoke("account:add", username),
    onSuccess: (account) => {
      void queryClient.invalidateQueries({ queryKey: keys.accounts });
      selectAccount(account.id); // creating it is an explicit choice
    },
  });

  if (accounts.isPending) return null;

  if (list.length === 0) {
    return (
      <NameForm
        label={t("accounts.create")}
        submitLabel={t("accounts.create")}
        hint={t("accounts.usernameRule")}
        pending={create.isPending}
        error={create.error}
        onSubmit={(name) => {
          create.mutate(name);
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor="account-select" className="text-muted">
        {t("accounts.label")}
      </label>
      <div className="flex gap-2">
        <Select
          id="account-select"
          value={selected?.id ?? NONE}
          className="w-44"
          onChange={(id) => {
            selectAccount(id === NONE ? null : id);
          }}
          options={[
            ...(selected
              ? []
              : [{ value: NONE, label: t("accounts.choose"), disabled: true }]),
            ...list.map((a) => ({ value: a.id, label: a.username })),
          ]}
        />
        <Button
          variant="ghost"
          aria-label={t("accounts.manage")}
          title={t("accounts.manage")}
          onClick={() => {
            setManaging(true);
          }}
        >
          <Users size={16} aria-hidden />
        </Button>
      </div>
      {managing && (
        <AccountsDialog
          onClose={() => {
            setManaging(false);
          }}
        />
      )}
    </div>
  );
}
