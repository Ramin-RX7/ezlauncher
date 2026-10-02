import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
      await screen.findByText("Welcome to EZLauncher"),
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

  it("picks the account in the top bar and plays a profile from its row", async () => {
    const api = mockApi({
      "setup:getState": () => ({ dataDir: "/data", suggestedDir: "/data" }),
      "profiles:list": () => [profile()],
      "worlds:orphans": () => [],
      "loaders:list": () => loaders,
      "account:list": () => [steve],
      "settings:get": () =>
        settings({ selectedProfileId: "p1", selectedAccountId: "a1" }),
      "settings:update": (patch) =>
        settings({
          selectedProfileId: "p1",
          selectedAccountId: "a1",
          ...(patch as object),
        }),
      "game:running": () => [],
      "game:launch": () => ({
        status: "started",
        game: {
          launchId: "l",
          profileId: "p1",
          accountId: "a1",
          versionId: "fabric-loader-0.19.5-1.18.2",
          pid: 1,
        },
        warnings: 0,
      }),
    });
    render(<App queryClient={createQueryClient()} />);
    const banner = await screen.findByRole("banner");
    expect(
      await within(banner).findByRole("combobox", { name: "Account" }),
    ).toHaveValue("a1");

    // Right-click on a row opens the same menu as its "…" button.
    const row = await screen.findByRole("option", { name: /Survival/ });
    fireEvent.contextMenu(row);
    expect(
      await screen.findByRole("menuitem", { name: "Duplicate…" }),
    ).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });

    const play = screen.getByRole("button", { name: "Play Survival" });
    await waitFor(() => {
      expect(play).toBeEnabled();
    });
    fireEvent.click(play);
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("game:launch", {
        profileId: "p1",
        accountId: "a1",
      });
    });
  });

  it("searches profiles by name, version or loader", async () => {
    mockApi({
      "setup:getState": () => ({ dataDir: "/data", suggestedDir: "/data" }),
      "profiles:list": () => [
        profile(),
        profile({
          id: "p2",
          name: "Creative",
          gameVersion: "26.3",
          loader: null,
        }),
      ],
      "worlds:orphans": () => [],
      "loaders:list": () => loaders,
      "account:list": () => [steve],
      "settings:get": () => settings({ selectedAccountId: "a1" }),
      "game:running": () => [],
    });
    render(<App queryClient={createQueryClient()} />);
    const search = await screen.findByRole("searchbox", {
      name: "Search profiles",
    });
    fireEvent.change(search, { target: { value: "fabric" } });
    const profilesList = screen.getByRole("listbox", { name: "Profiles" });
    expect(within(profilesList).getAllByRole("option")).toHaveLength(1);
    expect(
      screen.getByRole("option", { name: /Survival/ }),
    ).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "26.3" } });
    expect(
      screen.getByRole("option", { name: /Creative/ }),
    ).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.getByText("No profiles match.")).toBeInTheDocument();
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

  it("shows a profile when its desktop shortcut is opened, with Play, worlds and servers", async () => {
    const api = mockApi({
      "setup:getState": () => ({ dataDir: "/data", suggestedDir: "/data" }),
      "profiles:list": () => [profile()],
      "worlds:orphans": () => [],
      "loaders:list": () => loaders,
      "account:list": () => [steve],
      "settings:get": () => settings({ selectedAccountId: "a1" }),
      "game:running": () => [],
      "versions:list": () => versionList,
      "app:getInfo": () => ({
        appName: "EZLauncher",
        version: "0.2.0",
        platform: "win32",
        arch: "x64",
        electron: "44",
        node: "24",
        totalMemoryMb: 8192,
        canCreateShortcuts: true,
      }),
      "profiles:createShortcut": () => "C:/Users/me/Desktop/Survival.lnk",
      "profiles:playTargets": () => ({
        worlds: "yes",
        servers: [{ name: "Friends", address: "friends.example.com" }],
      }),
      "game:launch": () => ({
        status: "started",
        game: {
          launchId: "l",
          profileId: "p1",
          accountId: "a1",
          versionId: "fabric-loader-0.19.5-1.18.2",
          pid: 1,
        },
        warnings: 0,
      }),
    });
    render(<App queryClient={createQueryClient()} />);
    await screen.findByRole("link", { name: "Home" });
    act(() => {
      api.emit("app:openProfile", { profileId: "p1" });
    });
    expect(
      await screen.findByRole("heading", { name: "Survival" }),
    ).toBeInTheDocument();

    fireEvent.click(
      await screen.findByRole("button", { name: "Desktop shortcut" }),
    );
    expect(
      await screen.findByText("Shortcut created on your desktop."),
    ).toBeInTheDocument();
    expect(api.invoke).toHaveBeenCalledWith("profiles:createShortcut", {
      profileId: "p1",
      description: "Open Survival in EZLauncher",
    });

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Servers" }));
    const join = await screen.findByRole("button", { name: "Join Friends" });
    fireEvent.click(join);
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("game:launch", {
        profileId: "p1",
        accountId: "a1",
        quickPlay: { kind: "server", address: "friends.example.com" },
      });
    });
  });
});
