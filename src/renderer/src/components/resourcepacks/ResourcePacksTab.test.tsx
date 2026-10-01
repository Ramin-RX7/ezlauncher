import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { ProfilePack, ProfilePacks } from "@shared/launcher";
import { createQueryClient } from "../../lib/queryClient";
import { profile } from "../../test/fixtures";
import { mockApi } from "../../test/mockApi";
import { ResourcePacksTab } from "./ResourcePacksTab";

const pack = (
  name: string,
  digit: string,
  extra: Partial<ProfilePack> = {},
): ProfilePack => ({
  ref: { kind: "library", sha1: digit.repeat(40) },
  name,
  description: `${name} pack`,
  hasIcon: false,
  compat: "compatible",
  ...extra,
});
const faithful = pack("Faithful", "1");
const fresh = pack("Fresh", "2");
const old = pack("Old", "3", { compat: "tooOld" });

const view = (extra: Partial<ProfilePacks> = {}): ProfilePacks => ({
  active: [
    { kind: "pack", pack: faithful },
    { kind: "builtin", id: "programmer_art" },
    { kind: "pack", pack: fresh },
  ],
  available: [old],
  notPacks: [],
  ...extra,
});

function renderTab(running = 0) {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <ResourcePacksTab profile={{ ...profile(), running }} />
    </QueryClientProvider>,
  );
}

describe("ResourcePacksTab", () => {
  it("lists active packs highest first, built-ins included, and what's available", async () => {
    mockApi({ "resourcePacks:profile": () => view() });
    renderTab();
    await screen.findByText("Faithful");
    const active = screen.getAllByRole("list")[0]!;
    expect(
      [...active.querySelectorAll("li")].map(
        (li) => li.querySelector(".font-medium")?.textContent,
      ),
    ).toEqual(["Faithful", "Programmer Art", "Fresh"]);
    expect(screen.getByText("Built-in")).toBeInTheDocument();
    expect(screen.getByText("Made for an older version")).toBeInTheDocument();
  });

  it("saves a new order when a pack is moved down", async () => {
    const api = mockApi({
      "resourcePacks:profile": () => view(),
      "resourcePacks:setActive": () => undefined,
    });
    renderTab();
    fireEvent.click(
      await screen.findByRole("button", { name: "Move Faithful down" }),
    );
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("resourcePacks:setActive", {
        profileId: "p1",
        active: [
          { kind: "builtin", id: "programmer_art" },
          faithful.ref,
          fresh.ref,
        ],
      });
    });
    expect(
      await screen.findByText("Faithful is now at place 2 of 3."),
    ).toBeInTheDocument();
  });

  it("turns an available pack on at the top, and an active one off", async () => {
    const api = mockApi({
      "resourcePacks:profile": () => view(),
      "resourcePacks:setActive": () => undefined,
    });
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "Turn on Old" }));
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("resourcePacks:setActive", {
        profileId: "p1",
        active: [
          old.ref,
          faithful.ref,
          { kind: "builtin", id: "programmer_art" },
          fresh.ref,
        ],
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "Turn off Fresh" }));
    await waitFor(() => {
      const saves = api.invoke.mock.calls.filter(
        ([channel]) => channel === "resourcePacks:setActive",
      );
      expect(saves).toHaveLength(2);
      const { active } = saves[1]![1] as { active: unknown[] };
      expect(active).not.toContainEqual(fresh.ref);
      expect(active).toContainEqual(faithful.ref);
    });
  });

  it("can't change anything while the game runs", async () => {
    mockApi({ "resourcePacks:profile": () => view({ locked: "running" }) });
    renderTab(1);
    await screen.findByText("Fresh");
    expect(screen.getByText("Close the game first.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Move Fresh up" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Turn on Old" })).toBeDisabled();
  });

  it("explains files that aren't packs", async () => {
    mockApi({
      "resourcePacks:profile": () =>
        view({
          notPacks: [
            { name: "Download.zip", reason: "nested", folder: "Faithful-main" },
          ],
        }),
    });
    renderTab();
    expect(
      await screen.findByText(/inside the folder "Faithful-main"/),
    ).toBeInTheDocument();
  });

  it("adds dropped zips and turns them on in the profile", async () => {
    const api = mockApi({
      "resourcePacks:profile": () => view(),
      "resourcePacks:addFiles": () => ({ added: 1, existing: 0, failed: [] }),
    });
    renderTab();
    await screen.findByText("Faithful");
    const zip = new File(["x"], "New.zip");
    const notes = new File(["x"], "notes.txt");
    fireEvent.drop(screen.getByText("Active"), {
      dataTransfer: { files: [zip, notes], types: ["Files"] },
    });
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("resourcePacks:addFiles", {
        paths: ["/dropped/New.zip"],
        profileId: "p1",
      });
    });
  });
});
