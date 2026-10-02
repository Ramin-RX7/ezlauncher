import { useEffect } from "react";
import { useTranslation } from "react-i18next";
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
import { LibraryPage } from "./pages/LibraryPage";
import { NewProfilePage } from "./pages/NewProfilePage";
import { ProfilePage } from "./pages/ProfilePage";
import { SettingsPage } from "./pages/SettingsPage";
import { StoragePage } from "./pages/StoragePage";
import { SetupPage } from "./pages/SetupPage";
import { VersionsPage } from "./pages/VersionsPage";
import { LauncherEvents } from "./state/LauncherEvents";
import { ThemeProvider } from "./theme/ThemeProvider";

/** Shows the first-run setup until a data folder is chosen, then the launcher. */
function Root() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  useEffect(() => {
    document.title = t("app.name");
  }, [t]);
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
            <Route path="profiles/new" element={<NewProfilePage />} />
            <Route path="profiles/:id" element={<ProfilePage />} />
            <Route path="mods" element={<LibraryPage />} />
            <Route path="versions" element={<VersionsPage />} />
            <Route path="storage" element={<StoragePage />} />
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
