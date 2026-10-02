import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { ModpackUpdatePlan } from "@shared/launcher";
import { createQueryClient } from "../../lib/queryClient";
import { profile } from "../../test/fixtures";
import { mockApi } from "../../test/mockApi";
import { UpdateModpackDialog } from "./UpdateModpackDialog";

const PACK = profile({
  modpack: {
    name: "FO",
    versionNumber: "1.0.0",
    sourceId: "modrinth",
    projectId: "fo",
    versionId: "v1",
  },
});

const PLAN: ModpackUpdatePlan = {
  token: "u1",
  from: "1.0.0",
  to: "2.0.0",
  gameVersion: { from: "1.18.2", to: "1.18.2" },
  loader: { from: "fabric", to: "fabric" },
  supported: true,
  items: [
    { path: "mods/new.jar", action: "add" },
    { path: "mods/old.jar", action: "remove" },
    { path: "config/a.json", action: "changed" },
    { path: "config/b.json", action: "changed" },
  ],
};

describe("UpdateModpackDialog", () => {
  it("shows what changes and replaces only the chosen files of the user's", async () => {
    const api = mockApi({
      "modpacks:updateVersions": () => [
        {
          versionId: "v2",
          versionNumber: "2.0.0",
          channel: "release",
          gameVersions: ["1.18.2"],
          loaders: ["fabric"],
          size: 1,
        },
        {
          versionId: "v1",
          versionNumber: "1.0.0",
          channel: "release",
          gameVersions: ["1.18.2"],
          loaders: ["fabric"],
          size: 1,
        },
      ],
      "modpacks:planUpdate": () => PLAN,
      "modpacks:applyUpdate": () => ({
        added: 1,
        updated: 1,
        removed: 1,
        backup: "D:/x/backup.zip",
      }),
      "profiles:list": () => [PACK],
    });
    render(
      <QueryClientProvider client={createQueryClient()}>
        <UpdateModpackDialog profile={PACK} onClose={() => undefined} />
      </QueryClientProvider>,
    );
    expect(
      await screen.findByRole("option", {
        name: /1\.0\.0 · 1\.18\.2 · installed/,
      }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "See what changes" }));
    expect(await screen.findByText("1.0.0 → 2.0.0")).toBeInTheDocument();
    expect(screen.getByText("1 new file")).toBeInTheDocument();
    expect(screen.getByText("1 file removed")).toBeInTheDocument();
    expect(api.invoke).toHaveBeenCalledWith("modpacks:planUpdate", {
      profileId: "p1",
      versionId: "v2",
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Replace my config/b.json" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    expect(
      await screen.findByText(/1 added, 1 replaced, 1 removed/),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("modpacks:applyUpdate", {
        token: "u1",
        replace: ["config/b.json"],
      });
    });
  });
});
