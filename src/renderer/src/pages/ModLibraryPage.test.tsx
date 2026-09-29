import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { LibraryMod } from "@shared/launcher";
import { createQueryClient } from "../lib/queryClient";
import { loaders, profile, settings, versionList } from "../test/fixtures";
import { mockApi } from "../test/mockApi";
import { ModLibraryPage } from "./ModLibraryPage";

const base = {
  fileName: "m.jar",
  loaders: ["fabric"],
  hasIcon: false,
  addedAt: "2026-09-01T00:00:00Z",
  checked: true,
};
const library: LibraryMod[] = [
  { ...base, sha1: "1".repeat(40), name: "Sodium", usedBy: ["p1"] },
  { ...base, sha1: "2".repeat(40), name: "Old Thing", usedBy: [] },
];

function renderPage() {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <ModLibraryPage />
    </QueryClientProvider>,
  );
}

describe("ModLibraryPage", () => {
  it("shows which profiles use each mod and marks unused ones", async () => {
    mockApi({
      "mods:library": () => library,
      "profiles:list": () => [profile()],
    });
    renderPage();
    expect(await screen.findByText("Used by Survival")).toBeInTheDocument();
    expect(screen.getByText("Unused")).toBeInTheDocument();
  });

  it("asks before removing unused mods", async () => {
    const api = mockApi({
      "mods:library": () => library,
      "profiles:list": () => [profile()],
      "mods:removeUnused": () => 1,
    });
    renderPage();
    await screen.findByText("Old Thing");
    fireEvent.click(screen.getByRole("button", { name: "Remove unused" }));
    expect(await screen.findByText("Remove 1 unused mod?")).toBeInTheDocument();
    expect(api.invoke).not.toHaveBeenCalledWith("mods:removeUnused");
    const buttons = screen.getAllByRole("button", { name: "Remove unused" });
    fireEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("mods:removeUnused");
    });
    expect(await screen.findByText("Removed 1 mod.")).toBeInTheDocument();
  });

  it("lists the profiles that lose a mod before removing it", async () => {
    mockApi({
      "mods:library": () => library,
      "profiles:list": () => [profile()],
    });
    renderPage();
    await screen.findByText("Sodium");
    fireEvent.click(screen.getAllByRole("button", { name: "Remove…" })[0]!);
    expect(
      await screen.findByText(
        "It is removed from these profiles too: Survival",
      ),
    ).toBeInTheDocument();
  });

  it("nests dependency-only mods under the mods that need them", async () => {
    mockApi({
      "mods:library": () => [
        {
          ...base,
          sha1: "3".repeat(40),
          name: "Fabric API",
          usedBy: ["p1"],
          dependency: true,
          neededBy: ["1".repeat(40)],
        },
        ...library,
      ],
      "profiles:list": () => [profile()],
    });
    renderPage();
    expect(await screen.findByText("Dependency of Sodium")).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem").map((li) => li.textContent);
    const sodium = rows.findIndex((r) => r.startsWith("Sodium"));
    expect(rows[sodium + 1]).toContain("Fabric API");
  });

  it("downloads library mods for a chosen version", async () => {
    const api = mockApi({
      "mods:library": () => library,
      "profiles:list": () => [profile()],
      "versions:list": () => versionList,
      "loaders:list": () => loaders,
      "settings:get": () => settings(),
      "mods:downloadForVersion": () => ({ downloaded: 3, skipped: [] }),
    });
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Download mods for a version",
      }),
    );
    fireEvent.click(await screen.findByText("1.18.2"));
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("mods:downloadForVersion", {
        gameVersion: "1.18.2",
        loaderId: "fabric",
      });
    });
    expect(await screen.findByText("Downloaded 3 mod(s).")).toBeInTheDocument();
  });
});
