import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VersionListResult, WorldMapInfo } from "@shared/launcher";
import { createQueryClient } from "../../lib/queryClient";
import { profile } from "../../test/fixtures";
import { mockApi } from "../../test/mockApi";
import { SeedMapDialog } from "./SeedMapDialog";

const versionList: VersionListResult = {
  source: "cache",
  versions: [
    {
      id: "1.21.4",
      type: "release",
      releaseTime: "2024-12-03T00:00:00Z",
      installed: true,
    },
    {
      id: "1.16",
      type: "release",
      releaseTime: "2020-06-23T00:00:00Z",
      installed: false,
    },
  ],
};

function renderDialog(map: WorldMapInfo) {
  mockApi({
    "worlds:mapInfo": () => map,
    "versions:list": () => versionList,
  });
  const open = vi.spyOn(window, "open").mockImplementation(() => null);
  render(
    <QueryClientProvider client={createQueryClient()}>
      <SeedMapDialog
        profile={profile({ gameVersion: "1.21.4", loader: null })}
        world={{ id: "Home", name: "Home", linked: true }}
        onClose={() => undefined}
      />
    </QueryClientProvider>,
  );
  return { open };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SeedMapDialog", () => {
  it("opens Chunkbase at the player's last position by default", async () => {
    const { open } = renderDialog({
      seed: "-42",
      version: "1.21.4",
      worldType: "normal",
      spawn: { dimension: "overworld", x: 0, z: 0 },
      playerFound: true,
      player: { dimension: "nether", x: 114, z: 355 },
    });
    expect(
      await screen.findByRole("radio", { name: /My last position/ }),
    ).toBeChecked();
    expect(
      screen.getByRole("radio", { name: /Where I last died/ }),
    ).toBeDisabled();
    expect(screen.getByText(/No death saved yet/)).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Open in Chunkbase" });
    await vi.waitFor(() => {
      expect(button).toBeEnabled();
    });
    fireEvent.click(button);
    expect(open).toHaveBeenCalledWith(
      "https://www.chunkbase.com/apps/seed-map#seed=-42&platform=java_1_21_4&dimension=nether&x=114&z=355",
    );
  });

  it("falls back to spawn, and uses the Large Biomes map", async () => {
    const { open } = renderDialog({
      seed: "7",
      version: "1.21.4",
      worldType: "largeBiomes",
      spawn: { dimension: "overworld", x: 16, z: -32 },
      playerFound: false,
    });
    expect(
      await screen.findByRole("radio", { name: /World spawn/ }),
    ).toBeChecked();
    expect(
      screen.getAllByText("No player saved in this world yet."),
    ).toHaveLength(3);
    const button = screen.getByRole("button", { name: "Open in Chunkbase" });
    await vi.waitFor(() => {
      expect(button).toBeEnabled();
    });
    fireEvent.click(button);
    expect(open).toHaveBeenCalledWith(
      "https://www.chunkbase.com/apps/seed-map#seed=7&platform=java_1_21_4_lb&dimension=overworld&x=16&z=-32",
    );
  });

  it("opens at the respawn point when chosen", async () => {
    const { open } = renderDialog({
      seed: "1",
      version: "1.21.4",
      worldType: "normal",
      playerFound: true,
      player: { dimension: "nether", x: 5, z: 5 },
      respawn: { dimension: "overworld", x: 2268, z: -665 },
    });
    fireEvent.click(
      await screen.findByRole("radio", { name: /My respawn point/ }),
    );
    expect(screen.getByText("Overworld · X 2268, Z -665")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Open in Chunkbase" });
    await vi.waitFor(() => {
      expect(button).toBeEnabled();
    });
    fireEvent.click(button);
    expect(open).toHaveBeenCalledWith(
      "https://www.chunkbase.com/apps/seed-map#seed=1&platform=java_1_21_4&dimension=overworld&x=2268&z=-665",
    );
  });

  it("explains why a superflat world can't be opened", async () => {
    renderDialog({
      seed: "7",
      version: "1.21.4",
      worldType: "flat",
      playerFound: false,
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(/superflat/);
    expect(
      screen.getByRole("button", { name: "Open in Chunkbase" }),
    ).toBeDisabled();
  });
});
