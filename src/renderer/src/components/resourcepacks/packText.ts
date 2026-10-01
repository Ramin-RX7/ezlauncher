import type { TFunction } from "i18next";
import type {
  ActivePack,
  ActivePackRef,
  PackCompat,
  PackRef,
} from "@shared/launcher";

const BUILTIN = [
  "vanilla",
  "programmer_art",
  "high_contrast",
  "fabric",
] as const;
type KnownBuiltin = (typeof BUILTIN)[number];
const isKnown = (id: string): id is KnownBuiltin =>
  (BUILTIN as readonly string[]).includes(id);

/** A built-in pack's name; packs a mod adds are shown by their id. */
export function builtinName(t: TFunction, id: string): string {
  return isKnown(id) ? t(`resourcePacks.builtin.${id}`) : id;
}

/** A stable key for a pack or a built-in row (for lists and drag and drop). */
export function packKey(ref: ActivePackRef): string {
  return ref.kind === "library"
    ? `library:${ref.sha1}`
    : ref.kind === "folder"
      ? `folder:${ref.name}`
      : `builtin:${ref.id}`;
}

export const rowRef = (row: ActivePack): ActivePackRef =>
  row.kind === "builtin" ? row : row.pack.ref;

export const sameRef = (a: PackRef, b: PackRef) => packKey(a) === packKey(b);

export function rowName(t: TFunction, row: ActivePack): string {
  return row.kind === "builtin" ? builtinName(t, row.id) : row.pack.name;
}

export function compatTone(compat: PackCompat): string {
  return compat === "compatible"
    ? "text-success"
    : compat === "unknown"
      ? "text-muted"
      : "text-warning";
}
