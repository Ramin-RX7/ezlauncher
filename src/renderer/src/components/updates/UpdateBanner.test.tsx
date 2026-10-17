import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AvailableUpdate, UpdateState } from "@shared/updates";
import { createQueryClient } from "../../lib/queryClient";
import { mockApi } from "../../test/mockApi";
import { UpdateSettings } from "../settings/UpdateSettings";
import { UpdateBanner } from "./UpdateBanner";

const update: AvailableUpdate = {
  version: "0.3.0",
  date: "2026-10-20",
  size: 90 * 1024 * 1024,
  pageUrl: "https://github.com/Ramin-RX7/ezlauncher/releases/tag/v0.3.0",
  notes: [
    {
      version: "0.3.0",
      date: "2026-10-20",
      notes: "### Added\n\n- In-app `updates`\n  - Daily checks",
    },
    { version: "0.2.1", date: "2026-10-10", notes: "### Fixed\n\n- A bug" },
  ],
};
const at = "2026-10-21T10:00:00.000Z";

function renderIt(ui: ReactNode) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      {ui}
    </QueryClientProvider>,
  );
}

describe("UpdateBanner", () => {
  it("offers an available update, shows what's new and downloads it", async () => {
    let state: UpdateState = { status: "available", checkedAt: at, update };
    const api = mockApi({
      "updates:state": () => state,
      "updates:download": () => undefined,
    });
    renderIt(<UpdateBanner />);
    expect(
      await screen.findByText("EZLauncher 0.3.0 is available."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "What's new" }));
    expect(await screen.findByText("Daily checks")).toBeInTheDocument();
    expect(screen.getByText("updates")).toContainHTML("code");
    expect(screen.getByText("A bug")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Update (90 MB)" }));
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("updates:download");
    });

    state = {
      status: "downloading",
      checkedAt: at,
      update,
      received: 45 * 1024 * 1024,
      total: 90 * 1024 * 1024,
    };
    act(() => {
      api.emit("updates:state", state);
    });
    expect(
      await screen.findByText("Downloading EZLauncher 0.3.0… 50%"),
    ).toBeInTheDocument();
  });

  it("restarts into a downloaded update, and says when the launcher is busy", async () => {
    const api = mockApi({
      "updates:state": () => ({ status: "ready", checkedAt: at, update }),
      "updates:install": () => {
        throw Object.assign(new Error("busy"), { code: "UPDATE_BUSY" });
      },
    });
    renderIt(<UpdateBanner />);
    fireEvent.click(await screen.findByRole("button", { name: "Restart now" }));
    expect(api.invoke).toHaveBeenCalledWith("updates:install", {
      restart: true,
    });
    expect(
      await screen.findByText(/Wait for the launcher's downloads/),
    ).toBeInTheDocument();
  });

  it("links to the release page when this copy can't update itself", async () => {
    mockApi({
      "updates:state": () => ({
        status: "available",
        checkedAt: at,
        update: { ...update, blocked: "notWritable" },
      }),
    });
    renderIt(<UpdateBanner />);
    expect(
      await screen.findByText("EZLauncher 0.3.0 is available."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "What's new" }));
    expect(
      await screen.findByRole("link", { name: "Open the download page" }),
    ).toHaveAttribute("href", update.pageUrl);
    expect(
      screen.getByText(/can't write to its own folder/),
    ).toBeInTheDocument();
  });

  it("hides with Later, and shows nothing when up to date", async () => {
    mockApi({
      "updates:state": () => ({ status: "available", checkedAt: at, update }),
    });
    const { unmount } = renderIt(<UpdateBanner />);
    fireEvent.click(await screen.findByRole("button", { name: "Later" }));
    expect(screen.queryByText(/is available/)).toBeNull();
    unmount();

    mockApi({ "updates:state": () => ({ status: "upToDate", checkedAt: at }) });
    renderIt(<UpdateBanner />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("UpdateSettings", () => {
  it("checks by hand and turns the daily check off", async () => {
    let auto = true;
    const api = mockApi({
      "updates:state": () => ({ status: "idle" }),
      "updates:check": () => ({ status: "upToDate", checkedAt: at }),
      "updates:getPrefs": () => ({ autoCheck: auto }),
      "updates:setPrefs": (prefs) => {
        auto = (prefs as { autoCheck: boolean }).autoCheck;
        return { autoCheck: auto };
      },
    });
    renderIt(<UpdateSettings />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Check for updates" }),
    );
    expect(
      await screen.findByText(/You have the newest version/),
    ).toBeInTheDocument();

    const box = await screen.findByRole("checkbox", {
      name: "Check for updates automatically (once a day)",
    });
    await screen.findByRole("checkbox", { checked: true });
    fireEvent.click(box);
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("updates:setPrefs", {
        autoCheck: false,
      });
    });
  });
});
