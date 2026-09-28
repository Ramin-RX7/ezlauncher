export type ThemeMode = "system" | "light" | "dark";

export const THEME_MODES: readonly ThemeMode[] = ["system", "light", "dark"];

const STORAGE_KEY = "ezlauncher.theme";

// Temporary storage in localStorage; Scope 06 moves the theme into launcher settings.
export function loadThemeMode(): ThemeMode {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "light" || value === "dark" || value === "system")
      return value;
  } catch {
    // storage unavailable
  }
  return "system";
}

export function saveThemeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // storage unavailable
  }
}

/** `system` removes the attribute so the CSS `prefers-color-scheme` rule applies. */
export function applyThemeMode(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", mode);
}
