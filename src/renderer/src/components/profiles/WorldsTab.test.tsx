import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { ProfileInfo, WorldInfo } from "@shared/launcher";
import { createQueryClient } from "../../lib/queryClient";
import { profile } from "../../test/fixtures";
import { mockApi } from "../../test/mockApi";
import { WorldsTab } from "./WorldsTab";

const worlds: WorldInfo[] = [
  {
    id: "Survival",
    name: "Survival",
    linked: true,
    backupCount: 1,
    lastBackupAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  },
  { id: "Creative", name: "Creative", linked: true, backupCount: 0 },
];

function renderTab(
  handlers: Parameters<typeof mockApi>[0] = {},
  p: ProfileInfo = profile(),
) {
  const api = mockApi({
    "worlds:list": () => worlds,
    "profiles:list": () => [p],
    ...handlers,
  });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <WorldsTab profile={p} />
    </QueryClientProvider>,
  );
  return api;
}

describe("WorldsTab backups", () => {
  it("shows when each world was last backed up", async () => {
    renderTab();
    expect(
      await screen.findByText(/Last backup 2 days ago/),
    ).toBeInTheDocument();
    expect(screen.getByText("No backups")).toBeInTheDocument();
  });

  it("backs up one world and says which ones hadn't changed", async () => {
    const api = renderTab({
      "backups:create": () => ({
        created: [],
        unchanged: ["Survival"],
        failed: [],
      }),
    });
    const [first] = await screen.findAllByRole("button", { name: "Back up" });
    fireEvent.click(first!);
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("backups:create", {
        profileId: "p1",
        worldIds: ["Survival"],
      });
    });
    expect(
      await screen.findByText("No changes since the last backup: Survival."),
    ).toBeInTheDocument();
  });

  it("backs up all worlds at once", async () => {
    const api = renderTab({
      "backups:create": () => ({
        created: ["Survival", "Creative"],
        unchanged: [],
        failed: [],
      }),
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Back up all worlds" }),
    );
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("backups:create", {
        profileId: "p1",
      });
    });
    expect(await screen.findByText("Backed up 2 worlds.")).toBeInTheDocument();
  });

  it("can't back up while the game runs", async () => {
    renderTab({}, profile({ running: 1 }));
    expect(
      await screen.findByText("Close the game first to back up its worlds."),
    ).toBeInTheDocument();
    for (const b of screen.getAllByRole("button", { name: /^Back up/ }))
      expect(b).toBeDisabled();
  });

  it("lists a world's backups and restores one as a new world", async () => {
    const api = renderTab({
      "backups:list": () => [
        {
          id: "b1",
          createdAt: "2026-09-28T10:00:00.000Z",
          sizeBytes: 5 * 1024 * 1024,
          worldBytes: 20 * 1024 * 1024,
          reason: "auto",
        },
      ],
      "backups:restore": () => "Survival backup 2026-09-28",
    });
    fireEvent.click(await screen.findByRole("button", { name: "1 backup" }));
    expect(await screen.findByText(/Automatic · 5 MB/)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Restore as a new world" }),
    );
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("backups:restore", {
        profileId: "p1",
        worldId: "Survival",
        backupId: "b1",
      });
    });
    expect(
      await screen.findByText("Restored as “Survival backup 2026-09-28”."),
    ).toBeInTheDocument();
  });

  it("asks before deleting a backup", async () => {
    const api = renderTab({
      "backups:list": () => [
        {
          id: "b1",
          createdAt: "2026-09-28T10:00:00.000Z",
          sizeBytes: 1024,
          worldBytes: 4096,
          reason: "manual",
        },
      ],
      "backups:delete": () => undefined,
    });
    fireEvent.click(await screen.findByRole("button", { name: "1 backup" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete…" }));
    expect(await screen.findByText("Delete this backup?")).toBeInTheDocument();
    expect(api.invoke).not.toHaveBeenCalledWith(
      "backups:delete",
      expect.anything(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("backups:delete", {
        profileId: "p1",
        worldId: "Survival",
        backupId: "b1",
      });
    });
  });
});
