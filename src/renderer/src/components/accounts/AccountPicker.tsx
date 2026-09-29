import { useState } from "react";
import { useTranslation } from "react-i18next";
import { UserPlus, Users } from "lucide-react";
import { useAccounts, useSelection } from "../../state/queries";
import { Button } from "../ui/Button";
import { Select } from "../ui/Select";
import { AccountsDialog } from "./AccountsDialog";

const NONE = "";

/** The account to play with, in the top bar; Manage (or Create, with none yet) opens the account list. */
export function AccountPicker() {
  const { t } = useTranslation();
  const accounts = useAccounts();
  const { accountId, selectAccount } = useSelection();
  const [managing, setManaging] = useState(false);
  const list = accounts.data ?? [];
  const selected = list.find((a) => a.id === accountId);

  const dialog = managing && (
    <AccountsDialog
      onClose={() => {
        setManaging(false);
      }}
    />
  );

  if (accounts.isPending) return null;

  if (list.length === 0) {
    return (
      <>
        <Button
          variant="primary"
          onClick={() => {
            setManaging(true);
          }}
        >
          <UserPlus size={16} aria-hidden />
          {t("accounts.create")}
        </Button>
        {dialog}
      </>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <label htmlFor="account-select" className="text-muted">
        {t("accounts.label")}
      </label>
      <div className="flex gap-1">
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
      {dialog}
    </div>
  );
}
