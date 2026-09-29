import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { OrphanWorld } from "@shared/launcher";
import { invoke } from "../../lib/api";
import { keys } from "../../state/queries";
import { Button } from "../ui/Button";
import { MoveWorldDialog } from "./WorldsTab";

/** Worlds whose profile is gone. Shown only when there are any; never deleted automatically. */
export function OrphanWorlds() {
  const { t } = useTranslation();
  const orphans = useQuery({
    queryKey: keys.orphans,
    queryFn: () => invoke("worlds:orphans"),
  });
  const [assigning, setAssigning] = useState<OrphanWorld>();
  const list = orphans.data ?? [];
  if (list.length === 0) return null;

  return (
    <section className="flex flex-col gap-2 rounded-ezl border border-warning/40 bg-surface p-4">
      <h2 className="text-sm font-semibold">{t("worlds.unassignedTitle")}</h2>
      <p className="text-xs text-muted">{t("worlds.unassignedBody")}</p>
      <ul className="flex flex-col gap-1">
        {list.map((w) => (
          <li key={w.id} className="flex items-center justify-between gap-3">
            <span className="truncate text-sm">{w.name}</span>
            <Button
              variant="secondary"
              onClick={() => {
                setAssigning(w);
              }}
            >
              {t("worlds.assign")}
            </Button>
          </li>
        ))}
      </ul>
      {assigning && (
        <MoveWorldDialog
          world={assigning}
          onClose={() => {
            setAssigning(undefined);
          }}
        />
      )}
    </section>
  );
}
