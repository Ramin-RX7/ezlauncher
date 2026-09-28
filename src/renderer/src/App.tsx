import { HashRouter, Route, Routes } from "react-router";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { AppShell } from "./components/AppShell";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { TooltipProvider } from "./components/ui/Tooltip";
import { HomePage } from "./pages/HomePage";
import { SettingsPage } from "./pages/SettingsPage";
import { ThemeProvider } from "./theme/ThemeProvider";

export function App({ queryClient }: { queryClient: QueryClient }) {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <TooltipProvider>
            {/* Hash routing: the packaged app loads from file://, where path URLs don't work. */}
            <HashRouter>
              <Routes>
                <Route element={<AppShell />}>
                  <Route index element={<HomePage />} />
                  <Route path="settings" element={<SettingsPage />} />
                </Route>
              </Routes>
            </HashRouter>
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
