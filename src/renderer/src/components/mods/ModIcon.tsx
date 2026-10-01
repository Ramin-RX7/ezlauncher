import { useQuery } from "@tanstack/react-query";
import { Package } from "lucide-react";
import type { LibraryMod } from "@shared/launcher";
import { invoke } from "../../lib/api";
import { StoreIcon } from "../ui/StoreIcon";

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
  return <StoreIcon src={icon.data} fallback={Package} />;
}
