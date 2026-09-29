import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { ProfileInfo } from "@shared/launcher";
import { createQueryClient } from "../../lib/queryClient";
import { profile } from "../../test/fixtures";
import { mockApi } from "../../test/mockApi";
import { DuplicateProfileDialog } from "./DuplicateProfileDialog";

const worlds = [
  { id: "Survival", name: "Survival", linked: true },
  { id: "Hardcore", name: "Hardcore", linked: true },
];

function renderDialog(p: ProfileInfo = profile()) {
  const api = mockApi({
    "worlds:list": () => worlds,
    "profiles:duplicate": () => ({ ...profile(), id: "p2" }),
  });
  const onDuplicated = vi.fn();
  render(
    <QueryClientProvider client={createQueryClient()}>
      <DuplicateProfileDialog
        profile={p}
        onClose={() => undefined}
        onDuplicated={onDuplicated}
      />
    </QueryClientProvider>,
  );
  return { api, onDuplicated };
}

describe("DuplicateProfileDialog", () => {
  it("doesn't copy worlds unless asked", async () => {
    const { api, onDuplicated } = renderDialog();
    expect(
      await screen.findByRole("checkbox", { name: "Also copy its 2 worlds" }),
    ).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("profiles:duplicate", "p1", {
        copyWorlds: false,
      });
    });
    expect(onDuplicated).toHaveBeenCalledWith(
      expect.objectContaining({ id: "p2" }),
    );
  });

  it("copies the worlds when ticked", async () => {
    const { api } = renderDialog();
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Also copy its 2 worlds" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("profiles:duplicate", "p1", {
        copyWorlds: true,
      });
    });
  });

  it("asks to close the game before copying a running profile's worlds", async () => {
    renderDialog(profile({ running: 1 }));
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Also copy its 2 worlds" }),
    );
    expect(
      screen.getByText("Close the game first to copy its worlds."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Duplicate" })).toBeDisabled();
  });
});
