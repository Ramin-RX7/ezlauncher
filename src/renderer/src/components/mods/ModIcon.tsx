import { useQuery } from "@tanstack/react-query";
import { Package } from "lucide-react";
import type { LibraryMod } from "@shared/launcher";
import { invoke } from "../../lib/api";

/** The mod's own icon (loaded on demand), or a generic one. */
export function ModIcon({
  mod,
}: {
  mod: Pick<LibraryMod, "sha1" | "hasIcon">;
}) {
  const icon = useQuery({
    queryKey: ["mods", "icon", mod.sha1],
    queryFn: () => invoke("mods:icon", mod.sha1),
    enabled: mod.hasIcon,
    staleTime: Infinity,
  });
  return (
    <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-ezl bg-surface-2">
      {icon.data ? (
        <img
          src={icon.data}
          alt=""
          className="size-9 [image-rendering:pixelated]"
        />
      ) : (
        <Package size={18} className="text-muted" aria-hidden />
      )}
    </span>
  );
}
