import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { DataPackWorld, LibraryPack } from "@shared/launcher";
import { createQueryClient } from "../../lib/queryClient";
import { mockApi } from "../../test/mockApi";
import { AddToWorldsDialog } from "./AddToWorldsDialog";

const PACK: LibraryPack = {
  sha1: "a".repeat(40),
  fileName: "Terralith.zip",
  name: "Terralith",
  description: "",
  hasIcon: false,
  size: 1,
  addedAt: "2026-10-01T00:00:00Z",
  usedBy: ["Old"],
  checked: true,
};
const world = (
  worldId: string,
  profileName: string,
  extra: Partial<DataPackWorld> = {},
): DataPackWorld => ({
  worldId,
  name: worldId,
  profileId: profileName.toLowerCase(),
  profileName,
  hasPack: false,
  busy: false,
  unsupported: false,
  ...extra,
});

function renderDialog() {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <AddToWorldsDialog pack={PACK} onClose={() => undefined} />
    </QueryClientProvider>,
  );
}

describe("AddToWorldsDialog", () => {
  it("adds the pack to the picked worlds and reports the ones that failed", async () => {
    const api = mockApi({
      "dataPacks:worlds": () => [
        world("Old", "Survival", { hasPack: true }),
        world("Castle", "Survival"),
        world("Skyblock", "Modded"),
        world("Busy", "Modded", { busy: true }),
      ],
      "dataPacks:addToWorlds": () => ({
        added: ["Castle"],
        failed: [{ worldId: "Skyblock", code: "GAME_RUNNING" }],
      }),
    });
    renderDialog();
    expect(await screen.findByText("already has it")).toBeInTheDocument();
    expect(screen.getByText("its game is running")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Old/ })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /Busy/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Castle/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Skyblock/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add to 2 worlds" }));
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("dataPacks:addToWorlds", {
        sha1: PACK.sha1,
        worldIds: ["Castle", "Skyblock"],
      });
    });
    expect(
      await screen.findByText(/Not added to: Skyblock/),
    ).toBeInTheDocument();
  });
});
