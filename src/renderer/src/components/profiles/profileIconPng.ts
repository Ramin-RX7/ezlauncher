import { invoke } from "../../lib/api";
import { profileIconUrl } from "./profileIcons";

const SIZE = 256;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve(img);
    };
    img.onerror = () => {
      reject(new Error("image failed"));
    };
    img.src = src;
  });
}

/**
 * A profile's icon as a 256×256 PNG, for its desktop shortcut: its own picture
 * (a mod pack's) or its built-in icon, drawn the way the launcher shows it.
 * Undefined when it has neither, or drawing fails (the shortcut uses the
 * launcher's icon then).
 */
export async function profileIconPng(profile: {
  id: string;
  iconId?: string;
  customIcon?: boolean;
}): Promise<Uint8Array | undefined> {
  try {
    const src = profile.customIcon
      ? ((await invoke("profiles:icon", profile.id)) ?? undefined)
      : profileIconUrl(profile.iconId);
    if (!src) return undefined;
    const img = await loadImage(src);
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    // Built-in icons are pixel art: keep their pixels sharp.
    ctx.imageSmoothingEnabled = profile.customIcon === true;
    ctx.drawImage(img, 0, 0, SIZE, SIZE);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/png");
    });
    return blob ? new Uint8Array(await blob.arrayBuffer()) : undefined;
  } catch {
    return undefined;
  }
}
