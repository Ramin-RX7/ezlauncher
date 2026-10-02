import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { createQueryClient } from "../../lib/queryClient";
import { profile } from "../../test/fixtures";
import { mockApi } from "../../test/mockApi";
import { ExportModpackDialog } from "./ExportModpackDialog";

describe("ExportModpackDialog", () => {
  it("exports the ticked entries and says what wasn't on Modrinth", async () => {
    const api = mockApi({
      "modpacks:exportOptions": () => ({
        name: "Survival",
        versionNumber: "1.0.0",
        entries: [
          { name: "config", folder: true, suggested: true },
          { name: "logs", folder: true, suggested: false },
          { name: "mods", folder: true, suggested: true },
        ],
      }),
      "modpacks:export": () => ({
        downloads: 10,
        included: 4,
        unknown: ["mods/custom.jar"],
      }),
    });
    render(
      <QueryClientProvider client={createQueryClient()}>
        <ExportModpackDialog profile={profile()} onClose={() => undefined} />
      </QueryClientProvider>,
    );
    expect(
      await screen.findByRole("checkbox", { name: "logs" }),
    ).not.toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "config" }));
    fireEvent.click(screen.getByRole("button", { name: "Export…" }));
    expect(
      await screen.findByText(/10 linked from Modrinth, 4 inside the file/),
    ).toBeInTheDocument();
    expect(screen.getByText("mods/custom.jar")).toBeInTheDocument();
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("modpacks:export", {
        profileId: "p1",
        name: "Survival",
        versionNumber: "1.0.0",
        include: ["mods"],
      });
    });
  });
});
