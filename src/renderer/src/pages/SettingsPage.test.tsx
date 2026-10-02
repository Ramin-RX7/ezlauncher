import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { LauncherSettings } from "@shared/launcher";
import { createQueryClient } from "../lib/queryClient";
import { settings } from "../test/fixtures";
import { mockApi } from "../test/mockApi";
import { ThemeProvider } from "../theme/ThemeProvider";
import { SettingsPage } from "./SettingsPage";

const info = {
  appName: "EZLauncher",
  version: "1.0.0",
  platform: "win32",
  arch: "x64",
  electron: "44",
  node: "22",
  totalMemoryMb: 8192,
  canCreateShortcuts: true,
};

function renderPage(overrides: Partial<LauncherSettings> = {}) {
  const api = mockApi({
    "settings:get": () => settings(overrides),
    "settings:update": (patch) =>
      settings({ ...overrides, ...(patch as object) }),
    "setup:getState": () => ({ dataDir: "C:\\data", suggestedDir: "C:\\data" }),
    "app:getInfo": () => info,
    "setup:chooseFolder": () => "D:\\games",
    "setup:moveDataDir": () => new Promise(() => undefined), // restarts when done
    "setup:cancelMove": () => undefined,
  });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <ThemeProvider>
        <SettingsPage />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return api;
}

describe("SettingsPage", () => {
  it("shows the computer's memory and warns above 75% of it", async () => {
    renderPage();
    expect(
      await screen.findByText(/This computer has 8192 MB\./),
    ).toBeInTheDocument();
    const field = screen.getByRole("spinbutton", { name: "Maximum memory" });
    fireEvent.change(field, { target: { value: "7168" } });
    expect(
      screen.getByText(/more than 75% of this computer's memory/),
    ).toBeInTheDocument();
    fireEvent.change(field, { target: { value: "4096" } });
    expect(screen.queryByText(/more than 75%/)).not.toBeInTheDocument();
  });

  it("saves extra arguments as a list, and refuses an unclosed quote", async () => {
    const api = renderPage();
    const jvm = await screen.findByLabelText("Extra JVM arguments");
    fireEvent.change(jvm, { target: { value: '-XX:+UseG1GC "-Dname=a b"' } });
    fireEvent.blur(jvm);
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("settings:update", {
        extraJvmArgs: ["-XX:+UseG1GC", "-Dname=a b"],
      });
    });

    const game = screen.getByLabelText("Extra game arguments");
    fireEvent.change(game, { target: { value: '--title "open' } });
    fireEvent.blur(game);
    expect(screen.getByText("A quote isn't closed.")).toBeInTheDocument();
    expect(api.invoke).not.toHaveBeenCalledWith(
      "settings:update",
      expect.objectContaining({ extraGameArgs: expect.anything() as unknown }),
    );

    fireEvent.change(jvm, { target: { value: "-Xmx8G" } });
    expect(
      screen.getByText("-Xmx and -Xms are set by Memory; leave them out here."),
    ).toBeInTheDocument();
  });

  it("turns version types on and off", async () => {
    const api = renderPage();
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Show snapshots" }),
    );
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("settings:update", {
        showSnapshots: true,
      });
    });
    expect(
      screen.getByRole("checkbox", { name: "Show old beta" }),
    ).not.toBeChecked();
  });

  it("asks whether to move the data or start empty in the new folder", async () => {
    const api = renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Change…" }));
    expect(
      await screen.findByText("New folder: D:\\games"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Start empty there/ }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Move my data there/ }));
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("setup:moveDataDir", "D:\\games");
    });
    expect(await screen.findByText("Moving your data…")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("setup:cancelMove");
    });
  });
});
