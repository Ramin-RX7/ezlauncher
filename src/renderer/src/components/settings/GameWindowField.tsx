import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { GameWindow } from "@shared/launcher";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import { DEFAULT_WINDOW_SIZE, isValidGameWindow } from "./gameWindow";

type Mode = GameWindow["mode"];

/** A typed size; an empty field stays empty (NaN), not 0. */
const toNumber = (text: string) =>
  text.trim() === "" ? Number.NaN : Math.round(Number(text));

/**
 * How the game's window opens: as the game remembers it, at a size, or fullscreen.
 * Reports every change, also sizes still being typed; `isValidGameWindow` says
 * whether one can be saved.
 */
export function GameWindowField({
  value,
  onChange,
  label,
}: {
  value: GameWindow;
  onChange: (next: GameWindow) => void;
  /** Shown above the choice; left out when the caller labels it. */
  label?: string;
}) {
  const { t } = useTranslation();
  const hintId = useId();
  const valid = isValidGameWindow(value);
  const size = value.mode === "size" ? value : undefined;
  const setSize = (patch: Partial<{ width: number; height: number }>) => {
    if (size) onChange({ ...size, ...patch });
  };

  return (
    <div className="flex flex-col gap-2 text-sm">
      {label && <span className="font-medium">{label}</span>}
      <div className="flex flex-wrap items-center gap-2">
        <Select<Mode>
          aria-label={t("settings.window.label")}
          value={value.mode}
          className="w-56"
          onChange={(mode) => {
            onChange(
              mode === "size" ? { mode, ...DEFAULT_WINDOW_SIZE } : { mode },
            );
          }}
          options={[
            { value: "default", label: t("settings.window.default") },
            { value: "size", label: t("settings.window.size") },
            { value: "fullscreen", label: t("settings.window.fullscreen") },
          ]}
        />
        {size && (
          <>
            <Input
              type="number"
              inputMode="numeric"
              aria-label={t("settings.window.width")}
              aria-invalid={!valid}
              aria-describedby={hintId}
              value={Number.isNaN(size.width) ? "" : size.width}
              onChange={(e) => {
                setSize({ width: toNumber(e.target.value) });
              }}
              className="w-24"
            />
            <span className="text-muted" aria-hidden>
              ×
            </span>
            <Input
              type="number"
              inputMode="numeric"
              aria-label={t("settings.window.height")}
              aria-invalid={!valid}
              aria-describedby={hintId}
              value={Number.isNaN(size.height) ? "" : size.height}
              onChange={(e) => {
                setSize({ height: toNumber(e.target.value) });
              }}
              className="w-24"
            />
          </>
        )}
      </div>
      <span
        id={hintId}
        className={`text-xs ${valid ? "text-muted" : "text-danger"}`}
      >
        {valid ? t("settings.window.hint") : t("settings.window.invalid")}
      </span>
    </div>
  );
}
