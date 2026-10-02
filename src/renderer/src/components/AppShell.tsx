import type { ComponentType } from "react";
import { NavLink, Outlet, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { useIpcEvent } from "../lib/useIpcEvent";
import { AccountPicker } from "./accounts/AccountPicker";
import { BackupIndicator } from "./backups/BackupIndicator";
import {
  House,
  Layers,
  Package,
  Settings,
  type LucideProps,
} from "lucide-react";

interface NavItem {
  to: string;
  labelKey: "nav.home" | "nav.mods" | "nav.versions" | "nav.settings";
  icon: ComponentType<LucideProps>;
}

const NAV: NavItem[] = [
  { to: "/", labelKey: "nav.home", icon: House },
  { to: "/mods", labelKey: "nav.mods", icon: Package },
  { to: "/versions", labelKey: "nav.versions", icon: Layers },
  { to: "/settings", labelKey: "nav.settings", icon: Settings },
];

/** App name and a row of tabs on top; the page below. */
export function AppShell() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // A profile's desktop shortcut opened while the launcher runs: show that profile.
  useIpcEvent("app:openProfile", ({ profileId }) => {
    void navigate(`/profiles/${encodeURIComponent(profileId)}`);
  });
  return (
    // overflow-hidden: only <main> scrolls; the top bar never moves.
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex shrink-0 items-end gap-6 border-b border-border bg-surface px-6">
        <div className="py-3 text-lg font-bold tracking-tight">
          {t("app.name")}
        </div>
        <nav aria-label={t("nav.label")} className="flex items-end gap-1">
          {NAV.map(({ to, labelKey, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `-mb-px flex items-center gap-2 border-b-2 px-3 py-3 text-sm transition-colors ${
                  isActive
                    ? "border-accent font-medium text-text"
                    : "border-transparent text-muted hover:text-text"
                }`
              }
            >
              <Icon size={16} aria-hidden />
              {t(labelKey)}
            </NavLink>
          ))}
        </nav>
        <div className="ms-auto flex items-center gap-4 self-center py-2">
          <BackupIndicator />
          <AccountPicker />
        </div>
      </header>
      {/* relative: hidden inputs of Radix controls (position: absolute) stay inside the scroll area. */}
      <main className="relative min-h-0 flex-1 overflow-auto p-8">
        <Outlet />
      </main>
    </div>
  );
}
