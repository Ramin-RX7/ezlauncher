import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { VersionListResult } from "@shared/launcher";
import { createQueryClient } from "../../lib/queryClient";
import { loaders, versionList } from "../../test/fixtures";
import { mockApi } from "../../test/mockApi";
import { VersionRefresh } from "./VersionRefresh";

function refreshWith(refreshError: string) {
  mockApi({
    "versions:list": (options) =>
      (options as { refresh?: boolean }).refresh
        ? ({ ...versionList, refreshError } satisfies VersionListResult)
        : versionList,
    "loaders:list": () => loaders,
  });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <VersionRefresh />
    </QueryClientProvider>,
  );
}

describe("VersionRefresh", () => {
  it("says there's no internet only when Mojang can't be reached", async () => {
    refreshWith("OFFLINE");
    await screen.findByText(/^Version list from/);
    fireEvent.click(
      screen.getByRole("button", { name: "Check for new versions" }),
    );
    expect(
      await screen.findByText(
        "No internet connection. Still showing the saved list.",
      ),
    ).toBeInTheDocument();
  });

  it("names other failures as a failed check", async () => {
    refreshWith("BAD_RESPONSE");
    await screen.findByText(/^Version list from/);
    fireEvent.click(
      screen.getByRole("button", { name: "Check for new versions" }),
    );
    expect(
      await screen.findByText(
        "Couldn't check for new versions right now. Still showing the saved list.",
      ),
    ).toBeInTheDocument();
  });
});
