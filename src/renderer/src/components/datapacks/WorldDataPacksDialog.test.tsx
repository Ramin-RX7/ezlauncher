import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type {
  ProfileInfo,
  WorldDataPack,
  WorldDataPacks,
} from "@shared/launcher";
import { createQueryClient } from "../../lib/queryClient";
import { profile } from "../../test/fixtures";
import { mockApi } from "../../test/mockApi";
import { WorldDataPacksDialog } from "./WorldDataPacksDialog";

const pack = (
  name: string,
  digit: string,
  extra: Partial<WorldDataPack> = {},
): WorldDataPack => ({
  ref: { kind: "library", sha1: digit.repeat(40) },
  name,
  description: `${name} pack`,
  hasIcon: false,
  compat: "compatible",
  offInGame: false,
  missingFeatures: [],
  ...extra,
});
const terralith = pack("Terralith", "1");
const off = pack("Off", "2", { offInGame: true });
const bundle = pack("Bundle", "3", { missingFeatures: ["minecraft:bundle"] });
const spare = pack("Spare", "4");

const view = (extra: Partial<WorldDataPacks> = {}): WorldDataPacks => ({
  inWorld: [bundle, off, terralith],
  available: [spare],
  notPacks: [],
  ...extra,
});

const WORLD = { id: "New World (1)", name: "My World", linked: true };

function renderDialog(overrides: Partial<ProfileInfo> = {}) {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <WorldDataPacksDialog
        world={WORLD}
        profile={{ ...profile(), running: 0, ...overrides }}
        onClose={() => undefined}
      />
    </QueryClientProvider>,
  );
}

describe("WorldDataPacksDialog", () => {
  it("lists the world's packs with what the game says about them", async () => {
    mockApi({ "dataPacks:world": () => view() });
    renderDialog();
    expect(await screen.findByText("Terralith")).toBeInTheDocument();
    expect(screen.getByText("Data packs of My World")).toBeInTheDocument();
    expect(screen.getByText("Turned off in game")).toBeInTheDocument();
    expect(
      screen.getByText(/Needs experimental features .*minecraft:bundle/),
    ).toBeInTheDocument();
  });

  it("adds a library pack and removes one from the world", async () => {
    const api = mockApi({
      "dataPacks:world": () => view(),
      "dataPacks:setInWorld": () => undefined,
    });
    renderDialog();
    fireEvent.click(
      await screen.findByRole("button", { name: "Add Spare to this world" }),
    );
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("dataPacks:setInWorld", {
        worldId: "New World (1)",
        sha1: "4".repeat(40),
        present: true,
      });
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Terralith from this world" }),
    );
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("dataPacks:setInWorld", {
        worldId: "New World (1)",
        sha1: "1".repeat(40),
        present: false,
      });
    });
  });

  it("is read-only while the profile plays", async () => {
    mockApi({ "dataPacks:world": () => view({ locked: "running" }) });
    renderDialog({ running: 1 });
    expect(
      await screen.findByRole("button", { name: "Add Spare to this world" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Remove Terralith from this world" }),
    ).toBeDisabled();
  });
});
