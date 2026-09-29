import { HashRouter, Route, Routes } from "react-router";
import {
  QueryClientProvider,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { AppShell } from "./components/AppShell";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { TooltipProvider } from "./components/ui/Tooltip";
import { invoke } from "./lib/api";
import { HomePage } from "./pages/HomePage";
import { SettingsPage } from "./pages/SettingsPage";
import { SetupPage } from "./pages/SetupPage";
import { LauncherEvents } from "./state/LauncherEvents";
import { ThemeProvider } from "./theme/ThemeProvider";

/** Shows the first-run setup until a data folder is chosen, then the launcher. */
function Root() {
  const queryClient = useQueryClient();
  const setup = useQuery({
    queryKey: ["setup"],
    queryFn: () => invoke("setup:getState"),
  });
  if (setup.isPending) return null;
  if (setup.data && !setup.data.dataDir) {
    return (
      <SetupPage
        suggestedDir={setup.data.suggestedDir}
        onDone={() => {
          void queryClient.invalidateQueries();
        }}
      />
    );
  }
  return (
    <>
      <LauncherEvents />
      {/* Hash routing: the packaged app loads from file://, where path URLs don't work. */}
      <HashRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<HomePage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </HashRouter>
    </>
  );
}

export function App({ queryClient }: { queryClient: QueryClient }) {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <TooltipProvider>
            <Root />
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
