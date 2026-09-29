import { useId } from "react";
import { useTranslation } from "react-i18next";
import { setsMemory, splitArgs } from "@shared/args";
import { Input } from "../ui/Input";

/**
 * One line of extra arguments, split like a shell would (quotes, escapes) but never
 * run through one. Shows an unclosed quote as an error, and for JVM arguments warns
 * about memory flags.
 */
export function ArgsField({
  label,
  hint,
  text,
  onText,
  onBlur,
  jvm = false,
  disabled = false,
}: {
  label: string;
  hint: string;
  text: string;
  onText: (text: string) => void;
  onBlur?: () => void;
  /** JVM arguments: warn about -Xmx / -Xms. */
  jvm?: boolean;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  const split = splitArgs(text);
  const error = "error" in split;
  const memoryFlags = jvm && !error && setsMemory(split.args);
  return (
    <div className="flex min-w-72 flex-1 flex-col gap-1 text-sm">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <Input
        id={id}
        value={text}
        spellCheck={false}
        dir="ltr"
        disabled={disabled}
        aria-invalid={error}
        aria-describedby={`${id}-hint`}
        onChange={(e) => {
          onText(e.target.value);
        }}
        {...(onBlur && { onBlur })}
        className="font-mono text-xs"
      />
      <span
        id={`${id}-hint`}
        className={`text-xs ${error ? "text-danger" : memoryFlags ? "text-warning" : "text-muted"}`}
      >
        {error
          ? t("settings.args.unclosedQuote")
          : memoryFlags
            ? t("settings.args.memoryFlags")
            : hint}
      </span>
    </div>
  );
}
