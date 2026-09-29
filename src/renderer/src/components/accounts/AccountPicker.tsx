import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { USERNAME_PATTERN, type AccountInfo } from "@shared/launcher";
import { invoke } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { keys, useAccounts, useSelection } from "../../state/queries";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";

const NONE = "";

/** Pick the account to play with, create the first one, or rename it (the UUID is kept). */
export function AccountPicker() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const accounts = useAccounts();
  const { accountId, selectAccount } = useSelection();
  const list = accounts.data ?? [];
  const selected = list.find((a) => a.id === accountId);

  const [draft, setDraft] = useState<string>();
  const editing = draft !== undefined;
  const name = draft?.trim() ?? "";
  const valid = USERNAME_PATTERN.test(name);

  const save = useMutation({
    mutationFn: (username: string) => invoke("account:setUsername", username),
    onSuccess: (account: AccountInfo) => {
      void queryClient.invalidateQueries({ queryKey: keys.accounts });
      selectAccount(account.id); // creating or renaming it is an explicit choice
      setDraft(undefined);
    },
  });

  if (accounts.isPending) return null;

  if (editing || list.length === 0) {
    const creating = list.length === 0;
    return (
      <form
        className="flex flex-col gap-1 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) save.mutate(name);
        }}
      >
        <label htmlFor="account-name" className="text-muted">
          {creating ? t("accounts.create") : t("accounts.rename")}
        </label>
        <div className="flex gap-2">
          <Input
            id="account-name"
            value={draft ?? ""}
            placeholder={t("accounts.usernamePlaceholder")}
            maxLength={16}
            aria-invalid={name.length > 0 && !valid}
            aria-describedby="account-rule"
            onChange={(e) => {
              setDraft(e.target.value);
            }}
            className="w-44"
          />
          <Button
            type="submit"
            variant="secondary"
            disabled={!valid || save.isPending}
          >
            {creating ? t("accounts.create") : t("accounts.save")}
          </Button>
          {!creating && (
            <Button
              variant="ghost"
              onClick={() => {
                setDraft(undefined);
              }}
            >
              {t("accounts.cancel")}
            </Button>
          )}
        </div>
        <p
          id="account-rule"
          className={`text-xs ${name.length > 0 && !valid ? "text-danger" : "text-muted"}`}
        >
          {creating ? t("accounts.usernameRule") : t("accounts.renameHint")}
        </p>
        {save.isError && (
          <p role="alert" className="text-xs text-danger">
            {errorMessage(t, save.error)}
          </p>
        )}
      </form>
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
        {selected && (
          <Button
            variant="ghost"
            onClick={() => {
              setDraft(selected.username);
            }}
          >
            {t("accounts.rename")}
          </Button>
        )}
      </div>
    </div>
  );
}
