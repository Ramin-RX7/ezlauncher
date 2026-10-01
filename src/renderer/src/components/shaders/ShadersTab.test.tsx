import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type {
  ProfileInfo,
  ProfileShader,
  ProfileShaders,
} from "@shared/launcher";
import { createQueryClient } from "../../lib/queryClient";
import { profile } from "../../test/fixtures";
import { mockApi } from "../../test/mockApi";
import { ShadersTab } from "./ShadersTab";

const shader = (
  name: string,
  digit: string,
  extra: Partial<ProfileShader> = {},
): ProfileShader => ({
  ref: { kind: "library", sha1: digit.repeat(40) },
  name,
  hasIcon: false,
  ...extra,
});
const complementary = shader("Complementary", "1", { irisTagged: true });
const bsl = shader("BSL", "2");
const oldie = shader("Oldie", "3", { irisTagged: false });

const view = (extra: Partial<ProfileShaders> = {}): ProfileShaders => ({
  active: complementary.ref,
  inProfile: [bsl, complementary],
  available: [oldie],
  notPacks: [],
  iris: "present",
  ...extra,
});

function renderTab(overrides: Partial<ProfileInfo> = {}) {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <ShadersTab profile={{ ...profile(), running: 0, ...overrides }} />
    </QueryClientProvider>,
  );
}

describe("ShadersTab", () => {
  it("shows the active shader, the profile's others, and the library's", async () => {
    mockApi({ "shaders:profile": () => view() });
    renderTab();
    expect(
      await screen.findByRole("radio", { name: /Complementary/ }),
    ).toBeChecked();
    expect(screen.getByRole("radio", { name: /BSL/ })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: /Off/ })).not.toBeChecked();
    expect(screen.getByText("Oldie")).toBeInTheDocument();
    expect(screen.getByText("May not work with Iris")).toBeInTheDocument();
  });

  it("chooses a shader, turns shaders off, and adds one from the library", async () => {
    const api = mockApi({
      "shaders:profile": () => view(),
      "shaders:setActive": () => undefined,
      "shaders:setInProfile": () => undefined,
    });
    renderTab();
    fireEvent.click(await screen.findByRole("radio", { name: /BSL/ }));
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("shaders:setActive", {
        profileId: "p1",
        shader: bsl.ref,
      });
    });
    fireEvent.click(screen.getByRole("radio", { name: /Off/ }));
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("shaders:setActive", {
        profileId: "p1",
        shader: null,
      });
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Add Oldie to this profile" }),
    );
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("shaders:setInProfile", {
        profileId: "p1",
        sha1: "3".repeat(40),
        present: true,
      });
    });
  });

  it("offers to install Iris when the profile doesn't have it", async () => {
    mockApi({
      "shaders:profile": () => view({ iris: "missing" }),
      "mods:library": () => [],
    });
    renderTab();
    fireEvent.click(
      await screen.findByRole("button", { name: "Install Iris" }),
    );
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toHaveValue("iris");
  });

  it("is read-only while the game runs, and explains vanilla profiles", async () => {
    mockApi({
      "shaders:profile": () => view({ locked: "running" }),
    });
    renderTab({ running: 1 });
    expect(await screen.findByRole("radio", { name: /BSL/ })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Add Oldie to this profile" }),
    ).toBeDisabled();
  });

  it("explains that vanilla profiles can't use shaders", async () => {
    mockApi({
      "shaders:profile": () =>
        view({ iris: "noLoader", locked: "noLoader", active: undefined }),
    });
    renderTab({ loader: null });
    expect(
      await screen.findByText(/Shaders need Fabric or Quilt/),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Off/ })).toBeDisabled();
  });
});
