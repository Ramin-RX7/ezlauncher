import { useState, type DragEvent, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { pathForFile } from "../../lib/api";
import { Button } from "./Button";

const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes("Files");

/**
 * An area that takes dropped files whose names match `accept`, with an add button
 * (the file picker runs in the main process). Drags that aren't files (e.g. reordering
 * a list inside it) are ignored.
 */
export function FileDropZone({
  accept,
  onAdd,
  pending,
  addLabel,
  dropHint,
  actions,
  status,
  children,
}: {
  accept: RegExp;
  /** Dropped files' paths, or "picker" for the add button. */
  onAdd: (paths: string[] | "picker") => void;
  pending: boolean;
  addLabel: string;
  dropHint: string;
  /** More buttons, shown before the add button. */
  actions?: ReactNode;
  /** What the last add did, under the buttons. */
  status?: ReactNode;
  children: ReactNode;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      className={`flex min-h-0 flex-1 flex-col gap-3 rounded-ezl ${over ? "outline-2 outline-accent outline-dashed" : ""}`}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setOver(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setOver(false);
        const paths = [...e.dataTransfer.files]
          .filter((f) => accept.test(f.name))
          .map(pathForFile)
          .filter(Boolean);
        if (paths.length > 0) onAdd(paths);
      }}
    >
      <div className="flex flex-wrap items-center gap-3">
        {actions}
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() => {
            onAdd("picker");
          }}
        >
          <Plus size={16} aria-hidden />
          {addLabel}
        </Button>
        <span className="text-xs text-muted">{dropHint}</span>
      </div>
      {status}
      {children}
    </div>
  );
}
