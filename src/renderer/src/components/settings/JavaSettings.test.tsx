import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { JavaListResult } from "@shared/launcher";
import { createQueryClient } from "../../lib/queryClient";
import { mockApi } from "../../test/mockApi";
import { JavaSettings } from "./JavaSettings";

const list: JavaListResult = {
  offline: false,
  runtimes: [
    {
      component: "java-runtime-delta",
      versionName: "21.0.7",
      major: 21,
      installed: false,
      available: true,
      usedBy: [],
    },
    {
      component: "jre-legacy",
      versionName: "8u51",
      major: 8,
      installed: true,
      available: true,
      sizeBytes: 90 * 1024 * 1024,
      usedBy: ["1.12.2"],
    },
  ],
  system: [
    {
      home: "C:\\Program Files\\Java\\jdk-17",
      executable: "C:\\Program Files\\Java\\jdk-17\\bin\\java.exe",
      version: "17.0.2",
      major: 17,
      vendor: "Oracle Corporation",
    },
  ],
};

function renderJava() {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <JavaSettings />
    </QueryClientProvider>,
  );
}

describe("JavaSettings", () => {
  it("lists launcher runtimes and Java found on the computer", async () => {
    mockApi({ "java:list": () => list });
    renderJava();
    expect(await screen.findByText("Java 21")).toBeInTheDocument();
    expect(screen.getByText("Used by 1.12.2")).toBeInTheDocument();
    expect(screen.getByText(/90 MB/)).toBeInTheDocument();
    expect(screen.getByText("Java 17")).toBeInTheDocument();
    expect(screen.getByText("Oracle Corporation")).toBeInTheDocument();
  });

  it("installs a runtime", async () => {
    const api = mockApi({
      "java:list": () => list,
      "java:install": () => undefined,
    });
    renderJava();
    fireEvent.click(await screen.findByRole("button", { name: "Install" }));
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith(
        "java:install",
        "java-runtime-delta",
      );
    });
  });

  it("asks before removing, naming the versions that use it", async () => {
    const api = mockApi({
      "java:list": () => list,
      "java:remove": () => undefined,
    });
    renderJava();
    fireEvent.click(await screen.findByRole("button", { name: "Remove…" }));
    expect(
      await screen.findByText(/Used by 1\.12\.2\. Its files/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Remove…" }).at(-1)!);
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("java:remove", "jre-legacy");
    });
  });
});
