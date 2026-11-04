import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { joinArgs } from "@shared/args";
import { useSettings } from "../../state/queries";
import { ArgsField } from "../settings/ArgsField";
import { Checkbox } from "../ui/Checkbox";
import { Input } from "../ui/Input";
import {
  MEMORY_MAX,
  MEMORY_MIN,
  type LaunchOverrides as Overrides,
} from "./useLaunchOverrides";

/** The memory, JVM arguments and game arguments fields, each with "Use global setting". */
export function LaunchOverrides({
  overrides,
  onChange,
}: {
  overrides: Overrides;
  /** Something changed (beyond the form's own input events). */
  onChange: () => void;
}) {
  const { t } = useTranslation();
  const settings = useSettings();
  const { state, set, memoryValid } = overrides;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{t("profiles.editor.memory")}</span>
        <Checkbox
          checked={state.globalMemory}
          onChange={(checked) => {
            set({
              globalMemory: checked,
              ...(!checked &&
                state.memory === "" && {
                  memory: String(settings.data?.memoryMaxMb ?? 2048),
                }),
            });
            onChange();
          }}
        >
          {t("profiles.editor.useGlobal")}{" "}
          <span className="text-muted">
            (
            {t("profiles.editor.globalMemory", {
              mb: settings.data?.memoryMaxMb ?? 2048,
            })}
            )
          </span>
        </Checkbox>
        {!state.globalMemory && (
          <>
            <Input
              type="number"
              inputMode="numeric"
              min={MEMORY_MIN}
              max={MEMORY_MAX}
              step={256}
              value={state.memory}
              aria-label={t("profiles.editor.memory")}
              aria-invalid={!memoryValid}
              aria-describedby="memory-hint"
              onChange={(e) => {
                set({ memory: e.target.value });
              }}
              className="w-40"
            />
            <span id="memory-hint" className="text-xs text-muted">
              {t("profiles.editor.memoryHint")}
            </span>
          </>
        )}
      </div>
      <Override
        label={t("profiles.editor.jvmArgs")}
        global={state.globalJvm}
        globalArgs={settings.data?.extraJvmArgs ?? []}
        onGlobal={(checked) => {
          set({
            globalJvm: checked,
            ...(!checked &&
              state.jvmArgs === "" && {
                jvmArgs: joinArgs(settings.data?.extraJvmArgs ?? []),
              }),
          });
          onChange();
        }}
      >
        <ArgsField
          label={t("profiles.editor.jvmArgs")}
          hint={t("profiles.editor.jvmArgsHint")}
          jvm
          text={state.jvmArgs}
          onText={(text) => {
            set({ jvmArgs: text });
            onChange();
          }}
        />
      </Override>
      <Override
        label={t("profiles.editor.gameArgs")}
        global={state.globalGame}
        globalArgs={settings.data?.extraGameArgs ?? []}
        onGlobal={(checked) => {
          set({
            globalGame: checked,
            ...(!checked &&
              state.gameArgs === "" && {
                gameArgs: joinArgs(settings.data?.extraGameArgs ?? []),
              }),
          });
          onChange();
        }}
      >
        <ArgsField
          label={t("profiles.editor.gameArgs")}
          hint={t("profiles.editor.gameArgsHint")}
          text={state.gameArgs}
          onText={(text) => {
            set({ gameArgs: text });
            onChange();
          }}
        />
      </Override>
    </div>
  );
}

/** "Use global setting" for a list of arguments; unticked shows the profile's own field. */
function Override({
  label,
  global,
  globalArgs,
  onGlobal,
  children,
}: {
  label: string;
  global: boolean;
  globalArgs: readonly string[];
  onGlobal: (checked: boolean) => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1 text-sm">
      {global && <span className="font-medium">{label}</span>}
      <Checkbox checked={global} onChange={onGlobal}>
        {t("profiles.editor.useGlobal")}{" "}
        <span className="text-muted">
          (
          {globalArgs.length > 0
            ? t("profiles.editor.globalArgs", { args: joinArgs(globalArgs) })
            : t("profiles.editor.globalNone")}
          )
        </span>
      </Checkbox>
      {!global && children}
    </div>
  );
}
