import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppInfo } from "@shared/ipc";
import { App } from "../App";
import { createQueryClient } from "../lib/queryClient";

const info: AppInfo = {
  version: "0.1.0",
  platform: "win32",
  arch: "x64",
  electron: "44.0.0",
  node: "22.0.0",
};

const invoke = vi.fn();

beforeEach(() => {
  window.location.hash = "";
  invoke.mockReset().mockResolvedValue({ ok: true, value: info });
  window.api = { invoke, on: vi.fn(() => () => undefined) };
});

describe("App shell", () => {
  it("shows navigation and app info loaded over IPC", async () => {
    render(<App queryClient={createQueryClient()} />);

    expect(screen.getByRole("link", { name: "Home" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
    expect(await screen.findByTestId("app-version")).toHaveTextContent(
      "0.1.0 · win32-x64",
    );
    expect(invoke).toHaveBeenCalledWith("app:getInfo");
  });

  it("shows an error message when the IPC call fails", async () => {
    invoke.mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL", message: "nope" },
    });
    const queryClient = createQueryClient();
    queryClient.setDefaultOptions({ queries: { retry: false } });
    render(<App queryClient={queryClient} />);

    expect(
      await screen.findByText("Could not load app info."),
    ).toBeInTheDocument();
  });
});
