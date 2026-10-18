import { QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ModUpdateCheck } from "@shared/launcher";
import { createQueryClient } from "../../lib/queryClient";
import { profile } from "../../test/fixtures";
import { mockApi } from "../../test/mockApi";
import { ModUpdatesDialog } from "./ModUpdatesDialog";

const check: ModUpdateCheck = {
  updates: [
    {
      sha1: "s1",
      name: "Sodium",
      fromVersion: "0.4.1",
      toVersion: "0.5.0",
      channel: "release",
      published: "2026-10-01T00:00:00Z",
      size: 2 * 1024 * 1024,
      changelog: "- Faster chunks",
      pageUrl: "https://modrinth.com/mod/sodium",
      fromPack: false,
    },
    {
      sha1: "i1",
      name: "Iris",
      fromVersion: "1.7.0",
      toVersion: "1.8.0",
      channel: "release",
      size: 1024 * 1024,
      pageUrl: "https://modrinth.com/mod/iris",
      fromPack: true,
    },
  ],
  upToDate: 4,
  unknown: [{ name: "My own mod" }],
};

function renderIt(running = 0) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <ModUpdatesDialog
        profile={profile({ running })}
        onClose={() => undefined}
      />
    </QueryClientProvider>,
  );
}

describe("ModUpdatesDialog", () => {
  it("lists updates, leaves mod pack mods unticked, and updates the picked ones", async () => {
    const api = mockApi({
      "mods:checkUpdates": () => check,
      "mods:applyUpdates": () => ({
        updated: [{ name: "Sodium", from: "0.4.1", to: "0.5.0" }],
        failed: [],
      }),
    });
    renderIt();
    const sodium = await screen.findByRole("checkbox", { name: /Sodium/ });
    expect(sodium).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Iris/ })).not.toBeChecked();
    expect(screen.getByText(/Part of the mod pack/)).toBeInTheDocument();
    expect(screen.getByText(/My own mod/)).toBeInTheDocument();
    expect(screen.getByText("Faster chunks")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Update 1 mod" }));
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("mods:applyUpdates", {
        profileId: "p1",
        sha1s: ["s1"],
      });
    });
    expect(await screen.findByText("Updated 1 mod.")).toBeInTheDocument();
    expect(screen.getByText("Sodium: 0.4.1 → 0.5.0")).toBeInTheDocument();
  });

  it("shows progress and lets the user cancel", async () => {
    let finish: (v: unknown) => void = () => undefined;
    const api = mockApi({
      "mods:checkUpdates": () => check,
      "mods:applyUpdates": () =>
        new Promise((resolve) => {
          finish = resolve;
        }) as never,
      "mods:cancelBulk": () => undefined,
    });
    renderIt();
    fireEvent.click(
      await screen.findByRole("button", { name: "Update 1 mod" }),
    );
    act(() => {
      api.emit("mods:bulkProgress", {
        files: 0,
        totalFiles: 1,
        bytes: 50,
        totalBytes: 100,
      });
    });
    expect(
      await screen.findByRole("progressbar", {
        name: /Downloading the updates/,
      }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api.invoke).toHaveBeenCalledWith("mods:cancelBulk");
    finish({ updated: [], failed: [] });
  });

  it("says when everything is up to date, and can't update while playing", async () => {
    mockApi({
      "mods:checkUpdates": () => ({ updates: [], upToDate: 3, unknown: [] }),
    });
    const { unmount } = renderIt();
    expect(
      await screen.findByText("All mods that can be checked are up to date."),
    ).toBeInTheDocument();
    unmount();

    mockApi({ "mods:checkUpdates": () => check });
    renderIt(1);
    expect(
      await screen.findByRole("button", { name: "Update 1 mod" }),
    ).toBeDisabled();
  });
});
