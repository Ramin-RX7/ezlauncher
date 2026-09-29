import { Box } from "lucide-react";
import { profileIconUrl } from "./profileIcons";

/** A profile's built-in icon, or a generic placeholder. */
export function ProfileIcon({
  iconId,
  className,
  small = false,
}: {
  iconId?: string;
  className?: string;
  small?: boolean;
}) {
  const url = profileIconUrl(iconId);
  return (
    <span
      className={`flex ${small ? "size-7" : "size-9"} shrink-0 items-center justify-center overflow-hidden rounded-ezl bg-surface-2 ${className ?? ""}`}
    >
      {url ? (
        <img
          src={url}
          alt=""
          className="size-full [image-rendering:pixelated]"
        />
      ) : (
        <Box size={small ? 14 : 18} className="text-muted" aria-hidden />
      )}
    </span>
  );
}
