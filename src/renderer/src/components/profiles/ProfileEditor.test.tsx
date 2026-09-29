import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { createQueryClient } from "../../lib/queryClient";
import { loaders, profile, settings, versionList } from "../../test/fixtures";
import { mockApi } from "../../test/mockApi";
import { ProfileEditor } from "./ProfileEditor";

function setup(handlers: Parameters<typeof mockApi>[0] = {}) {
  return mockApi({
    "versions:list": () => versionList,
    "loaders:list": () => loaders,
    "settings:get": () => settings(),
    ...handlers,
  });
}

function renderEditor(
  props: Partial<Parameters<typeof ProfileEditor>[0]> = {},
) {
  const onSaved = vi.fn();
  render(
    <QueryClientProvider client={createQueryClient()}>
      <ProfileEditor onSaved={onSaved} {...props} />
    </QueryClientProvider>,
  );
  return onSaved;
}

describe("ProfileEditor", () => {
  it("creates a profile from name, version and loader", async () => {
    const api = setup({
      "profiles:create": (input) => ({ ...profile(), ...(input as object) }),
    });
    const onSaved = renderEditor();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "  Modded  " },
    });
    fireEvent.click(await screen.findByText("1.18.2"));
    fireEvent.change(screen.getByLabelText("Mod loader"), {
      target: { value: "quilt" },
    });
    fireEvent.change(screen.getByLabelText("Extra JVM arguments"), {
      target: { value: "-XX:+UseG1GC\n\n -Dx=1 " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create profile" }));
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("profiles:create", {
        name: "Modded",
        gameVersion: "1.18.2",
        loader: { id: "quilt" },
        memoryMaxMb: null,
        extraJvmArgs: ["-XX:+UseG1GC", "-Dx=1"],
      });
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it("disables loaders that don't support the picked version", async () => {
    setup();
    renderEditor();
    fireEvent.click(await screen.findByText("1.12.2"));
    expect(
      screen.getByRole("option", {
        name: "Fabric (not available for this version)",
      }),
    ).toBeDisabled();
  });

  it("warns before changing the version or loader of a profile", async () => {
    const api = setup({
      "profiles:update": (_id, patch) => ({
        ...profile(),
        ...(patch as object),
      }),
    });
    renderEditor({ profile: profile() });
    fireEvent.click(await screen.findByText("26.3"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByText(
        /Changing the version or loader can break this profile/,
      ),
    ).toBeInTheDocument();
    expect(api.invoke).not.toHaveBeenCalledWith(
      "profiles:update",
      expect.anything(),
      expect.anything(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Change it" }));
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith(
        "profiles:update",
        "p1",
        expect.objectContaining({ gameVersion: "26.3" }),
      );
    });
  });

  it("saves a rename without the warning", async () => {
    const api = setup({
      "profiles:update": (_id, patch) => ({
        ...profile(),
        ...(patch as object),
      }),
    });
    renderEditor({ profile: profile() });
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Renamed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith(
        "profiles:update",
        "p1",
        expect.objectContaining({ name: "Renamed" }),
      );
    });
    expect(
      screen.queryByText(/can break this profile/),
    ).not.toBeInTheDocument();
  });
});
