import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ToggleGroup } from "radix-ui";
import type { LauncherSettings, OnGameStart } from "@shared/launcher";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { RadioGroup } from "../components/ui/RadioGroup";
import { invoke } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { THEME_MODES, type ThemeMode } from "../theme/theme";
import { useTheme } from "../theme/useTheme";

const MEMORY_MIN = 512;
const MEMORY_MAX = 16384;
const MEMORY_STEP = 256;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-ezl border border-border bg-surface p-5">
      <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function SettingsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { mode, setMode } = useTheme();
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => invoke("settings:get"),
  });
  const setup = useQuery({
    queryKey: ["setup"],
    queryFn: () => invoke("setup:getState"),
  });
  const info = useQuery({
    queryKey: ["app", "info"],
    queryFn: () => invoke("app:getInfo"),
  });

  const update = useMutation({
    mutationFn: (patch: Partial<LauncherSettings>) =>
      invoke("settings:update", patch),
    onSuccess: (next) => {
      queryClient.setQueryData(["settings"], next);
    },
  });

  // Memory is edited locally and saved when the slider or field is released.
  const [memoryDraft, setMemory] = useState<number>();
  const memory = memoryDraft ?? settings.data?.memoryMaxMb;
  const saveMemory = () => {
    if (memoryDraft === undefined) return;
    const clamped = Math.min(
      MEMORY_MAX,
      Math.max(MEMORY_MIN, Math.round(memoryDraft)),
    );
    setMemory(undefined);
    if (clamped !== settings.data?.memoryMaxMb)
      update.mutate({ memoryMaxMb: clamped });
  };

  const changeDir = useMutation({
    mutationFn: async () => {
      const chosen = await invoke("setup:chooseFolder");
      if (chosen) await invoke("setup:setDataDir", chosen); // the app restarts
    },
  });

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("settings.title")}</h1>

      <Section title={t("settings.game")}>
        <div className="flex flex-col gap-2">
          <label htmlFor="memory" className="text-sm font-medium">
            {t("settings.memory.label")}
          </label>
          <div className="flex items-center gap-4">
            <input
              type="range"
              aria-label={t("settings.memory.label")}
              min={MEMORY_MIN}
              max={MEMORY_MAX}
              step={MEMORY_STEP}
              value={memory ?? MEMORY_MIN}
              onChange={(e) => {
                setMemory(Number(e.target.value));
              }}
              onPointerUp={saveMemory}
              onKeyUp={saveMemory}
              className="flex-1 accent-accent"
            />
            <div className="flex items-center gap-1">
              <Input
                id="memory"
                type="number"
                min={MEMORY_MIN}
                max={MEMORY_MAX}
                step={MEMORY_STEP}
                value={memory ?? ""}
                onChange={(e) => {
                  setMemory(Number(e.target.value));
                }}
                onBlur={saveMemory}
                className="w-24"
              />
              <span className="text-sm text-muted">MB</span>
            </div>
          </div>
          <p className="text-xs text-muted">{t("settings.memory.hint")}</p>
        </div>

        <div className="flex flex-col gap-2">
          <span id="on-start-label" className="text-sm font-medium">
            {t("settings.onGameStart.label")}
          </span>
          {settings.data && (
            <RadioGroup<OnGameStart>
              labelledBy="on-start-label"
              value={settings.data.onGameStart}
              onChange={(v) => {
                update.mutate({ onGameStart: v });
              }}
              options={(["keep", "minimize", "close"] as const).map((v) => ({
                value: v,
                label: t(`settings.onGameStart.${v}`),
              }))}
            />
          )}
        </div>
        {update.isError && (
          <p className="text-sm text-danger">{errorMessage(t, update.error)}</p>
        )}
      </Section>

      <Section title={t("settings.launcher")}>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">
            {t("settings.dataDir.label")}
          </span>
          <div className="flex items-center gap-2">
            <code
              dir="ltr"
              className="min-w-0 flex-1 truncate rounded-ezl border border-border bg-bg px-3 py-2 text-sm"
            >
              {setup.data?.dataDir}
            </code>
            <Button
              disabled={changeDir.isPending}
              onClick={() => {
                changeDir.mutate();
              }}
            >
              {t("settings.dataDir.change")}
            </Button>
          </div>
          <p className="text-xs text-muted">{t("settings.dataDir.hint")}</p>
        </div>

        <div className="flex items-center justify-between gap-4">
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
      </Section>

      <Section title={t("settings.about")}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-muted">{t("settings.version")}</dt>
          <dd>{info.data?.version}</dd>
          <dt className="text-muted">{t("settings.platform")}</dt>
          <dd>{info.data && `${info.data.platform}-${info.data.arch}`}</dd>
        </dl>
      </Section>
    </div>
  );
}
