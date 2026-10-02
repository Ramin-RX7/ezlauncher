import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type {
  ModpackPreview,
  ModpackVersion,
  RemotePack,
} from "@shared/launcher";
import { createQueryClient } from "../../lib/queryClient";
import { profile } from "../../test/fixtures";
import { mockApi } from "../../test/mockApi";
import { ImportModpack } from "./ImportModpack";

const PREVIEW: ModpackPreview = {
  token: "t1",
  name: "Fabulously Optimized",
  versionNumber: "15.0.0",
  gameVersion: "26.3",
  loader: "fabric",
  loaderVersion: "0.19.5",
  supported: true,
  files: 45,
  downloadBytes: 20 * 1024 * 1024,
  included: 52,
  includedBytes: 300 * 1024,
  optional: [{ path: "mods/minimap.jar", size: 2048 }],
};

const HITS: RemotePack[] = [
  {
    sourceId: "modrinth",
    projectId: "fo",
    slug: "fabulously-optimized",
    name: "Fabulously Optimized",
    author: "robotkoer",
    pageUrl: "https://modrinth.com/modpack/fabulously-optimized",
    loaders: ["fabric"],
    gameVersions: ["26.3"],
  },
  {
    sourceId: "modrinth",
    projectId: "z",
    slug: "zombies",
    name: "Zombies",
    author: "x",
    pageUrl: "https://modrinth.com/modpack/zombies",
    loaders: ["forge"],
  },
];

const VERSIONS: ModpackVersion[] = [
  {
    versionId: "v-forge",
    versionNumber: "16.0.0",
    channel: "release",
    gameVersions: ["26.3"],
    loaders: ["forge"],
    size: 10,
  },
  {
    versionId: "v15",
    versionNumber: "15.0.0",
    channel: "release",
    gameVersions: ["26.3"],
    loaders: ["fabric"],
    size: 10,
  },
];

function renderImport(onImported = vi.fn()) {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <ImportModpack onImported={onImported} />
    </QueryClientProvider>,
  );
  return onImported;
}

describe("ImportModpack", () => {
  it("reads a picked file, lets optional files be left out, and imports", async () => {
    const api = mockApi({
      "modpacks:pickFile": () => PREVIEW,
      "modpacks:import": () => profile({ id: "new", name: "FO" }),
    });
    const onImported = renderImport();
    fireEvent.click(screen.getByRole("button", { name: /Choose a .mrpack/ }));
    expect(
      await screen.findByText("Fabulously Optimized 15.0.0"),
    ).toBeInTheDocument();
    expect(screen.getByText("Fabric 0.19.5")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /minimap\.jar/ }));
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => {
      expect(onImported).toHaveBeenCalledWith(
        expect.objectContaining({ id: "new" }),
      );
    });
    expect(api.invoke).toHaveBeenCalledWith("modpacks:import", {
      token: "t1",
      name: "Fabulously Optimized",
      skip: ["mods/minimap.jar"],
    });
  });

  it("won't import a Forge pack", async () => {
    mockApi({
      "modpacks:pickFile": () => ({
        ...PREVIEW,
        loader: "forge",
        loaderVersion: "47.2.0",
        supported: false,
      }),
    });
    renderImport();
    fireEvent.click(screen.getByRole("button", { name: /Choose a .mrpack/ }));
    expect(
      await screen.findByText(/needs Forge, which isn't supported yet/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
  });

  it("finds a pack on Modrinth, picks a supported version and reads it", async () => {
    const api = mockApi({
      "modpacks:search": () => ({ hits: HITS, total: 2 }),
      "modpacks:versions": () => VERSIONS,
      "modpacks:inspectRemote": () => PREVIEW,
    });
    renderImport();
    fireEvent.click(screen.getByRole("button", { name: "Find on Modrinth" }));
    expect(
      await screen.findByText("Needs Forge (not supported)"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Choose Zombies" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Choose Fabulously Optimized" }),
    );
    const select = await screen.findByRole("combobox", { name: "Version" });
    await waitFor(() => {
      expect(select).toHaveValue("v15");
    });
    expect(
      screen.getByRole("option", { name: /16\.0\.0.*not supported/ }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(
      await screen.findByText("Fabulously Optimized 15.0.0"),
    ).toBeInTheDocument();
    expect(api.invoke).toHaveBeenCalledWith("modpacks:inspectRemote", {
      sourceId: "modrinth",
      projectId: "fo",
      versionId: "v15",
    });
  });
});
