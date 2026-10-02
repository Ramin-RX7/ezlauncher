import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { RefreshCw, Trash2 } from "lucide-react";
import type {
  CleanupId,
  CleanupPlan,
  CleanupResult,
  StorageCategory,
} from "@shared/launcher";
import { Button } from "../components/ui/Button";
import { Checkbox } from "../components/ui/Checkbox";
import { Dialog } from "../components/ui/Dialog";
import { Progress } from "../components/ui/Progress";
import { invoke } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { formatSize } from "../lib/formatSize";
import { useIpcEvent } from "../lib/useIpcEvent";

/** Categories are coloured by group: game files, library, worlds, backups, the rest. */
const GROUP: Record<StorageCategory, string> = {
  versions: "bg-accent",
  libraries: "bg-accent",
  assets: "bg-accent",
  java: "bg-accent",
  mods: "bg-success",
  resourcePacks: "bg-success",
  shaders: "bg-success",
  dataPacks: "bg-success",
  worlds: "bg-warning",
  backups: "bg-danger",
  profiles: "bg-muted",
  launcher: "bg-muted",
  other: "bg-muted",
};

/** How much of the data folder each part takes, and clean-ups for what nothing uses. */
export function StoragePage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [counted, setCounted] = useState(0);
  useIpcEvent("storage:progress", ({ files }) => {
    setCounted(files);
  });
  const report = useQuery({
    queryKey: ["storage"],
    queryFn: () => invoke("storage:scan"),
    staleTime: Infinity,
    gcTime: 5 * 60_000,
  });
  const [chosen, setChosen] = useState<ReadonlySet<CleanupId>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<CleanupResult>();
  const clean = useMutation({
    mutationFn: (ids: CleanupId[]) => invoke("storage:clean", ids),
    onSuccess: (r) => {
      setResult(r);
      setChosen(new Set());
      setConfirming(false);
    },
    onSettled: () => {
      void queryClient.invalidateQueries();
    },
  });

  const data = report.data;
  const cleanups = data?.cleanups ?? [];
  const selected = cleanups.filter((c) => chosen.has(c.id));
  const selectedBytes = selected.reduce((n, c) => n + c.bytes, 0);
  const total = data?.totalBytes ?? 0;

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{t("storage.title")}</h1>
          <p className="text-sm text-muted">{t("storage.subtitle")}</p>
        </div>
        <Button
          disabled={report.isFetching || clean.isPending}
          onClick={() => {
            setResult(undefined);
            setCounted(0);
            void report.refetch();
          }}
        >
          <RefreshCw size={16} aria-hidden />
          {t("storage.rescan")}
        </Button>
      </div>

      {report.isFetching && (
        <div className="flex flex-col gap-2">
          <Progress label={t("storage.scanning")} />
          <p className="text-xs text-muted">
            {t("storage.counted", { count: counted })}
          </p>
        </div>
      )}
      {report.isError && (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(t, report.error)}
        </p>
      )}
      {result && (
        <div className="flex flex-col gap-1 text-sm" aria-live="polite">
          <p className="text-success">
            {t("storage.freed", { size: formatSize(t, result.freedBytes) })}
          </p>
          {result.failed.map((f) => (
            <p key={f.id} className="text-danger">
              {t("storage.failed", {
                name: t(`storage.cleanups.${f.id}.title`),
              })}{" "}
              {errorMessage(t, { code: f.code })}
            </p>
          ))}
        </div>
      )}

      {data && !report.isFetching && (
        <>
          <section className="flex flex-col gap-3 rounded-ezl border border-border bg-surface p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-medium">{t("storage.usage")}</h2>
              <span className="text-lg font-semibold">
                {formatSize(t, total)}
              </span>
            </div>
            <div
              className="flex h-3 w-full overflow-hidden rounded-full bg-surface-2"
              aria-hidden
            >
              {data.categories
                .filter((c) => c.bytes > 0)
                .map((c) => (
                  <span
                    key={c.id}
                    className={`${GROUP[c.id]} h-full border-e border-surface last:border-e-0`}
                    style={{
                      width: `${(c.bytes / Math.max(total, 1)) * 100}%`,
                    }}
                  />
                ))}
            </div>
            <ul className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              {data.categories.map((c) => (
                <li key={c.id} className="flex items-center gap-2">
                  <span
                    className={`size-2.5 shrink-0 rounded-full ${GROUP[c.id]}`}
                    aria-hidden
                  />
                  <span className="flex-1 truncate">
                    {t(`storage.categories.${c.id}`)}
                  </span>
                  <span className="text-muted">{formatSize(t, c.bytes)}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="font-medium">{t("storage.cleanUp")}</h2>
            {cleanups.map((c) => (
              <CleanupCard
                key={c.id}
                cleanup={c}
                checked={chosen.has(c.id)}
                disabled={clean.isPending}
                onChange={(on) => {
                  setChosen((s) => {
                    const next = new Set(s);
                    if (on) next.add(c.id);
                    else next.delete(c.id);
                    return next;
                  });
                }}
              />
            ))}
            <div className="flex justify-end">
              <Button
                variant="danger"
                disabled={selected.length === 0 || clean.isPending}
                onClick={() => {
                  setConfirming(true);
                }}
              >
                <Trash2 size={16} aria-hidden />
                {t("storage.cleanSelected", {
                  size: formatSize(t, selectedBytes),
                })}
              </Button>
            </div>
          </section>
        </>
      )}

      <Dialog
        open={confirming}
        onOpenChange={(open) => {
          if (!clean.isPending) setConfirming(open);
        }}
        title={t("storage.confirmTitle", {
          size: formatSize(t, selectedBytes),
        })}
        description={t("storage.confirmBody")}
        closeLabel={t("storage.cancel")}
        footer={
          <>
            <Button
              disabled={clean.isPending}
              onClick={() => {
                setConfirming(false);
              }}
            >
              {t("storage.cancel")}
            </Button>
            <Button
              variant="danger"
              disabled={clean.isPending}
              onClick={() => {
                clean.mutate(selected.map((c) => c.id));
              }}
            >
              {clean.isPending ? t("storage.cleaning") : t("storage.confirm")}
            </Button>
          </>
        }
      >
        <ul className="flex flex-col gap-1 text-sm">
          {selected.map((c) => (
            <li key={c.id} className="flex justify-between gap-3">
              <span>{t(`storage.cleanups.${c.id}.title`)}</span>
              <span className="text-muted">
                {t("storage.items", {
                  count: c.count,
                  size: formatSize(t, c.bytes),
                })}
              </span>
            </li>
          ))}
        </ul>
        {clean.isError && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {errorMessage(t, clean.error)}
          </p>
        )}
      </Dialog>
    </div>
  );
}

