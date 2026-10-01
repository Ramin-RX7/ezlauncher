import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import type { LibraryPack } from "@shared/launcher";
import { createQueryClient } from "../lib/queryClient";
import { profile } from "../test/fixtures";
import { mockApi } from "../test/mockApi";
import { LibraryPage } from "./LibraryPage";

const packs: LibraryPack[] = [
  {
    sha1: "a".repeat(40),
    fileName: "Faithful.zip",
    name: "Faithful",
    description: "32x textures",
    hasIcon: false,
    size: 100,
    addedAt: "2026-09-01T00:00:00Z",
    usedBy: ["p1"],
    checked: true,
  },
  {
    sha1: "b".repeat(40),
    fileName: "Old.zip",
    name: "Old",
    description: "",
    hasIcon: false,
    size: 100,
    addedAt: "2026-09-01T00:00:00Z",
    usedBy: [],
    checked: false,
  },
];

function renderPage(path = "/mods") {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <LibraryPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("LibraryPage", () => {
  it("shows the mod library first and switches to resource packs", async () => {
    mockApi({
      "mods:library": () => [],
      "resourcePacks:library": () => packs,
      "profiles:list": () => [profile()],
    });
    renderPage();
    expect(await screen.findByText("Mod library")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Resource packs" }));
    expect(await screen.findByText("In Survival")).toBeInTheDocument();
    expect(screen.getByText("32x textures")).toBeInTheDocument();
    expect(screen.getByText("Unused")).toBeInTheDocument();
  });

  it("has a shader library tab", async () => {
    const api = mockApi({
      "shaders:library": () => [
        { ...packs[0]!, name: "Complementary", description: "" },
      ],
      "profiles:list": () => [profile()],
    });
    renderPage("/mods?tab=shaders");
    expect(await screen.findByText("Shader library")).toBeInTheDocument();
    expect(await screen.findByText("Complementary")).toBeInTheDocument();
    expect(api.invoke).toHaveBeenCalledWith("shaders:library");
  });

  it("asks before removing unused packs", async () => {
    const api = mockApi({
      "resourcePacks:library": () => packs,
      "resourcePacks:removeUnused": () => 1,
      "profiles:list": () => [profile()],
    });
    renderPage("/mods?tab=resourcePacks");
    await screen.findByText("Old");
    fireEvent.click(screen.getByRole("button", { name: "Remove unused" }));
    expect(
      await screen.findByText("Remove 1 unused pack?"),
    ).toBeInTheDocument();
    const buttons = screen.getAllByRole("button", { name: "Remove unused" });
    fireEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("resourcePacks:removeUnused");
    });
    expect(await screen.findByText("Removed 1 pack.")).toBeInTheDocument();
  });
});
