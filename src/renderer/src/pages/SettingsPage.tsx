import { useTranslation } from "react-i18next";
import { ToggleGroup } from "radix-ui";
import { useTheme } from "../theme/useTheme";
import { THEME_MODES, type ThemeMode } from "../theme/theme";

export function SettingsPage() {
  const { t } = useTranslation();
  const { mode, setMode } = useTheme();

  return (
    <section className="max-w-2xl">
      <h1 className="text-2xl font-semibold">{t("settings.title")}</h1>

      <div className="mt-8 flex items-center justify-between gap-4 rounded-ezl border border-border bg-surface p-4">
        <span id="theme-label" className="text-sm font-medium">
          {t("settings.theme.label")}
        </span>
        <ToggleGroup.Root
          type="single"
          value={mode}
          onValueChange={(value) => {
            if (value) setMode(value as ThemeMode);
          }}
          aria-labelledby="theme-label"
          className="inline-flex rounded-ezl border border-border bg-surface-2 p-1"
        >
          {THEME_MODES.map((m) => (
            <ToggleGroup.Item
              key={m}
              value={m}
              className="rounded-ezl px-3 py-1 text-sm text-muted data-[state=on]:bg-surface data-[state=on]:text-text"
            >
              {t(`settings.theme.${m}`)}
            </ToggleGroup.Item>
          ))}
        </ToggleGroup.Root>
      </div>
    </section>
  );
}
