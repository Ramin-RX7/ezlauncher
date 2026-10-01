import { useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { PackLibraryTab } from "../components/resourcepacks/PackLibraryTab";
import { TabBar } from "../components/ui/Tabs";
import { ModLibraryPage } from "./ModLibraryPage";

type Tab = "mods" | "resourcePacks";
const TABS: readonly Tab[] = ["mods", "resourcePacks"];

/** The shared libraries: mods and resource packs, each stored once for every profile. */
export function LibraryPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tab: Tab =
    params.get("tab") === "resourcePacks" ? "resourcePacks" : "mods";
  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <TabBar
        label={t("library.label")}
        items={TABS.map((value) => ({
          value,
          label: t(`library.tabs.${value}`),
        }))}
        value={tab}
        onChange={(value) => {
          setParams(value === "mods" ? {} : { tab: value }, { replace: true });
        }}
      />
      <div className="flex min-h-0 flex-1 flex-col">
        {tab === "mods" ? <ModLibraryPage /> : <PackLibraryTab />}
      </div>
    </div>
  );
}
