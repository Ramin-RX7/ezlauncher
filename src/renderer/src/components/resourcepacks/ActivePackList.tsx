import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, Boxes, GripVertical, X } from "lucide-react";
import type { ActivePack } from "@shared/launcher";
import { SourceBadge } from "../mods/SourceBadge";
import { Button } from "../ui/Button";
import { StoreIcon } from "../ui/StoreIcon";
import { PackIcon } from "./PackIcon";
import { compatTone, packKey, rowName, rowRef } from "./packText";

/**
 * The active packs, highest priority first: drag a row by its handle (mouse, touch
 * or keyboard), or use its up and down buttons. Built-in packs can be moved but not
 * turned off here.
 */
export function ActivePackList({
  rows,
  profileId,
  disabled,
  onChange,
  onTurnOff,
}: {
  rows: readonly ActivePack[];
  profileId: string;
  disabled: boolean;
  onChange: (rows: ActivePack[]) => void;
  onTurnOff: (row: ActivePack) => void;
}) {
  const { t } = useTranslation();
  const [moved, setMoved] = useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const ids = rows.map((r) => packKey(rowRef(r)));
  const nameOf = (id: UniqueIdentifier) => {
    const row = rows[ids.indexOf(String(id))];
    return row ? rowName(t, row) : String(id);
  };
  const place = (id: UniqueIdentifier | undefined) =>
    id === undefined ? 0 : ids.indexOf(String(id)) + 1;
  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      t("resourcePacks.dnd.pickedUp", { name: nameOf(active.id) }),
    onDragOver: ({ active, over }) =>
      t("resourcePacks.dnd.over", {
        name: nameOf(active.id),
        position: place(over?.id),
        count: rows.length,
      }),
    onDragEnd: ({ active, over }) =>
      t("resourcePacks.dnd.dropped", {
        name: nameOf(active.id),
        position: place(over?.id),
        count: rows.length,
      }),
    onDragCancel: ({ active }) =>
      t("resourcePacks.dnd.cancelled", { name: nameOf(active.id) }),
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= rows.length || from === to) return;
    const row = rows[from];
    onChange(arrayMove([...rows], from, to));
    if (row)
      setMoved(
        t("resourcePacks.moved", {
          name: rowName(t, row),
          position: to + 1,
          count: rows.length,
        }),
      );
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable: t("resourcePacks.dnd.instructions"),
        },
      }}
      onDragEnd={({ active, over }) => {
        if (!over || active.id === over.id) return;
        move(ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ol className="rounded-ezl border border-border bg-surface">
          {rows.map((row, index) => (
            <SortableRow
              key={ids[index]}
              id={ids[index] ?? ""}
              row={row}
              index={index}
              count={rows.length}
              profileId={profileId}
              disabled={disabled}
              onMove={move}
              onTurnOff={onTurnOff}
            />
          ))}
        </ol>
      </SortableContext>
      <p className="sr-only" aria-live="polite">
        {moved}
      </p>
    </DndContext>
  );
}

function SortableRow({
  id,
  row,
  index,
  count,
  profileId,
  disabled,
  onMove,
  onTurnOff,
}: {
  id: string;
  row: ActivePack;
  index: number;
  count: number;
  profileId: string;
  disabled: boolean;
  onMove: (from: number, to: number) => void;
  onTurnOff: (row: ActivePack) => void;
}) {
  const { t } = useTranslation();
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });
  const name = rowName(t, row);
  const pack = row.kind === "pack" ? row.pack : undefined;
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-3 border-b border-border bg-surface px-3 py-2 last:border-b-0 ${isDragging ? "relative z-10 shadow-lg" : ""}`}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        className="cursor-grab touch-none rounded-ezl p-1 text-muted hover:text-text disabled:cursor-default disabled:opacity-50"
        aria-label={t("resourcePacks.drag", { name })}
        disabled={disabled}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={16} aria-hidden />
      </button>
      {pack ? (
        <PackIcon
          packRef={pack.ref}
          hasIcon={pack.hasIcon}
          profileId={profileId}
        />
      ) : (
        <StoreIcon src={null} fallback={Boxes} />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-2">
          <span className="truncate font-medium">{name}</span>
          {!pack && (
            <span className="rounded-ezl border border-border px-2 py-0.5 text-xs text-muted">
              {t("resourcePacks.builtinBadge")}
            </span>
          )}
          {pack?.ref.kind === "folder" && (
            <span
              className="rounded-ezl border border-border px-2 py-0.5 text-xs text-muted"
              title={t("resourcePacks.folderHint")}
            >
              {t("resourcePacks.folder")}
            </span>
          )}
          {pack?.source && (
            <SourceBadge
              sourceId={pack.source.sourceId}
              pageUrl={pack.source.pageUrl}
              modName={pack.name}
            />
          )}
        </span>
        {pack?.description && (
          <span className="truncate text-xs text-muted">
            {pack.description}
          </span>
        )}
      </div>
      {pack && pack.compat !== "compatible" && (
        <span className={`shrink-0 text-xs ${compatTone(pack.compat)}`}>
          {t(`resourcePacks.compat.${pack.compat}`)}
        </span>
      )}
      <div className="flex shrink-0 items-center">
        <Button
          variant="ghost"
          className="h-8 px-2"
          aria-label={t("resourcePacks.moveUp", { name })}
          disabled={disabled || index === 0}
          onClick={() => {
            onMove(index, index - 1);
          }}
        >
          <ArrowUp size={16} aria-hidden />
        </Button>
        <Button
          variant="ghost"
          className="h-8 px-2"
          aria-label={t("resourcePacks.moveDown", { name })}
          disabled={disabled || index === count - 1}
          onClick={() => {
            onMove(index, index + 1);
          }}
        >
          <ArrowDown size={16} aria-hidden />
        </Button>
        {pack && (
          <Button
            variant="ghost"
            className="h-8 px-2"
            aria-label={t("resourcePacks.turnOff", { name })}
            disabled={disabled}
            onClick={() => {
              onTurnOff(row);
            }}
          >
            <X size={16} aria-hidden />
          </Button>
        )}
      </div>
    </li>
  );
}
