import { GAME_WINDOW_LIMITS, type GameWindow } from "@shared/launcher";

/** The size offered when "Window size" is first picked. */
export const DEFAULT_WINDOW_SIZE = { width: 1280, height: 720 } as const;

/** Whether a window setting can be saved (a size within the launcher's limits). */
export function isValidGameWindow(window: GameWindow): boolean {
  if (window.mode !== "size") return true;
  const { minWidth, minHeight, max } = GAME_WINDOW_LIMITS;
  const ok = (n: number, min: number) =>
    Number.isInteger(n) && n >= min && n <= max;
  return ok(window.width, minWidth) && ok(window.height, minHeight);
}
