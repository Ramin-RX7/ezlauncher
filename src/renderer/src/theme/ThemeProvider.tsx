import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ThemeContext } from "./useTheme";
import {
  applyThemeMode,
  loadThemeMode,
  saveThemeMode,
  type ThemeMode,
} from "./theme";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(loadThemeMode);

  useLayoutEffect(() => {
    applyThemeMode(mode);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    saveThemeMode(next);
    setModeState(next);
  }, []);

  const value = useMemo(() => ({ mode, setMode }), [mode, setMode]);
  return <ThemeContext value={value}>{children}</ThemeContext>;
}
