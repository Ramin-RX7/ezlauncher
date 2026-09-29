import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { InstalledVersionInfo } from "@shared/launcher";
import { createQueryClient } from "../lib/queryClient";
import { loaders, profile } from "../test/fixtures";
import { mockApi } from "../test/mockApi";
import { VersionsPage } from "./VersionsPage";

const installed: InstalledVersionInfo[] = [
  {
    id: "1.18.2",
    type: "release",
    releaseTime: "2022-02-28T00:00:00Z",
    installed: true,
    usedBy: [],
    dependents: ["fabric-loader-0.19.5-1.18.2"],
  },
  {
    id: "fabric-loader-0.19.5-1.18.2",
    type: "release",
    releaseTime: "2022-02-28T00:00:00Z",
    installed: true,
    loader: { id: "fabric", loaderVersion: "0.19.5", gameVersion: "1.18.2" },
    usedBy: ["p1"],
    dependents: [],
  },
  {
    id: "26.3",
    type: "release",
    releaseTime: "2026-06-01T00:00:00Z",
    installed: true,
    usedBy: [],
    dependents: [],
  },
];

function renderPage() {
  const api = mockApi({
    "versions:installed": () => installed,
    "profiles:list": () => [profile()],
    "loaders:list": () => loaders,
    "versions:patchNotes": (id) =>
      id === "26.3"
        ? {
            title: "Minecraft Java Edition 26.3",
            version: "26.3",
            type: "release",
            date: "2026-06-01T00:00:00Z",
            body: "<p>Big update<h1>New Features</h1><ul><li>Copper golems</ul>",
          }
        : null,
  });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <VersionsPage />
    </QueryClientProvider>,
  );
  return api;
}

describe("VersionsPage", () => {
  it("searches by version, loader and the profiles using it", async () => {
    renderPage();
    const search = await screen.findByRole("searchbox", {
      name: "Search versions",
    });
    fireEvent.change(search, { target: { value: "fabric" } });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    fireEvent.change(search, { target: { value: "survival" } });
    expect(screen.getByText("Used by Survival")).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "nothing-like-this" } });
    expect(
      screen.getByText("No installed versions match."),
    ).toBeInTheDocument();
  });

  it("shows a version's changelog, and a wiki link when Mojang has none", async () => {
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: "Changelog of 26.3" }),
    );
    expect(
      await screen.findByText("Minecraft Java Edition 26.3"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "New Features" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Copper golems")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]!);

    // The loader install shows the notes of its Minecraft version.
    fireEvent.click(
      screen.getAllByRole("button", { name: "Changelog of 1.18.2" })[0]!,
    );
    expect(
      await screen.findByRole("link", { name: "Open on the Minecraft Wiki" }),
    ).toHaveAttribute("href", "https://minecraft.wiki/w/Java_Edition_1.18.2");
  });
});
