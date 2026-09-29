import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { LauncherSettings } from "@shared/launcher";
import { createQueryClient } from "../../lib/queryClient";
import { settings } from "../../test/fixtures";
import { mockApi } from "../../test/mockApi";
import { BackupSettings } from "./BackupSettings";

function renderSettings(s: LauncherSettings = settings()) {
  const api = mockApi({
    "backups:summary": () => ({
      count: 4,
      totalBytes: 12 * 1024 * 1024,
      orphans: { worlds: 1, count: 2, totalBytes: 3 * 1024 * 1024 },
    }),
    "backups:deleteOrphans": () => 2,
  });
  const onChange = vi.fn();
  render(
    <QueryClientProvider client={createQueryClient()}>
      <BackupSettings settings={s} onChange={onChange} />
    </QueryClientProvider>,
  );
  return { api, onChange };
}

describe("BackupSettings", () => {
  it("turns automatic backups on, and asks when only once they're on", () => {
    const { onChange } = renderSettings();
    expect(screen.queryByText("When")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "On every launch" }));
    expect(onChange).toHaveBeenCalledWith({ backupAuto: "launch" });
  });

  it("picks before-start or after-exit, and the interval", () => {
    const { onChange } = renderSettings(
      settings({ backupAuto: "interval", backupIntervalDays: 7 }),
    );
    fireEvent.click(
      screen.getByRole("radio", {
        name: "Before the game starts (Play waits for it)",
      }),
    );
    expect(onChange).toHaveBeenCalledWith({ backupWhen: "beforeStart" });
    const days = screen.getByRole("spinbutton", { name: "Back up every" });
    fireEvent.change(days, { target: { value: "3" } });
    fireEvent.blur(days);
    expect(onChange).toHaveBeenCalledWith({ backupIntervalDays: 3 });
  });

  it("turns a retention limit off and on, and refuses out-of-range values", () => {
    const { onChange } = renderSettings();
    fireEvent.click(screen.getByRole("checkbox", { name: "Keep at most" }));
    expect(onChange).toHaveBeenCalledWith({ backupKeepCount: null });
    const days = screen.getByRole("spinbutton", {
      name: "Delete backups older than",
    });
    fireEvent.change(days, { target: { value: "0" } });
    fireEvent.blur(days);
    expect(onChange).not.toHaveBeenCalledWith({ backupKeepDays: 0 });
    expect(days).toHaveValue(30);
  });

  it("shows the totals and deletes backups of deleted worlds", async () => {
    const { api } = renderSettings();
    expect(await screen.findByText("4 backups, 12 MB")).toBeInTheDocument();
    expect(
      screen.getByText("Backups of 1 deleted worlds: 2 (3 MB)"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete them" }));
    expect(await screen.findByText("Deleted 2 backups.")).toBeInTheDocument();
    expect(api.invoke).toHaveBeenCalledWith("backups:deleteOrphans");
  });
});
