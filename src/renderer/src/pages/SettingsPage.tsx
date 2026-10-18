import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ToggleGroup } from "radix-ui";
import { TriangleAlert } from "lucide-react";
import { joinArgs, splitArgs } from "@shared/args";
import type { LauncherSettings, OnGameStart } from "@shared/launcher";
import { ArgsField } from "../components/settings/ArgsField";
import { BackupSettings } from "../components/settings/BackupSettings";
import { DataDirChange } from "../components/settings/DataDirChange";
import { JavaSettings } from "../components/settings/JavaSettings";
import { UpdateSettings } from "../components/settings/UpdateSettings";
import { CopyDiagnostics } from "../components/settings/CopyDiagnostics";
import { Checkbox } from "../components/ui/Checkbox";
import { Input } from "../components/ui/Input";
import { RadioGroup } from "../components/ui/RadioGroup";
import { invoke } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { keys } from "../state/queries";
import { THEME_MODES, type ThemeMode } from "../theme/theme";
import { useTheme } from "../theme/useTheme";

const MEMORY_MIN = 512;
const MEMORY_LIMIT = 65536;
const MEMORY_STEP = 256;
/** Warn when the game may take more than this share of the computer's memory. */
const MEMORY_WARN_SHARE = 0.75;

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

type ArgsKey = "extraJvmArgs" | "extraGameArgs";

export function SettingsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { mode, setMode } = useTheme();
  const settings = useQuery({
    queryKey: keys.settings,
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
      queryClient.setQueryData(keys.settings, next);
    },
  });

  // The slider goes up to the computer's memory.
  const totalMb = info.data?.totalMemoryMb;
  const memoryMax = totalMb
    ? Math.max(
        MEMORY_MIN * 2,
        Math.min(MEMORY_LIMIT, Math.floor(totalMb / MEMORY_STEP) * MEMORY_STEP),
      )
    : 16384;

  // Memory is edited locally and saved when the slider or field is released.
  const [memoryDraft, setMemory] = useState<number>();
  const memory = memoryDraft ?? settings.data?.memoryMaxMb;
  const saveMemory = () => {
    if (memoryDraft === undefined) return;
    const clamped = Math.min(
      MEMORY_LIMIT,
      Math.max(MEMORY_MIN, Math.round(memoryDraft)),
    );
    setMemory(undefined);
    if (clamped !== settings.data?.memoryMaxMb)
      update.mutate({ memoryMaxMb: clamped });
  };
  const tooMuch =
    totalMb !== undefined &&
    memory !== undefined &&
    memory > totalMb * MEMORY_WARN_SHARE;

  // Argument fields are text; they're saved as arrays when the field is left.
  const [argsDraft, setArgsDraft] = useState<Partial<Record<ArgsKey, string>>>(
    {},
  );
  const argsText = (key: ArgsKey) =>
    argsDraft[key] ?? joinArgs(settings.data?.[key] ?? []);
  const saveArgs = (key: ArgsKey) => {
    const text = argsDraft[key];
    if (text === undefined) return;
    const split = splitArgs(text);
    if ("error" in split) return; // shown on the field; kept as typed
    setArgsDraft((d) =>
      Object.fromEntries(Object.entries(d).filter(([k]) => k !== key)),
    );
    if (joinArgs(split.args) !== joinArgs(settings.data?.[key] ?? []))
      update.mutate({ [key]: split.args });
  };

  const toggles = [
    ["showSnapshots", "snapshots"],
    ["showOldBeta", "oldBeta"],
    ["showOldAlpha", "oldAlpha"],
  ] as const;

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
              max={memoryMax}
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
                max={MEMORY_LIMIT}
                step={MEMORY_STEP}
                value={memory ?? ""}
                onChange={(e) => {
                  setMemory(Number(e.target.value));
                }}
                onBlur={saveMemory}
                className="w-24"
              />
              <span className="text-sm text-muted">
                {t("settings.memory.mb")}
              </span>
            </div>
          </div>
          <p className="text-xs text-muted">
            {t("settings.memory.hint")}
            {totalMb !== undefined &&
              ` ${t("settings.memory.total", { mb: totalMb })}`}
          </p>
          {tooMuch && (
            <p className="flex items-center gap-2 text-xs text-warning">
              <TriangleAlert size={14} aria-hidden />
              {t("settings.memory.tooMuch")}
            </p>
          )}
        </div>

        <ArgsField
          label={t("settings.args.jvm")}
          hint={t("settings.args.jvmHint")}
          jvm
          text={argsText("extraJvmArgs")}
          onText={(text) => {
            setArgsDraft((d) => ({ ...d, extraJvmArgs: text }));
          }}
          onBlur={() => {
            saveArgs("extraJvmArgs");
          }}
        />
        <ArgsField
          label={t("settings.args.game")}
          hint={t("settings.args.gameHint")}
          text={argsText("extraGameArgs")}
          onText={(text) => {
            setArgsDraft((d) => ({ ...d, extraGameArgs: text }));
          }}
          onBlur={() => {
            saveArgs("extraGameArgs");
          }}
        />
        {update.isError && (
          <p className="text-sm text-danger">{errorMessage(t, update.error)}</p>
        )}
      </Section>

      <Section title={t("settings.backups.title")}>
        {settings.data && (
          <BackupSettings
            settings={settings.data}
            onChange={(patch) => {
              update.mutate(patch);
            }}
          />
        )}
      </Section>

      <Section title={t("settings.java.title")}>
        <JavaSettings />
      </Section>

      <Section title={t("settings.versionList.title")}>
        <div className="flex flex-col gap-2">
          {toggles.map(([key, label]) => (
            <Checkbox
              key={key}
              checked={settings.data?.[key] ?? false}
              onChange={(checked) => {
                update.mutate({ [key]: checked });
              }}
            >
              {t(`settings.versionList.${label}`)}
            </Checkbox>
          ))}
          <p className="text-xs text-muted">{t("settings.versionList.hint")}</p>
        </div>
      </Section>

      <Section title={t("settings.launcher")}>
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
            <DataDirChange current={setup.data?.dataDir ?? undefined} />
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
        <UpdateSettings />
        <CopyDiagnostics />
      </Section>
    </div>
  );
}
