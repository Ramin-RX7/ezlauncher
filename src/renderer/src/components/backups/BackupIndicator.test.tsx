import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { launcherStore } from "../../state/launcherStore";
import { mockApi } from "../../test/mockApi";
import { BackupIndicator } from "./BackupIndicator";

const progress = {
  profileId: "p1",
  worldId: "Survival",
  worldName: "Survival",
  index: 2,
  total: 3,
  bytes: 50,
  totalBytes: 100,
};

afterEach(() => {
  act(() => {
    launcherStore.backupState({
      status: "done",
      profileId: "p1",
      beforeStart: false,
    });
  });
});

describe("BackupIndicator", () => {
  it("is hidden when nothing is being backed up", () => {
    render(<BackupIndicator />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows which world, the progress, and Cancel", () => {
    const api = mockApi({ "backups:cancel": () => undefined });
    render(<BackupIndicator />);
    act(() => {
      launcherStore.backupState({
        status: "running",
        profileId: "p1",
        beforeStart: false,
      });
      launcherStore.backupProgress({ ...progress, beforeStart: false });
    });
    expect(screen.getByText("Backing up Survival (2/3)")).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", { name: "Backup progress" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api.invoke).toHaveBeenCalledWith("backups:cancel");
  });

  it("offers Skip before the game starts, and goes away when done", () => {
    render(<BackupIndicator />);
    act(() => {
      launcherStore.backupProgress({ ...progress, beforeStart: true });
    });
    expect(screen.getByRole("button", { name: "Skip" })).toBeInTheDocument();
    act(() => {
      launcherStore.backupState({
        status: "done",
        profileId: "p1",
        beforeStart: true,
      });
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
