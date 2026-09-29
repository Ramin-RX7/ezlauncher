import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it } from "vitest";
import { createQueryClient } from "../../lib/queryClient";
import { launcherStore } from "../../state/launcherStore";
import { profile, steve } from "../../test/fixtures";
import { mockApi } from "../../test/mockApi";
import { GameLog } from "./GameLog";

const alex = { id: "a2", username: "Alex", uuid: "u2" };
const game = (launchId: string, accountId: string) => ({
  launchId,
  profileId: "p1",
  accountId,
  versionId: "1.18.2",
  pid: 1,
});

beforeEach(() => {
  launcherStore.clearClosed();
  launcherStore.setRunning([]);
});

describe("GameLog", () => {
  it("keeps each game's output in its own tab", async () => {
    mockApi({
      "profiles:list": () => [profile()],
      "account:list": () => [steve, alex],
    });
    render(
      <QueryClientProvider client={createQueryClient()}>
        <GameLog open onToggle={() => undefined} />
      </QueryClientProvider>,
    );
    act(() => {
      launcherStore.gameStarted(game("one", "a1"));
      launcherStore.gameLog({
        launchId: "one",
        profileId: "p1",
        lines: ["steve line"],
      });
      launcherStore.gameStarted(game("two", "a2"));
      launcherStore.gameLog({
        launchId: "two",
        profileId: "p1",
        lines: ["alex line"],
      });
    });
    // The newest game is shown; the other is a tab away.
    expect(
      await screen.findByRole("tab", { name: "Survival · Alex" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("alex line")).toBeInTheDocument();
    expect(screen.queryByText("steve line")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Survival · Steve" }));
    expect(screen.getByText("steve line")).toBeInTheDocument();

    act(() => {
      launcherStore.gameExit({
        launchId: "one",
        profileId: "p1",
        versionId: "1.18.2",
        code: 0,
        crashed: false,
      });
    });
    expect(
      screen.getByRole("tab", { name: /Survival · Steve exited \(0\)/ }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear closed" }));
    expect(screen.queryByRole("tab")).not.toBeInTheDocument(); // one game left: no tabs
    expect(screen.getByText("alex line")).toBeInTheDocument();
  });
});
