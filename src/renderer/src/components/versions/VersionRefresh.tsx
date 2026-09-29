import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import type { LoaderInfo, VersionListResult } from "@shared/launcher";
import { invoke } from "../../lib/api";
import { keys, useVersionList } from "../../state/queries";
import { Button } from "../ui/Button";

/** "Version list from <date>" and Check for new versions (Mojang and the loader servers). */
export function VersionRefresh() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const list = useVersionList();
  const [notice, setNotice] = useState<string>();

  const refresh = useMutation({
    mutationFn: async () => {
      const [result, loaders] = await Promise.all([
        invoke("versions:list", { refresh: true }),
        invoke("loaders:list", { refresh: true }),
      ]);
      queryClient.setQueryData<LoaderInfo[]>(keys.loaders, loaders);
      return result;
    },
    onSuccess: (result) => {
      const before = new Set(list.data?.versions.map((v) => v.id));
      queryClient.setQueryData<VersionListResult>(keys.versions, result);
      if (result.refreshError) {
        setNotice(
          result.refreshError === "OFFLINE"
            ? t("versions.offlineRefresh")
            : t("versions.refreshFailed"),
        );
        return;
      }
      const added =
        before.size === 0
          ? 0
          : result.versions.filter((v) => !before.has(v.id)).length;
      setNotice(
        added > 0
          ? t("versions.newFound", { count: added })
          : t("versions.upToDate"),
      );
    },
  });

  const fetchedAt = list.data?.fetchedAt
    ? new Intl.DateTimeFormat(i18n.language, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(list.data.fetchedAt))
    : undefined;
  const noList =
    list.data?.source === "none" && list.data.versions.length === 0;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted" aria-live="polite">
        {notice ??
          (noList
            ? t("versions.noList")
            : fetchedAt && t("versions.listFrom", { date: fetchedAt }))}
      </p>
      <Button
        variant="secondary"
        disabled={refresh.isPending || list.isPending}
        onClick={() => {
          setNotice(undefined);
          refresh.mutate();
        }}
      >
        <RefreshCw
          size={16}
          className={refresh.isPending ? "animate-spin" : ""}
          aria-hidden
        />
        {refresh.isPending
          ? t("versions.checking")
          : noList
            ? t("versions.tryAgain")
            : t("versions.check")}
      </Button>
    </div>
  );
}
