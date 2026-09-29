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
    fireEvent.click(screen.getByRole("button", { name: "Create profile" }));
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("profiles:create", {
        name: "Modded",
        gameVersion: "1.18.2",
        loader: { id: "quilt" },
        // Everything else uses the global settings.
        memoryMaxMb: null,
        extraJvmArgs: null,
        extraGameArgs: null,
      });
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it("replaces global memory and arguments with the profile's own", async () => {
    const api = setup({
      "profiles:update": (_id, patch) => ({
        ...profile(),
        ...(patch as object),
      }),
    });
    renderEditor({ profile: profile() });
    const [memory, jvm, game] = await screen.findAllByRole("checkbox", {
      name: /Use global setting/,
    });
    fireEvent.click(memory!);
    fireEvent.change(screen.getByLabelText("Maximum memory (MB)"), {
      target: { value: "6144" },
    });
    fireEvent.click(jvm!);
    fireEvent.change(screen.getByLabelText("Extra JVM arguments"), {
      target: { value: '-XX:+UseZGC "-Dname=a b"' },
    });
    fireEvent.click(game!);
    // An empty field means "no extra game arguments", not the global ones.
    fireEvent.change(screen.getByLabelText("Extra game arguments"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith(
        "profiles:update",
        "p1",
        expect.objectContaining({
          memoryMaxMb: 6144,
          extraJvmArgs: ["-XX:+UseZGC", "-Dname=a b"],
          extraGameArgs: [],
        }),
      );
    });
  });

  it("can't save an unclosed quote, and warns about -Xmx in JVM arguments", async () => {
    setup();
    renderEditor({ profile: profile() });
    const [, jvm] = await screen.findAllByRole("checkbox", {
      name: /Use global setting/,
    });
    fireEvent.click(jvm!);
    const field = screen.getByLabelText("Extra JVM arguments");
    fireEvent.change(field, { target: { value: "-Xmx4G" } });
    expect(
      screen.getByText("-Xmx and -Xms are set by Memory; leave them out here."),
    ).toBeInTheDocument();
    fireEvent.change(field, { target: { value: '"-Dopen' } });
    expect(screen.getByText("A quote isn't closed.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("can't be changed while its game runs", async () => {
    setup();
    renderEditor({ profile: profile(), running: true });
    expect(
      await screen.findByText("Close the game first to change this profile."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
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
