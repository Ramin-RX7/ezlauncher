import { useQuery } from "@tanstack/react-query";
import { Box } from "lucide-react";
import type { Profile } from "@shared/launcher";
import { invoke } from "../../lib/api";
import { profileIconUrl } from "./profileIcons";

interface Props {
  iconId?: string;
  /** Shows its own picture (a mod pack's icon) when it has one. */
  profile?: Pick<Profile, "id" | "iconId" | "customIcon">;
  className?: string;
  small?: boolean;
}

/** A profile's own picture, its built-in icon, or a generic placeholder. */
export function ProfileIcon(props: Props) {
  if (props.profile?.customIcon)
    return <CustomIcon {...props} profileId={props.profile.id} />;
  return <Icon {...props} />;
}

function CustomIcon({ profileId, ...props }: Props & { profileId: string }) {
  const custom = useQuery({
    queryKey: ["profiles", "icon", profileId],
    queryFn: () => invoke("profiles:icon", profileId),
    staleTime: Infinity,
  });
  return <Icon {...props} custom={custom.data ?? undefined} />;
}

function Icon({
  iconId,
  profile,
  className,
  small = false,
  custom,
}: Props & { custom?: string }) {
  const url = custom ?? profileIconUrl(iconId ?? profile?.iconId);
  return (
    <span
      className={`flex ${small ? "size-7" : "size-9"} shrink-0 items-center justify-center overflow-hidden rounded-ezl bg-surface-2 ${className ?? ""}`}
    >
      {url ? (
        <img
          src={url}
          alt=""
          className={`size-full ${custom ? "object-cover" : "[image-rendering:pixelated]"}`}
        />
      ) : (
        <Box size={small ? 14 : 18} className="text-muted" aria-hidden />
      )}
    </span>
  );
}