function CleanupCard({
  cleanup: c,
  checked,
  disabled,
  onChange,
}: {
  cleanup: CleanupPlan;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const note = c.reason
    ? t(`storage.reasons.${c.reason}`)
    : c.count === 0
      ? t("storage.nothing")
      : t("storage.items", { count: c.count, size: formatSize(t, c.bytes) });
  return (
    <article className="flex flex-col gap-2 rounded-ezl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <Checkbox
            checked={checked}
            disabled={disabled || !c.available}
            onChange={onChange}
          >
            <span className="font-medium">
              {t(`storage.cleanups.${c.id}.title`)}
            </span>
          </Checkbox>
          <p className="ms-6 text-xs text-muted">
            {t(`storage.cleanups.${c.id}.body`)}
          </p>
        </div>
        <span className={`text-sm ${c.reason ? "text-warning" : "text-muted"}`}>
          {note}
        </span>
      </div>
      {c.items.length > 0 && (
        <div className="ms-6">
          <button
            type="button"
            className="text-xs text-accent hover:underline"
            aria-expanded={open}
            onClick={() => {
              setOpen(!open);
            }}
          >
            {open ? t("storage.hideItems") : t("storage.showItems")}
          </button>
          {open && (
            <ul className="mt-2 flex max-h-56 flex-col gap-0.5 overflow-auto text-xs">
              {c.items.map((i) => (
                <li
                  key={i.label}
                  className="flex justify-between gap-3 border-b border-border py-0.5 last:border-b-0"
                >
                  <span className="truncate">{i.label}</span>
                  <span className="shrink-0 text-muted">
                    {formatSize(t, i.bytes)}
                  </span>
                </li>
              ))}
              {c.count > c.items.length && (
                <li className="text-muted">
                  {t("storage.more", { count: c.count - c.items.length })}
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </article>
  );
}
