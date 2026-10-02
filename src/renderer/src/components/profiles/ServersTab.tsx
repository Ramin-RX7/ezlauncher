import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ArrowDown,
  ArrowUp,
  LogIn,
  Pencil,
  Plus,
  Server,
  Trash2,
} from "lucide-react";
import type { ProfileInfo, SavedServerList } from "@shared/launcher";
import { parseServerAddress } from "@shared/serverAddress";
import { invoke } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Input } from "../ui/Input";
import { EditServerDialog, type ServerFields } from "./EditServerDialog";

type Server = SavedServerList["servers"][number];
type Edit = ServerFields & { key?: number };

/**
 * Join a server straight from the launcher, and edit the game's own server list
 * (its Multiplayer screen): add, change, remove, reorder. Nothing changes while
 * the profile plays (the game rewrites the list).
 */
export function ServersTab({
  profile,
  onJoin,
}: {
  profile: ProfileInfo;
  /** Start the profile onto this server (from the page's Play bar). */
  onJoin: (address: string, name: string) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: ["profiles", "servers", profile.id],
    queryFn: () => invoke("servers:list", profile.id),
  });
  const [address, setAddress] = useState("");
  const [editing, setEditing] = useState<Partial<Edit>>();
  const [removing, setRemoving] = useState<Server>();
  const typed = parseServerAddress(address);
  const servers = list.data?.servers ?? [];
  const locked = profile.running > 0 || list.data?.locked === true;

  const save = useMutation({
    mutationFn: (next: Edit[]) =>
      invoke("servers:save", {
        profileId: profile.id,
        servers: next.map(({ key, name, address: a, resourcePacks }) => ({
          ...(key !== undefined && { key }),
          name,
          address: a,
          resourcePacks,
        })),
      }),
    onSuccess: () => {
      setEditing(undefined);
      setRemoving(undefined);
    },
    onSettled: () => {
      // Keys change after a save: always read the list again.
      void queryClient.invalidateQueries({ queryKey: ["profiles"] });
    },
  });
  const current = (): Edit[] =>
    servers.map(({ key, name, address: a, resourcePacks }) => ({
      key,
      name,
      address: a,
      resourcePacks,
    }));
  const move = (index: number, by: number) => {
    const next = current();
    const [item] = next.splice(index, 1);
    if (!item) return;
    next.splice(index + by, 0, item);
    save.mutate(next);
  };

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (typed) onJoin(address.trim(), address.trim());
        }}
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">{t("servers.address")}</span>
          <Input
            value={address}
            placeholder="play.example.com:25565"
            aria-invalid={address.trim() !== "" && !typed}
            onChange={(e) => {
              setAddress(e.target.value);
            }}
            className="w-72"
          />
        </label>
        <Button type="submit" variant="primary" disabled={!typed}>
          <LogIn size={16} aria-hidden />
          {t("servers.join")}
        </Button>
        <Button
          disabled={!typed || locked}
          onClick={() => {
            setEditing({ address: address.trim() });
          }}
        >
          {t("servers.addToList")}
        </Button>
        {address.trim() !== "" && !typed && (
          <span className="text-xs text-danger">{t("servers.badAddress")}</span>
        )}
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium">{t("servers.listTitle")}</h2>
        <Button
          disabled={locked}
          onClick={() => {
            setEditing({});
          }}
        >
          <Plus size={16} aria-hidden />
          {t("servers.add")}
        </Button>
      </div>
      {locked && <p className="text-xs text-warning">{t("servers.locked")}</p>}
      {list.isError && (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(t, list.error)}
        </p>
      )}
      {save.isError && editing === undefined && removing === undefined && (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(t, save.error)}
        </p>
      )}
      {list.isSuccess &&
        (servers.length === 0 ? (
          <p className="rounded-ezl border border-border bg-surface p-6 text-center text-sm text-muted">
            {t("servers.empty")}
          </p>
        ) : (
          <ul className="overflow-hidden rounded-ezl border border-border bg-surface">
            {servers.map((s, i) => (
              <li
                key={`${String(s.key)}-${s.address}`}
                className="flex items-center gap-3 border-b border-border px-3 py-3 last:border-b-0"
              >
                <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-ezl bg-surface-2">
                  {s.icon ? (
                    <img
                      src={s.icon}
                      alt=""
                      className="size-full [image-rendering:pixelated]"
                    />
                  ) : (
                    <Server size={16} className="text-muted" aria-hidden />
                  )}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{s.name}</span>
                  <span className="truncate text-xs text-muted">
                    {s.address}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    className="h-8 px-2"
                    disabled={locked || save.isPending || i === 0}
                    aria-label={t("servers.moveUp", { name: s.name })}
                    onClick={() => {
                      move(i, -1);
                    }}
                  >
                    <ArrowUp size={16} aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    className="h-8 px-2"
                    disabled={
                      locked || save.isPending || i === servers.length - 1
                    }
                    aria-label={t("servers.moveDown", { name: s.name })}
                    onClick={() => {
                      move(i, 1);
                    }}
                  >
                    <ArrowDown size={16} aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    className="h-8 px-2"
                    disabled={locked}
                    aria-label={t("servers.editLabel", { name: s.name })}
                    onClick={() => {
                      setEditing(s);
                    }}
                  >
                    <Pencil size={16} aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    className="h-8 px-2 text-danger"
                    disabled={locked}
                    aria-label={t("servers.removeLabel", { name: s.name })}
                    onClick={() => {
                      setRemoving(s);
                    }}
                  >
                    <Trash2 size={16} aria-hidden />
                  </Button>
                  <Button
                    variant="primary"
                    disabled={!parseServerAddress(s.address)}
                    aria-label={t("servers.joinLabel", { name: s.name })}
                    onClick={() => {
                      onJoin(s.address, s.name);
                    }}
                  >
                    <LogIn size={16} aria-hidden />
                    {t("servers.join")}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        ))}
      <p className="text-xs text-muted">{t("servers.hint")}</p>

      {editing && (
        <EditServerDialog
          server={editing}
          pending={save.isPending}
          {...(save.isError && { error: errorMessage(t, save.error) })}
          onClose={() => {
            save.reset();
            setEditing(undefined);
          }}
          onSave={(fields) => {
            const next = current();
            const key = editing.key;
            if (key === undefined) next.push(fields);
            else {
              const at = next.findIndex((x) => x.key === key);
              if (at >= 0) next[at] = { ...fields, key };
            }
            save.mutate(next);
          }}
        />
      )}
      {removing && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !save.isPending) setRemoving(undefined);
          }}
          title={t("servers.removeTitle", { name: removing.name })}
          description={t("servers.removeBody")}
          closeLabel={t("servers.cancel")}
          footer={
            <>
              <Button
                disabled={save.isPending}
                onClick={() => {
                  setRemoving(undefined);
                }}
              >
                {t("servers.cancel")}
              </Button>
              <Button
                variant="danger"
                disabled={save.isPending}
                onClick={() => {
                  save.mutate(current().filter((x) => x.key !== removing.key));
                }}
              >
                {t("servers.remove")}
              </Button>
            </>
          }
        />
      )}
    </div>
  );
}
