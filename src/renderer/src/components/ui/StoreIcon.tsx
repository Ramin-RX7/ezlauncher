import type { LucideIcon } from "lucide-react";

/** A small square icon from a `data:` URL, or a generic one while there's none. */
export function StoreIcon({
  src,
  fallback: Fallback,
}: {
  src: string | null | undefined;
  fallback: LucideIcon;
}) {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-ezl bg-surface-2">
      {src ? (
        <img src={src} alt="" className="size-9 [image-rendering:pixelated]" />
      ) : (
        <Fallback size={18} className="text-muted" aria-hidden />
      )}
    </span>
  );
}
