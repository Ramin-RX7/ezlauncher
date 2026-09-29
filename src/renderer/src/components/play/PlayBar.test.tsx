import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it } from "vitest";
import type { LoaderInfo, VersionSummary } from "@shared/launcher";
import { createQueryClient } from "../../lib/queryClient";
import { launcherStore } from "../../state/launcherStore";
import { mockApi } from "../../test/mockApi";
import { PlayBar } from "./PlayBar";

const installed: VersionSummary = {
  id: "1.8.9",
  type: "release",
  releaseTime: "2015-12-03T00:00:00Z",
  installed: true,
};
const fresh: VersionSummary = { ...installed, id: "26.3", installed: false };

const loaders: LoaderInfo[] = [
  { id: "fabric", displayName: "Fabric", gameVersions: ["26.3"] },
  { id: "quilt", displayName: "Quilt", gameVersions: null },
];

function renderBar(
  version: VersionSummary,
  props: Partial<Parameters<typeof PlayBar>[0]> = {},
) {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <PlayBar version={version} loaders={loaders} {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  launcherStore.setRunning([]);
});

describe("PlayBar", () => {
  it("says Install & Play for a version that isn't installed", async () => {
    mockApi({
      "account:get": () => ({ id: "a", username: "Steve", uuid: "u" }),
    });
    renderBar(fresh);
    await screen.findByDisplayValue("Steve");
    expect(
      screen.getByRole("button", { name: "Install & Play" }),
    ).toBeEnabled();
  });

  it("disables Play until the username is valid", async () => {
    mockApi({ "account:get": () => null });
    renderBar(installed);
    const button = await screen.findByRole("button", { name: "Play" });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "no spaces!" },
    });
    expect(button).toBeDisabled();
    expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Alex_2" },
    });
    expect(button).toBeEnabled();
  });

  it("saves a new username before launching", async () => {
    const api = mockApi({
      "account:get": () => ({ id: "a", username: "Steve", uuid: "u" }),
      "account:setUsername": (name) => ({
        id: "a",
        username: name as string,
        uuid: "u",
      }),
      "game:launch": (id) => ({
        launchId: "l",
        versionId: id as string,
        pid: 1,
      }),
    });
    renderBar(installed);
    await screen.findByDisplayValue("Steve");
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Alex" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("game:launch", {
        versionId: "1.8.9",
      });
    });
    const calls = api.invoke.mock.calls.map((c) => c[0]);
    expect(calls.indexOf("account:setUsername")).toBeLessThan(
      calls.indexOf("game:launch"),
    );
  });

  it("shows install progress with a cancel button", async () => {
    const api = mockApi({
      "account:get": () => ({ id: "a", username: "Steve", uuid: "u" }),
      "versions:cancel": () => true,
    });
    renderBar(fresh);
    act(() => {
      launcherStore.installState({ versionId: "26.3", status: "running" });
      launcherStore.installProgress({
        versionId: "26.3",
        step: "downloading",
        files: 5,
        totalFiles: 10,
        bytes: 1048576,
        totalBytes: 2097152,
      });
    });
    expect(
      await screen.findByRole("button", { name: "Installing…" }),
    ).toBeDisabled();
    expect(screen.getByText("Downloading game files")).toBeInTheDocument();
    expect(screen.getByText("5 / 10 files · 1.0 / 2.0 MB")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api.invoke).toHaveBeenCalledWith("versions:cancel", "26.3");
  });

  it("disables loaders that don't support the version", async () => {
    mockApi({
      "account:get": () => ({ id: "a", username: "Steve", uuid: "u" }),
    });
    renderBar(installed); // 1.8.9: Fabric lists only 26.3, Quilt's list is unknown
    await screen.findByDisplayValue("Steve");
    expect(screen.getByRole("option", { name: "Vanilla" })).toBeEnabled();
    expect(
      screen.getByRole("option", {
        name: "Fabric (not available for this version)",
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole("option", {
        name: "Quilt (not available for this version)",
      }),
    ).toBeDisabled();
  });

  it("installs a new loader by game version and loader", async () => {
    const api = mockApi({
      "account:get": () => ({ id: "a", username: "Steve", uuid: "u" }),
      "game:launch": () => ({ launchId: "l", versionId: "x", pid: 1 }),
    });
    renderBar({ ...fresh, installed: true }, { loaderId: "fabric" });
    await screen.findByDisplayValue("Steve");
    fireEvent.click(screen.getByRole("button", { name: "Install & Play" }));
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("game:launch", {
        gameVersion: "26.3",
        loaderId: "fabric",
      });
    });
  });

  it("plays an installed loader install by its id, even offline", async () => {
    const api = mockApi({
      "account:get": () => ({ id: "a", username: "Steve", uuid: "u" }),
      "game:launch": () => ({ launchId: "l", versionId: "x", pid: 1 }),
    });
    const fabricInstall: VersionSummary = {
      ...installed,
      id: "fabric-loader-0.19.5-1.8.9",
      loader: { id: "fabric", loaderVersion: "0.19.5", gameVersion: "1.8.9" },
    };
    renderBar(installed, {
      loaders: [{ id: "fabric", displayName: "Fabric", gameVersions: null }],
      loaderId: "fabric",
      installedLoaders: { fabric: fabricInstall },
    });
    await screen.findByDisplayValue("Steve");
    expect(screen.getByRole("option", { name: "Fabric 0.19.5" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("game:launch", {
        versionId: "fabric-loader-0.19.5-1.8.9",
      });
    });
  });

  it("shows a crash message", async () => {
    mockApi({
      "account:get": () => ({ id: "a", username: "Steve", uuid: "u" }),
    });
    renderBar(installed);
    act(() => {
      launcherStore.gameExit({
        launchId: "l",
        versionId: "1.8.9",
        code: 1,
        crashed: true,
      });
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "1.8.9 crashed (exit code 1)",
    );
  });
});
