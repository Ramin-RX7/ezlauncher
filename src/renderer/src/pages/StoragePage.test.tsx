import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { STORAGE_CATEGORIES, type StorageReport } from "@shared/launcher";
import { createQueryClient } from "../lib/queryClient";
import { mockApi } from "../test/mockApi";
import { StoragePage } from "./StoragePage";

const MB = 1024 * 1024;
const REPORT: StorageReport = {
  totalBytes: 900 * MB,
  scannedAt: "2026-10-02T10:00:00Z",
  categories: STORAGE_CATEGORIES.map((id) => ({
    id,
    bytes: id === "assets" ? 600 * MB : id === "mods" ? 300 * MB : 0,
    files: 1,
  })),
  cleanups: [
    {
      id: "libraryItems",
      bytes: 20 * MB,
      count: 2,
      items: [
        { label: "Old mod", bytes: 15 * MB },
        { label: "Other", bytes: 5 * MB },
      ],
      available: true,
    },
    {
      id: "versions",
      bytes: 0,
      count: 0,
      items: [],
      available: false,
    },
    {
      id: "gameFiles",
      bytes: 0,
      count: 0,
      items: [],
      available: false,
      reason: "unreadable",
    },
  ],
};

describe("StoragePage", () => {
  it("shows sizes, lists items, and cleans the chosen clean-ups after asking", async () => {
    const api = mockApi({
      "storage:scan": () => REPORT,
      "storage:clean": () => ({ freedBytes: 20 * MB, failed: [] }),
    });
    render(
      <QueryClientProvider client={createQueryClient()}>
        <StoragePage />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("900 MB")).toBeInTheDocument();
    expect(
      screen.getByText("Game assets (sounds, languages)"),
    ).toBeInTheDocument();
    expect(screen.getByText("Nothing to clean")).toBeInTheDocument();
    expect(
      screen.getByText(/an installed version can't be read/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Leftover game files" }),
    ).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Show items" }));
    expect(screen.getByText("Old mod")).toBeInTheDocument();

    const clean = screen.getByRole("button", { name: /Clean up selected/ });
    expect(clean).toBeDisabled();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Unused library items" }),
    );
    fireEvent.click(clean);
    expect(await screen.findByText("Free 20 MB?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("storage:clean", [
        "libraryItems",
      ]);
    });
    expect(await screen.findByText("Freed 20 MB.")).toBeInTheDocument();
  });
});
