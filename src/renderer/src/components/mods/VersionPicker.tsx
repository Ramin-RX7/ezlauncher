import { useTranslation } from "react-i18next";
import type { LibraryMod } from "@shared/launcher";
import { Select } from "../ui/Select";

/** Pick which version of a mod the row is about. */
export function VersionPicker({
  versions,
  value,
  name,
  disabled,
  onChange,
}: {
  versions: readonly LibraryMod[];
  value: string;
  name: string;
  disabled: boolean;
  onChange: (sha1: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Select
      aria-label={t("mods.pickVersion", { name })}
      className="w-44 shrink-0"
      value={value}
      disabled={disabled}
      options={versions.map((v) => {
        const version = v.version ?? v.fileName;
        const label = v.enabled
          ? t("mods.versionOptionEnabled", { version })
          : v.compat?.status === "incompatible"
            ? t("mods.versionOptionIncompatible", { version })
            : t("mods.versionOption", { version });
        return {
          value: v.sha1,
          label,
          disabled: v.compat?.status === "incompatible" && !v.enabled,
        };
      })}
      onChange={onChange}
    />
  );
}
