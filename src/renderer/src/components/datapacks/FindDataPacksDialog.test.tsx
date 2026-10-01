import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { DataPackInstallResult, RemotePack } from "@shared/launcher";
import { createQueryClient } from "../../lib/queryClient";
import { profile } from "../../test/fixtures";
import { mockApi } from "../../test/mockApi";
import { FindDataPacksDialog } from "./FindDataPacksDialog";

const HIT: RemotePack = {
  sourceId: "modrinth",
  projectId: "terralith",
  slug: "terralith",
  name: "Terralith",
  author: "Stardust Labs",
  pageUrl: "https://modrinth.com/mod/terralith",
};

describe("FindDataPacksDialog", () => {
  it("searches for the world's version and downloads into the world", async () => {
    const result: DataPackInstallResult = {
      sha1: "a".repeat(40),
      name: "Terralith_v2.6.5",
      versionNumber: "2.6.5",
      compat: "compatible",
      otherVersion: false,
      added: true,
      needs: [],
    };
    const api = mockApi({
      "dataPacks:search": () => ({ hits: [HIT], total: 1 }),
      "dataPacks:install": () => result,
    });
    render(
      <QueryClientProvider client={createQueryClient()}>
        <FindDataPacksDialog
          world={{ id: "W", name: "W", linked: true }}
          profile={{ ...profile(), running: 0 }}
          onClose={() => undefined}
        />
      </QueryClientProvider>,
    );
    expect(
      await screen.findByText("Data packs for Minecraft 1.18.2."),
    ).toBeInTheDocument();
    expect(api.invoke).toHaveBeenCalledWith("dataPacks:search", {
      query: "",
      offset: 0,
      worldId: "W",
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Download Terralith" }),
    );
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("dataPacks:install", {
        sourceId: "modrinth",
        projectId: "terralith",
        worldId: "W",
      });
    });
    expect(
      await screen.findByText(/It is in this world now/),
    ).toBeInTheDocument();
  });
});
