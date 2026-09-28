import type { ComponentType } from "react";
import { NavLink, Outlet } from "react-router";
import { useTranslation } from "react-i18next";
import { House, Settings, type LucideProps } from "lucide-react";

interface NavItem {
  to: string;
  labelKey: "nav.home" | "nav.settings";
  icon: ComponentType<LucideProps>;
}

const NAV: NavItem[] = [
  { to: "/", labelKey: "nav.home", icon: House },
  { to: "/settings", labelKey: "nav.settings", icon: Settings },
];

export function AppShell() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full">
      <nav className="flex w-52 shrink-0 flex-col gap-1 border-e border-border bg-surface p-3">
        <div className="mb-4 px-3 py-2 text-lg font-bold tracking-tight">
          {t("app.name")}
        </div>
        {NAV.map(({ to, labelKey, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-ezl px-3 py-2 text-sm transition-colors ${
                isActive
                  ? "bg-surface-2 font-medium text-text"
                  : "text-muted hover:bg-surface-2 hover:text-text"
              }`
            }
          >
            <Icon size={18} aria-hidden />
            {t(labelKey)}
          </NavLink>
        ))}
      </nav>
      <main className="min-w-0 flex-1 overflow-auto p-8">
        <Outlet />
      </main>
    </div>
  );
}
