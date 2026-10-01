import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { PackInstallResult, RemotePack } from "@shared/launcher";
import { createQueryClient } from "../../lib/queryClient";
import { profile } from "../../test/fixtures";
import { mockApi } from "../../test/mockApi";
import { FindPacksDialog } from "./FindPacksDialog";

const hit = (n: number): RemotePack => ({
  sourceId: "modrinth",
  projectId: `p${n}`,
  slug: `pack-${n}`,
  name: `Pack ${n}`,
  author: "someone",
  description: `Pack number ${n}`,
  downloads: 1200,
  pageUrl: `https://modrinth.com/resourcepack/pack-${n}`,
});

function renderDialog(withProfile = true) {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <FindPacksDialog
        {...(withProfile && { profile: { ...profile(), running: 0 } })}
        onClose={() => undefined}
      />
    </QueryClientProvider>,
  );
}

describe("FindPacksDialog", () => {
  it("lists results for the profile's version and loads more", async () => {
    const api = mockApi({
      "resourcePacks:search": (options) => {
        const { offset } = options as { offset: number };
        return {
          hits: Array.from({ length: offset === 0 ? 20 : 5 }, (_, i) =>
            hit(offset + i),
          ),
          total: 25,
        };
      },
    });
    renderDialog();
    expect(await screen.findByText("Pack 0")).toBeInTheDocument();
    expect(screen.getByText("Packs for Minecraft 1.18.2.")).toBeInTheDocument();
    expect(api.invoke).toHaveBeenCalledWith("resourcePacks:search", {
      query: "",
      offset: 0,
      profileId: "p1",
    });
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("Pack 24")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("downloads a pack and shows what it needs", async () => {
    const result: PackInstallResult = {
      sha1: "a".repeat(40),
      name: "Fresh",
      versionNumber: "1.10.5",
      compat: "compatible",
      otherVersion: true,
      activated: true,
      needs: [
        {
          name: "Entity Model Features",
          slug: "entity-model-features",
          projectType: "mod",
          pageUrl: "https://modrinth.com/mod/entity-model-features",
        },
        {
          name: "Fresh Base",
          slug: "fresh-base",
          projectType: "resourcepack",
          pageUrl: "https://modrinth.com/resourcepack/fresh-base",
        },
      ],
    };
    const api = mockApi({
      "resourcePacks:search": () => ({ hits: [hit(1)], total: 1 }),
      "resourcePacks:install": () => result,
    });
    renderDialog();
    fireEvent.click(
      await screen.findByRole("button", { name: "Download Pack 1" }),
    );
    expect(
      await screen.findByText(/Added Fresh \(1\.10\.5\) to the library/),
    ).toBeInTheDocument();
    expect(api.invoke).toHaveBeenCalledWith("resourcePacks:install", {
      sourceId: "modrinth",
      projectId: "p1",
      profileId: "p1",
    });
    expect(screen.getByText(/newest one was downloaded/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Get Entity Model Features" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Find Fresh Base" }));
    await waitFor(() => {
      expect(screen.getByRole("searchbox")).toHaveValue("Fresh Base");
    });
  });

  it("searches every version from the library", async () => {
    const api = mockApi({
      "resourcePacks:search": () => ({ hits: [], total: 0 }),
    });
    renderDialog(false);
    expect(await screen.findByText("No packs found.")).toBeInTheDocument();
    expect(
      screen.getByText("Packs for every Minecraft version."),
    ).toBeInTheDocument();
    expect(api.invoke).toHaveBeenCalledWith("resourcePacks:search", {
      query: "",
      offset: 0,
    });
  });
});
