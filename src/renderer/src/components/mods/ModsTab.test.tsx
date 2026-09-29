import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type {
  LibraryMod,
  ProfileInfo,
  ValidationReport,
} from "@shared/launcher";
import { createQueryClient } from "../../lib/queryClient";
import { profile } from "../../test/fixtures";
import { mockApi } from "../../test/mockApi";
import { ModsTab } from "./ModsTab";

const mod = (overrides: Partial<LibraryMod>): LibraryMod => ({
  sha1: "a".repeat(40),
  fileName: "m.jar",
  name: "Mod",
  loaders: ["fabric"],
  hasIcon: false,
  addedAt: "2026-09-01T00:00:00Z",
  usedBy: [],
  enabled: false,
  checked: true,
  compat: { status: "compatible" },
  ...overrides,
});

const library: LibraryMod[] = [
  mod({ sha1: "1".repeat(40), name: "Sodium", version: "0.4.1" }),
  mod({
    sha1: "2".repeat(40),
    name: "JEI",
    loaders: ["forge"],
    compat: {
      status: "incompatible",
      reason: { code: "loader", loaders: ["forge"] },
    },
  }),
  mod({
    sha1: "3".repeat(40),
    name: "Newer Mod",
    compat: {
      status: "incompatible",
      reason: { code: "mcVersion", range: "1.20.1" },
    },
  }),
  mod({
    sha1: "4".repeat(40),
    name: "Mystery",
    loaders: [],
    compat: { status: "unknown" },
  }),
];

function renderTab(p: ProfileInfo = profile()) {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <ModsTab profile={p} />
    </QueryClientProvider>,
  );
}

