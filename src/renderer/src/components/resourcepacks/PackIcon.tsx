import { useQuery } from "@tanstack/react-query";
import { Folder, Image, Sparkles } from "lucide-react";
import type { PackRef } from "@shared/launcher";
import { invoke } from "../../lib/api";
import { StoreIcon } from "../ui/StoreIcon";
import type { PackKind } from "./AddPacks";

function fetchIcon(
  kind: PackKind,
  packRef: PackRef,
  profileId: string | undefined,
): Promise<string | null> {
  if (packRef.kind === "folder")
    return kind === "shaders"
      ? Promise.resolve(null) // shader folders have no icon
      : invoke("resourcePacks:folderIcon", profileId ?? "", packRef.name);
  return kind === "shaders"
    ? invoke("shaders:icon", packRef.sha1)
    : invoke("resourcePacks:icon", packRef.sha1);
}

/** A pack's icon (`pack.png`, or a shader's project icon; loaded on demand), or a generic one. */
export function PackIcon({
  kind = "resourcePacks",
  packRef,
  hasIcon,
  profileId,
}: {
  kind?: PackKind;
  packRef: PackRef;
  hasIcon: boolean;
  /** Needed for folder packs, which live in one profile. */
  profileId?: string;
}) {
  const folder = packRef.kind === "folder" ? packRef.name : undefined;
  const icon = useQuery({
    queryKey:
      packRef.kind === "library"
        ? [kind, "icon", packRef.sha1]
        : [kind, "folderIcon", profileId, folder],
    queryFn: () => fetchIcon(kind, packRef, profileId),
    enabled: hasIcon && (packRef.kind === "library" || profileId !== undefined),
    staleTime: packRef.kind === "library" ? Infinity : 0,
  });
  return (
    <StoreIcon
      src={icon.data}
      fallback={
        packRef.kind === "folder"
          ? Folder
          : kind === "shaders"
            ? Sparkles
            : Image
      }
    />
  );
}
