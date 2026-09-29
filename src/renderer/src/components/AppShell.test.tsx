import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { VersionListResult } from "@shared/launcher";
import { App } from "../App";
import { createQueryClient } from "../lib/queryClient";
import { mockApi } from "../test/mockApi";

const list: VersionListResult = {
  source: "cache",
  fetchedAt: "2026-09-01T10:00:00.000Z",
  latest: { release: "26.3", snapshot: "26.4-snapshot-1" },
  versions: [
    {
      id: "26.4-snapshot-1",
      type: "snapshot",
      releaseTime: "2026-09-22T00:00:00Z",
      installed: false,
    },
    {
      id: "26.3",
      type: "release",
      releaseTime: "2026-09-01T00:00:00Z",
      installed: true,
    },
    {
      id: "1.8.9",
      type: "release",
      releaseTime: "2015-12-03T00:00:00Z",
      installed: false,
    },
  ],
};

beforeEach(() => {
  window.location.hash = "";
  localStorage.clear();
});

describe("App", () => {
  it("shows the first-run setup when no data folder is chosen", async () => {
    mockApi({
      "setup:getState": () => ({
        dataDir: null,
        suggestedDir: "/home/me/ezlauncher",
      }),
    });
    render(<App queryClient={createQueryClient()} />);
    expect(
      await screen.findByText("Welcome to ezlauncher"),
    ).toBeInTheDocument();
    expect(screen.getByText("/home/me/ezlauncher")).toBeInTheDocument();
  });

  it("shows navigation, the version list and the play bar once set up", async () => {
    mockApi({
      "setup:getState": () => ({ dataDir: "/data", suggestedDir: "/data" }),
      "versions:list": () => list,
      "account:get": () => ({ id: "a", username: "Steve", uuid: "u" }),
      "game:running": () => [],
    });
    render(<App queryClient={createQueryClient()} />);

    expect(
      await screen.findByRole("link", { name: "Home" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
    // The latest release is selected by default and it's installed: the button says Play.
    expect(await screen.findByRole("button", { name: "Play" })).toBeEnabled();
    expect(screen.getByText("Installed")).toBeInTheDocument();
    expect(screen.getByText(/Version list from/)).toBeInTheDocument();
  });
});
