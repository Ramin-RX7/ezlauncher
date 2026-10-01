import { useQuery } from "@tanstack/react-query";
import { Folder, Image } from "lucide-react";
import type { PackRef } from "@shared/launcher";
import { invoke } from "../../lib/api";
import { StoreIcon } from "../ui/StoreIcon";

/** A pack's `pack.png` (loaded on demand), or a generic icon. */
export function PackIcon({
  packRef,
  hasIcon,
  profileId,
}: {
  packRef: PackRef;
  hasIcon: boolean;
  /** Needed for folder packs, which live in one profile. */
  profileId?: string;
}) {
  const folder = packRef.kind === "folder" ? packRef.name : undefined;
  const icon = useQuery({
    queryKey:
      packRef.kind === "library"
        ? ["resourcePacks", "icon", packRef.sha1]
        : ["resourcePacks", "folderIcon", profileId, folder],
    queryFn: () =>
      packRef.kind === "library"
        ? invoke("resourcePacks:icon", packRef.sha1)
        : invoke("resourcePacks:folderIcon", profileId ?? "", folder ?? ""),
    enabled: hasIcon && (packRef.kind === "library" || profileId !== undefined),
    staleTime: packRef.kind === "library" ? Infinity : 0,
  });
  return (
    <StoreIcon
      src={icon.data}
      fallback={packRef.kind === "folder" ? Folder : Image}
    />
  );
}
