import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { createQueryClient } from "../lib/queryClient";
import {
  loaders,
  profile,
  settings,
  steve,
  versionList,
} from "../test/fixtures";
import { mockApi } from "../test/mockApi";

beforeEach(() => {
  window.location.hash = "";
  localStorage.clear();
});

describe("App", () => {
  it("shows the first-run setup when no data folder is chosen", async () => {
    mockApi({
      "setup:getState": () => ({
        dataDir: null,
        suggestedDir: "/home/me/ezlauncher",
      }),
    });
    render(<App queryClient={createQueryClient()} />);
    expect(
      await screen.findByText("Welcome to ezlauncher"),
    ).toBeInTheDocument();
    expect(screen.getByText("/home/me/ezlauncher")).toBeInTheDocument();
  });

  it("shows navigation, the profiles and the play bar once set up", async () => {
    mockApi({
      "setup:getState": () => ({ dataDir: "/data", suggestedDir: "/data" }),
      "profiles:list": () => [profile()],
      "worlds:orphans": () => [],
      "loaders:list": () => loaders,
      "account:list": () => [steve],
      "settings:get": () =>
        settings({ selectedProfileId: "p1", selectedAccountId: "a1" }),
      "game:running": () => [],
    });
    render(<App queryClient={createQueryClient()} />);

    expect(
      await screen.findByRole("link", { name: "Home" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Versions" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
    expect(
      await screen.findByRole("option", { name: /Survival/ }),
    ).toHaveAttribute("aria-selected", "true");
    // The profile is installed and an account is picked: Play is ready.
    expect(await screen.findByRole("button", { name: "Play" })).toBeEnabled();
  });

  it("opens Create profile when there are no profiles", async () => {
    mockApi({
      "setup:getState": () => ({ dataDir: "/data", suggestedDir: "/data" }),
      "profiles:list": () => [],
      "worlds:orphans": () => [],
      "loaders:list": () => loaders,
      "versions:list": () => versionList,
      "account:list": () => [],
      "settings:get": () => settings(),
      "game:running": () => [],
    });
    render(<App queryClient={createQueryClient()} />);
    expect(
      await screen.findByRole("heading", { name: "Create profile" }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/Version list from/)).toBeInTheDocument();
  });
});