describe("ModsTab", () => {
  it("shows why incompatible mods can't be ticked", async () => {
    mockApi({ "mods:library": () => library });
    renderTab();
    const jei = await screen.findByRole("checkbox", {
      name: "Use JEI in this profile",
    });
    expect(jei).toBeDisabled();
    expect(screen.getByText("Forge only")).toBeInTheDocument();
    expect(screen.getByText("Needs 1.20.1")).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Use Mystery in this profile" }),
    ).toBeEnabled();
    expect(screen.getByText("Compatibility unknown")).toBeInTheDocument();
  });

  it("ticks a mod for the profile", async () => {
    const api = mockApi({
      "mods:library": () => library,
      "mods:setEnabled": () => ({ disabled: [] }),
    });
    renderTab();
    fireEvent.click(
      await screen.findByRole("checkbox", {
        name: "Use Sodium in this profile",
      }),
    );
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("mods:setEnabled", {
        profileId: "p1",
        sha1: "1".repeat(40),
        enabled: true,
      });
    });
  });

  it("adds dropped jars and enables them in the profile", async () => {
    const api = mockApi({
      "mods:library": () => [],
      "mods:addFiles": () => ({ added: 1, existing: 0, failed: [] }),
    });
    renderTab();
    await screen.findByText(/No mods yet/);
    const jar = new File(["x"], "lithium.jar");
    const notes = new File(["x"], "notes.txt");
    fireEvent.drop(screen.getByText(/No mods yet/), {
      dataTransfer: { files: [jar, notes], types: ["Files"] },
    });
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("mods:addFiles", {
        paths: ["/dropped/lithium.jar"],
        profileId: "p1",
      });
    });
  });

  it("opens the profile's mods folder", async () => {
    const api = mockApi({
      "mods:library": () => [],
      "profiles:openFolder": () => undefined,
    });
    renderTab();
    fireEvent.click(
      await screen.findByRole("button", { name: "Open mods folder" }),
    );
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith(
        "profiles:openFolder",
        "p1",
        "mods",
      );
    });
  });

  it("explains that vanilla profiles can't load mods", () => {
    mockApi({});
    renderTab(profile({ loader: null }));
    expect(
      screen.getByText(/Vanilla profiles can't load mods/),
    ).toBeInTheDocument();
  });

  it("nests enabled dependencies under the mods that need them, locked", async () => {
    mockApi({
      "mods:library": () => [api, sodium, indium, lithium],
      "mods:validate": () =>
        report({ [API]: [SODIUM, INDIUM], [SODIUM]: [INDIUM] }),
    });
    renderTab();
    // Only Indium (nothing needs it) and the disabled Lithium have a checkbox.
    expect(
      await screen.findByRole("checkbox", {
        name: "Use Indium in this profile",
      }),
    ).toBeChecked();
    expect(
      screen.queryByRole("checkbox", {
        name: "Use Fabric API in this profile",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: "Use Sodium in this profile" }),
    ).not.toBeInTheDocument();
    // Fabric API shows under Indium and again under Sodium, with who needs it.
    expect(
      screen.getAllByRole("img", {
        name: "Fabric API is needed by Indium, Sodium. Untick those first.",
      }),
    ).toHaveLength(2);
    expect(screen.getAllByText(/Required by Indium$/)).toHaveLength(1);
    expect(
      screen.getByRole("checkbox", { name: "Use Lithium in this profile" }),
    ).not.toBeChecked();
  });

  it("says which dependencies were disabled with an unticked mod", async () => {
    mockApi({
      "mods:library": () => [api, sodium, indium],
      "mods:validate": () => report({ [API]: [SODIUM], [SODIUM]: [INDIUM] }),
      "mods:setEnabled": () => ({ disabled: [SODIUM, API] }),
    });
    renderTab();
    fireEvent.click(
      await screen.findByRole("checkbox", {
        name: "Use Indium in this profile",
      }),
    );
    expect(
      await screen.findByText(
        "Also disabled, as nothing else needs them: Sodium, Fabric API",
      ),
    ).toBeInTheDocument();
  });

  it("shows one row per mod, with a version picker", async () => {
    const api = mockApi({
      "mods:library": () => [
        mod({
          sha1: "5".repeat(40),
          modId: "sodium",
          name: "Sodium",
          version: "0.4.1",
        }),
        mod({
          sha1: "6".repeat(40),
          modId: "sodium",
          name: "Sodium",
          version: "0.5.0",
          enabled: true,
        }),
      ],
      "mods:validate": () => report({}),
      "mods:setEnabled": () => ({ disabled: [] }),
    });
    renderTab();
    const picker = await screen.findByRole("combobox", {
      name: "Version of Sodium",
    });
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(picker).toHaveValue("6".repeat(40));
    expect(
      screen.getByRole("option", { name: "0.5.0 (enabled)" }),
    ).toBeInTheDocument();
    // Picking another version of an enabled mod swaps it in.
    fireEvent.change(picker, { target: { value: "5".repeat(40) } });
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("mods:setEnabled", {
        profileId: "p1",
        sha1: "5".repeat(40),
        enabled: true,
      });
    });
  });

  it("shows the check summary and problems, with a Download fix", async () => {
    const api = mockApi({
      "mods:library": () => [sodium],
      "mods:validate": () => ({
        ...report({}),
        issues: [
          {
            severity: "error",
            code: "missingDep",
            depId: "fabric-api",
            range: "*",
            name: "Fabric API",
            modSha1: SODIUM,
            fix: { kind: "download", query: "fabric-api" },
          },
        ],
        errorCount: 1,
      }),
      "mods:findRemote": () => [],
    });
    renderTab();
    expect(await screen.findByText("1 error")).toBeInTheDocument();
    expect(screen.getByText("Needs Fabric API")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("mods:findRemote", {
        profileId: "p1",
        query: "fabric-api",
      });
    });
    expect(screen.getByRole("searchbox", { name: "Mod name" })).toHaveValue(
      "fabric-api",
    );
  });

  it("checks every file on Check mods, and offers Re-download for damaged ones", async () => {
    const api = mockApi({
      "mods:library": () => [sodium],
      "mods:validate": (options) =>
        (options as { full?: boolean }).full
          ? {
              ...report({}),
              issues: [
                {
                  severity: "error",
                  code: "damaged",
                  reason: "sha1",
                  modSha1: SODIUM,
                  fix: { kind: "redownload" },
                },
              ],
              errorCount: 1,
            }
          : report({}),
      "mods:redownload": () => undefined,
    });
    renderTab();
    expect(await screen.findByText("No problems found.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check mods" }));
    expect(
      await screen.findByText("The file is damaged (its contents changed)"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Re-download" }));
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("mods:redownload", SODIUM);
    });
  });
});

const API = "a1".repeat(20);
const SODIUM = "b2".repeat(20);
const INDIUM = "c3".repeat(20);
const api = mod({
  sha1: API,
  modId: "fabric-api",
  name: "Fabric API",
  enabled: true,
});
const sodium = mod({
  sha1: SODIUM,
  modId: "sodium",
  name: "Sodium",
  enabled: true,
});
const indium = mod({
  sha1: INDIUM,
  modId: "indium",
  name: "Indium",
  enabled: true,
});
const lithium = mod({
  sha1: "d4".repeat(20),
  modId: "lithium",
  name: "Lithium",
});

function report(requiredBy: Record<string, string[]>): ValidationReport {
  return { issues: [], requiredBy, errorCount: 0, warningCount: 0 };
}
