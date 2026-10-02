import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { SavedServerList } from "@shared/launcher";
import { parseServerAddress } from "@shared/serverAddress";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";

type Server = SavedServerList["servers"][number];
export type ServerFields = Pick<Server, "name" | "address" | "resourcePacks">;

const NAME_MAX = 128;

/** Add a server to the game's list, or change one: name, address, resource packs. */
export function EditServerDialog({
  server,
  pending,
  error,
  onSave,
  onClose,
}: {
  /** Missing = a new server (these are its first values, if any). */
  server?: Partial<ServerFields> & { key?: number };
  pending: boolean;
  error?: string;
  onSave: (fields: ServerFields) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(server?.name ?? "");
  const [address, setAddress] = useState(server?.address ?? "");
  const [resourcePacks, setResourcePacks] = useState<
    ServerFields["resourcePacks"]
  >(server?.resourcePacks ?? "prompt");
  const valid =
    name.trim().length > 0 &&
    name.trim().length <= NAME_MAX &&
    parseServerAddress(address) !== null;
  const editing = server?.key !== undefined;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
      title={editing ? t("servers.editTitle") : t("servers.addTitle")}
      closeLabel={t("servers.cancel")}
      footer={
        <>
          <Button disabled={pending} onClick={onClose}>
            {t("servers.cancel")}
          </Button>
          <Button
            variant="primary"
            disabled={!valid || pending}
            onClick={() => {
              onSave({
                name: name.trim(),
                address: address.trim(),
                resourcePacks,
              });
            }}
          >
            {t("servers.save")}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && !pending)
            onSave({
              name: name.trim(),
              address: address.trim(),
              resourcePacks,
            });
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-muted">{t("servers.name")}</span>
          <Input
            autoFocus
            value={name}
            maxLength={NAME_MAX}
            placeholder={t("servers.namePlaceholder")}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted">{t("servers.address")}</span>
          <Input
            value={address}
            placeholder="play.example.com:25565"
            aria-invalid={address.trim() !== "" && !parseServerAddress(address)}
            onChange={(e) => {
              setAddress(e.target.value);
            }}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted">{t("servers.resourcePacks")}</span>
          <Select
            aria-label={t("servers.resourcePacks")}
            value={resourcePacks}
            onChange={setResourcePacks}
            options={[
              { value: "prompt", label: t("servers.packs.prompt") },
              { value: "enabled", label: t("servers.packs.enabled") },
              { value: "disabled", label: t("servers.packs.disabled") },
            ]}
          />
        </label>
        {/* Submitting with Enter. */}
        <button type="submit" hidden />
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
