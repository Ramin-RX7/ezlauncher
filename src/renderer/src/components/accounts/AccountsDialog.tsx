import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Check, Copy, Pencil, Trash2 } from "lucide-react";
import { USERNAME_PATTERN, type AccountInfo } from "@shared/launcher";
import { invoke } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { useLauncherState } from "../../state/launcherStore";
import { keys, useAccounts, useSelection } from "../../state/queries";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Input } from "../ui/Input";

/** The 32 hex digits with dashes, as servers and tools show UUIDs. */
function formatUuid(uuid: string): string {
  return uuid.length === 32
    ? `${uuid.slice(0, 8)}-${uuid.slice(8, 12)}-${uuid.slice(12, 16)}-${uuid.slice(16, 20)}-${uuid.slice(20)}`
    : uuid;
}

/** A name field with the username rules; `onSubmit` gets the trimmed name. */
export function NameForm({
  label,
  initial = "",
  submitLabel,
  hint,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  label: string;
  initial?: string;
  submitLabel: string;
  hint: string;
  pending: boolean;
  error?: unknown;
  onSubmit: (name: string) => void;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(initial);
  const name = draft.trim();
  const valid = USERNAME_PATTERN.test(name);
  const id = `name-${label}`;
  return (
    <form
      className="flex flex-col gap-1 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSubmit(name);
      }}
    >
      <label htmlFor={id} className="text-muted">
        {label}
      </label>
      <div className="flex gap-2">
        <Input
          id={id}
          autoFocus
          value={draft}
          placeholder={t("accounts.usernamePlaceholder")}
          maxLength={16}
          aria-invalid={name.length > 0 && !valid}
          onChange={(e) => {
            setDraft(e.target.value);
          }}
          className="w-44"
        />
        <Button type="submit" variant="secondary" disabled={!valid || pending}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            {t("accounts.cancel")}
          </Button>
        )}
      </div>
      <p
        className={`text-xs ${name.length > 0 && !valid ? "text-danger" : "text-muted"}`}
      >
        {hint}
      </p>
      {error !== undefined && error !== null && (
        <p role="alert" className="text-xs text-danger">
          {errorMessage(t, error)}
        </p>
      )}
    </form>
  );
}

/** Every account: add, rename (the UUID stays), delete, and the UUID to copy. */
export function AccountsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const accounts = useAccounts();
  const { accountId, selectAccount } = useSelection();
  const running = useLauncherState((s) => s.running);
  const [renaming, setRenaming] = useState<string>();
  const [deleting, setDeleting] = useState<AccountInfo>();
  const [copied, setCopied] = useState<string>();
  /** Bumped after each add, so the name field starts empty again. */
  const [added, setAdded] = useState(0);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: keys.accounts });
  };

  const add = useMutation({
    mutationFn: (username: string) => invoke("account:add", username),
    onSuccess: (account) => {
      refresh();
      setAdded((n) => n + 1);
      if (!accountId) selectAccount(account.id);
    },
  });
  const rename = useMutation({
    mutationFn: (args: { id: string; username: string }) =>
      invoke("account:rename", args),
    onSuccess: () => {
      refresh();
      setRenaming(undefined);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => invoke("account:remove", id),
    onSuccess: () => {
      refresh();
      void queryClient.invalidateQueries({ queryKey: keys.settings });
      setDeleting(undefined);
    },
  });

  const list = accounts.data ?? [];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("accounts.title")}
      closeLabel={t("accounts.close")}
    >
      <div className="flex max-h-[65vh] flex-col gap-4 overflow-auto">
        <ul className="flex flex-col divide-y divide-border rounded-ezl border border-border">
          {list.map((a) => {
            const playing = running.some((g) => g.accountId === a.id);
            return (
              <li key={a.id} className="flex flex-col gap-2 p-3">
                {renaming === a.id ? (
                  <NameForm
                    label={t("accounts.renameLabel", { name: a.username })}
                    initial={a.username}
                    submitLabel={t("accounts.save")}
                    hint={t("accounts.serverWarning")}
                    pending={rename.isPending}
                    error={rename.error}
                    onSubmit={(username) => {
                      rename.mutate({ id: a.id, username });
                    }}
                    onCancel={() => {
                      setRenaming(undefined);
                      rename.reset();
                    }}
                  />
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="flex-1 font-medium">
                      {a.username}
                      {playing && (
                        <span className="ms-2 text-xs text-success">
                          {t("accounts.playing")}
                        </span>
                      )}
                    </span>
                    <Button
                      variant="ghost"
                      className="h-8 px-2"
                      aria-label={t("accounts.renameAction", {
                        name: a.username,
                      })}
                      onClick={() => {
                        rename.reset();
                        setRenaming(a.id);
                      }}
                    >
                      <Pencil size={14} aria-hidden />
                      {t("accounts.rename")}
                    </Button>
                    <Button
                      variant="ghost"
                      className="h-8 px-2"
                      disabled={playing}
                      aria-label={t("accounts.deleteAction", {
                        name: a.username,
                      })}
                      onClick={() => {
                        remove.reset();
                        setDeleting(a);
                      }}
                    >
                      <Trash2 size={14} aria-hidden />
                      {t("accounts.delete")}
                    </Button>
                  </div>
                )}
                <div className="flex items-center gap-2 text-xs text-muted">
                  <span>{t("accounts.uuid")}</span>
                  <code dir="ltr" className="min-w-0 flex-1 truncate">
                    {formatUuid(a.uuid)}
                  </code>
                  <Button
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    aria-label={t("accounts.copyUuid", { name: a.username })}
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(formatUuid(a.uuid))
                        .then(() => {
                          setCopied(a.id);
                        });
                    }}
                  >
                    {copied === a.id ? (
                      <Check size={14} aria-hidden />
                    ) : (
                      <Copy size={14} aria-hidden />
                    )}
                    {copied === a.id
                      ? t("accounts.copied")
                      : t("accounts.copy")}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>

        <NameForm
          key={added}
          label={t("accounts.newName")}
          submitLabel={t("accounts.add")}
          hint={t("accounts.usernameRule")}
          pending={add.isPending}
          error={add.error}
          onSubmit={(username) => {
            add.mutate(username);
          }}
        />
      </div>

      {deleting && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setDeleting(undefined);
          }}
          title={t("accounts.deleteTitle", { name: deleting.username })}
          description={t("accounts.deleteBody")}
          closeLabel={t("accounts.cancel")}
          footer={
            <>
              <Button
                onClick={() => {
                  setDeleting(undefined);
                }}
              >
                {t("accounts.cancel")}
              </Button>
              <Button
                variant="danger"
                disabled={remove.isPending}
                onClick={() => {
                  remove.mutate(deleting.id);
                }}
              >
                {t("accounts.delete")}
              </Button>
            </>
          }
        >
          {remove.isError && (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(t, remove.error)}
            </p>
          )}
        </Dialog>
      )}
    </Dialog>
  );
}
