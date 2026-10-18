import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "../../lib/queryClient";
import { mockApi } from "../../test/mockApi";
import { CopyDiagnostics } from "./CopyDiagnostics";

const setClipboard = (clipboard: {
  writeText: (text: string) => Promise<void>;
}) => {
  Object.defineProperty(navigator, "clipboard", {
    value: clipboard,
    configurable: true,
  });
};
afterEach(() => {
  Reflect.deleteProperty(navigator, "clipboard");
});

function renderIt() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <CopyDiagnostics />
    </QueryClientProvider>,
  );
}

describe("CopyDiagnostics", () => {
  it("copies the report and shows it", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    setClipboard({ writeText });
    mockApi({
      "app:diagnostics": () => "# EZLauncher diagnostics\n- <player>",
    });
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: "Copy diagnostics" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/Copied/);
    expect(writeText).toHaveBeenCalledWith(
      "# EZLauncher diagnostics\n- <player>",
    );
    expect(screen.getByText("Show what was copied")).toBeInTheDocument();
  });

  it("says when the clipboard can't be used", async () => {
    setClipboard({ writeText: () => Promise.reject(new Error("denied")) });
    mockApi({ "app:diagnostics": () => "text" });
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: "Copy diagnostics" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Couldn't copy/);
  });
});
