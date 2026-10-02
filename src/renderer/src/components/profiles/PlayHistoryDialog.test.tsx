import { render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { createQueryClient } from "../../lib/queryClient";
import { profile } from "../../test/fixtures";
import { mockApi } from "../../test/mockApi";
import { PlayHistoryDialog } from "./PlayHistoryDialog";

describe("PlayHistoryDialog", () => {
  it("shows the total and each session", async () => {
    mockApi({
      "profiles:playHistory": () => ({
        totalMs: 2 * 3_600_000 + 5 * 60_000,
        sessions: [
          {
            startedAt: "2026-10-01T18:00:00Z",
            durationMs: 3_600_000 + 5 * 60_000,
            accountName: "Steve",
            quickPlay: { kind: "world", worldId: "Survival" },
          },
          {
            startedAt: "2026-09-30T18:00:00Z",
            durationMs: 3_600_000,
            approx: true,
          },
        ],
      }),
    });
    render(
      <QueryClientProvider client={createQueryClient()}>
        <PlayHistoryDialog profile={profile()} onClose={() => undefined} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("2 h 5 min in all")).toBeInTheDocument();
    expect(screen.getByText("1 h 5 min")).toBeInTheDocument();
    expect(screen.getByText("in Survival")).toBeInTheDocument();
    expect(screen.getByText("about 1 h 0 min")).toBeInTheDocument();
    expect(screen.getByText("Removed account")).toBeInTheDocument();
  });
});
