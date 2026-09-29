import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight } from "lucide-react";
import { launcherStore, useLauncherState } from "../../state/launcherStore";

/** Collapsible live view of the game's output. Keeps following the end unless scrolled up. */
export function GameLog({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const lines = useLauncherState((s) => s.log);
  const ref = useRef<HTMLPreElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lines, open]);

  return (
    <section className="rounded-ezl border border-border bg-surface">
      <div className="flex items-center justify-between px-3 py-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex items-center gap-1 text-sm font-medium"
        >
          {open ? (
            <ChevronDown size={16} />
          ) : (
            <ChevronRight size={16} className="rtl:rotate-180" />
          )}
          {t("log.title")}
        </button>
        {open && lines.length > 0 && (
          <button
            type="button"
            onClick={() => {
              launcherStore.clearLog();
            }}
            className="text-xs text-muted hover:text-text"
          >
            {t("log.clear")}
          </button>
        )}
      </div>
      {open && (
        <pre
          ref={ref}
          dir="ltr"
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          }}
          className="h-56 overflow-auto border-t border-border bg-bg p-3 font-mono text-xs leading-relaxed text-muted"
        >
          {lines.length === 0 ? t("log.empty") : lines.join("\n")}
        </pre>
      )}
    </section>
  );
}
