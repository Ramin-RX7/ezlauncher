import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { ProfileInfo } from "@shared/launcher";
import { App } from "../App";
import { createQueryClient } from "../lib/queryClient";
import { loaders, profile, settings, steve } from "../test/fixtures";
import { mockApi } from "../test/mockApi";

beforeEach(() => {
  window.location.hash = "";
  localStorage.clear();
});

function setUp(
  list: ProfileInfo[],
  sort: "lastPlayed" | "name" = "lastPlayed",
) {
  return mockApi({
    "setup:getState": () => ({ dataDir: "/data", suggestedDir: "/data" }),
    "profiles:list": () => list,
    "profiles:setPinned": () => undefined,
    "worlds:orphans": () => [],
    "loaders:list": () => loaders,
    "account:list": () => [steve],
    "settings:get": () =>
      settings({ selectedAccountId: "a1", profileSort: sort }),
    "settings:update": (patch) => ({
      ...settings(),
      ...(patch as object),
    }),
    "game:running": () => [],
  });
}

const names = (list: HTMLElement) =>
  within(list)
    .getAllByRole("option")
    .map((o) => o.querySelector(".font-medium")?.textContent);

describe("HomePage profiles", () => {
  const list = [
    profile({ id: "a", name: "Zeta", lastPlayedAt: "2026-09-10T00:00:00Z" }),
    profile({ id: "b", name: "Alpha", lastPlayedAt: "2026-09-05T00:00:00Z" }),
    profile({ id: "c", name: "Mid", pinned: true }),
  ];

  it("shows pinned profiles first, then the rest in the chosen order", async () => {
    setUp(list);
    render(<App queryClient={createQueryClient()} />);
    const pinned = await screen.findByRole("listbox", { name: "Pinned" });
    expect(names(pinned)).toEqual(["Mid"]);
    expect(names(screen.getByRole("listbox", { name: "Profiles" }))).toEqual([
      "Zeta",
      "Alpha",
    ]);
  });

  it("saves the sort and reorders", async () => {
    const api = setUp(list);
    render(<App queryClient={createQueryClient()} />);
    const sort = await screen.findByRole("combobox", { name: "Sort profiles" });
    fireEvent.change(sort, { target: { value: "name" } });
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("settings:update", {
        profileSort: "name",
      });
    });
    expect(names(screen.getByRole("listbox", { name: "Profiles" }))).toEqual([
      "Alpha",
      "Zeta",
    ]);
  });

  it("pins from the row menu", async () => {
    const api = setUp(list);
    render(<App queryClient={createQueryClient()} />);
    fireEvent.contextMenu(await screen.findByRole("option", { name: /Zeta/ }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Pin to top" }),
    );
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("profiles:setPinned", {
        id: "a",
        pinned: true,
      });
    });
  });
});
