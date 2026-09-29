import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { LibraryMod, RemoteMatchCard } from "@shared/launcher";
import { createQueryClient } from "../../lib/queryClient";
import { profile } from "../../test/fixtures";
import { mockApi } from "../../test/mockApi";
import { AddModDialog } from "./AddModDialog";

const libraryMod = (overrides: Partial<LibraryMod>): LibraryMod => ({
  sha1: "1".repeat(40),
  fileName: "m.jar",
  name: "Mod",
  loaders: ["fabric"],
  hasIcon: false,
  addedAt: "2026-09-01T00:00:00Z",
  usedBy: [],
  enabled: false,
  checked: true,
  compat: { status: "compatible" },
  ...overrides,
});

const library = [
  libraryMod({ sha1: "1".repeat(40), name: "Lithium" }),
  libraryMod({
    sha1: "2".repeat(40),
    name: "Lithium Forge Port",
    compat: {
      status: "incompatible",
      reason: { code: "loader", loaders: ["forge"] },
    },
  }),
];

const sodiumCard: RemoteMatchCard = {
  planId: "plan-1",
  sourceId: "modrinth",
  project: {
    projectId: "AANobbMI",
    name: "Sodium",
    author: "jellysquid3",
    pageUrl: "https://modrinth.com/mod/sodium",
    downloads: 51_234_567,
  },
  version: { versionNumber: "mc1.18.2-0.4.1", fileName: "sodium.jar" },
  dependencies: [
    { name: "Fabric API", versionNumber: "0.76.0", action: "download" },
    { name: "Indium", action: "reuse" },
  ],
  missing: [],
  incompatible: [],
  replaces: ["Sodium 0.3"],
  totalSize: 3 * 1024 * 1024,
};

/** The same card, but a required mod has no version: nothing to download. */
const missingCard: RemoteMatchCard = { ...sodiumCard, missing: ["Fabric API"] };
delete missingCard.planId;

function renderDialog() {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <AddModDialog profile={profile()} onClose={() => undefined} />
    </QueryClientProvider>,
  );
}

const type = (text: string) => {
  fireEvent.change(screen.getByRole("searchbox", { name: "Mod name" }), {
    target: { value: text },
  });
};

describe("AddModDialog", () => {
  it("filters the library first; incompatible mods can't be picked", async () => {
    const api = mockApi({
      "mods:library": () => library,
      "mods:setEnabled": () => ({ disabled: [] }),
    });
    renderDialog();
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("mods:library", {
        profileId: "p1",
      });
    });
    type("lith");
    expect(await screen.findByText("Lithium")).toBeInTheDocument();
    expect(screen.getByText("Forge only")).toBeInTheDocument();
    const [use, forge] = screen.getAllByRole("button", { name: "Use" });
    expect(forge).toBeDisabled();
    fireEvent.click(use!);
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("mods:setEnabled", {
        profileId: "p1",
        sha1: "1".repeat(40),
        enabled: true,
      });
    });
  });

  it("searches Modrinth when the mod isn't in the library, and says Not found", async () => {
    const api = mockApi({
      "mods:library": () => library,
      "mods:findRemote": () => [],
    });
    renderDialog();
    type("Nonexistent Mod");
    expect(
      await screen.findByText("No mod with that name in your library."),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Not in your library. Search Modrinth",
      }),
    );
    expect(await screen.findByText(/^Not found\./)).toBeInTheDocument();
    expect(api.invoke).toHaveBeenCalledWith("mods:findRemote", {
      profileId: "p1",
      query: "Nonexistent Mod",
    });
  });

  it("shows the confirm card with dependencies and downloads it", async () => {
    const api = mockApi({
      "mods:library": () => [],
      "mods:findRemote": () => [sodiumCard],
      "mods:installRemote": () => ({ replaced: [] }),
    });
    renderDialog();
    type("Sodium");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Not in your library. Search Modrinth",
      }),
    );
    expect(await screen.findByText("Sodium")).toBeInTheDocument();
    expect(
      screen.getByText("by jellysquid3 · 51.2M downloads"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Downloads version mc1.18.2-0.4.1"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Fabric API 0.76.0 (download)"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Indium (already in your library)"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Replaces Sodium 0.3 in this profile."),
    ).toBeInTheDocument();
    expect(screen.getByText("3.0 MB to download")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open Sodium on Modrinth" }),
    ).toHaveAttribute("href", "https://modrinth.com/mod/sodium");

    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("mods:installRemote", "plan-1");
    });
    expect(
      await screen.findByText("Sodium was added and enabled."),
    ).toBeInTheDocument();
  });

  it("offers no Download when a required mod is missing", async () => {
    mockApi({
      "mods:library": () => [],
      "mods:findRemote": () => [missingCard],
    });
    renderDialog();
    type("Sodium");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Not in your library. Search Modrinth",
      }),
    );
    expect(
      await screen.findByText(/Needs Fabric API, which has no version/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Download" }),
    ).not.toBeInTheDocument();
  });

  it("shows one row per mod, with its versions to pick from", async () => {
    const api = mockApi({
      "mods:library": () => [
        libraryMod({
          sha1: "7".repeat(40),
          modId: "sodium",
          name: "Sodium",
          version: "0.4.1",
        }),
        libraryMod({
          sha1: "8".repeat(40),
          modId: "sodium",
          name: "Sodium",
          version: "0.5.0",
        }),
      ],
      "mods:setEnabled": () => ({ disabled: [] }),
    });
    renderDialog();
    type("sodium");
    const picker = await screen.findByRole("combobox", {
      name: "Version of Sodium",
    });
    expect(screen.getAllByRole("button", { name: "Use" })).toHaveLength(1);
    expect(picker).toHaveValue("8".repeat(40)); // the newest
    fireEvent.change(picker, { target: { value: "7".repeat(40) } });
    fireEvent.click(screen.getByRole("button", { name: "Use" }));
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("mods:setEnabled", {
        profileId: "p1",
        sha1: "7".repeat(40),
        enabled: true,
      });
    });
  });
});
