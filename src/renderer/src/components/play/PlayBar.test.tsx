import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  LaunchRequest,
  ProfileInfo,
  ValidationReport,
} from "@shared/launcher";
import { createQueryClient } from "../../lib/queryClient";
import { launcherStore } from "../../state/launcherStore";
import {
  libraryMod,
  loaders,
  profile,
  settings,
  steve,
} from "../../test/fixtures";
import { mockApi } from "../../test/mockApi";
import { PlayBar } from "./PlayBar";

function renderBar(p: ProfileInfo | undefined, profiles: ProfileInfo[] = []) {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <PlayBar profile={p} profiles={profiles} />
    </QueryClientProvider>,
  );
}

const game = {
  launchId: "l",
  profileId: "p1",
  accountId: "a1",
  versionId: "fabric-loader-0.19.5-1.18.2",
  pid: 1,
};

const SODIUM = "1".repeat(40);
const INDIUM = "2".repeat(40);
const library = [
  libraryMod({ sha1: SODIUM, name: "Sodium", enabled: true }),
  libraryMod({ sha1: INDIUM, name: "Indium", enabled: true }),
];
const report: ValidationReport = {
  issues: [
    {
      severity: "error",
      code: "mcVersion",
      range: "1.20.x",
      gameVersion: "1.18.2",
      modSha1: SODIUM,
    },
  ],
  requiredBy: { [SODIUM]: [INDIUM] },
  errorCount: 1,
  warningCount: 0,
};

async function clickPlay() {
  await screen.findByText("1.18.2 · Fabric");
  const play = screen.getByRole("button", { name: "Play" });
  await waitFor(() => {
    expect(play).toBeEnabled();
  });
  fireEvent.click(play);
}

beforeEach(() => {
  launcherStore.setRunning([]);
  launcherStore.dismissExit();
});

describe("PlayBar", () => {
  it("needs a profile and an account, and says which is missing", async () => {
    mockApi({
      "account:list": () => [steve],
      "settings:get": () => settings(),
      "loaders:list": () => loaders,
    });
    renderBar(undefined);
    expect(
      await screen.findByText("Pick a profile and an account to play."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Install & Play/ }),
    ).toBeDisabled();
  });

  it("asks for an account when only the profile is picked", async () => {
    mockApi({
      "account:list": () => [steve],
      "settings:get": () => settings({ selectedProfileId: "p1" }),
      "loaders:list": () => loaders,
    });
    renderBar(profile());
    expect(
      await screen.findByText("Create or pick an account to play."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
    // The account has to be chosen explicitly.
    expect(
      await screen.findByRole("combobox", { name: "Account" }),
    ).toHaveValue("");
  });

  it("launches the profile with the selected account", async () => {
    const api = mockApi({
      "account:list": () => [steve],
      "settings:get": () => settings({ selectedAccountId: "a1" }),
      "loaders:list": () => loaders,
      "game:launch": () => ({ status: "started", game, warnings: 0 }),
    });
    renderBar(profile());
    await screen.findByText("1.18.2 · Fabric");
    const play = screen.getByRole("button", { name: "Play" });
    await waitFor(() => {
      expect(play).toBeEnabled();
    });
    fireEvent.click(play);
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("game:launch", {
        profileId: "p1",
        accountId: "a1",
      });
    });
  });

  it("shows mod errors at Play and plays anyway when asked", async () => {
    const api = mockApi({
      "account:list": () => [steve],
      "settings:get": () => settings({ selectedAccountId: "a1" }),
      "loaders:list": () => loaders,
      "mods:library": () => library,
      "game:launch": (request) =>
        (request as LaunchRequest).problems === "ignore"
          ? { status: "started", game, warnings: 2 }
          : { status: "blocked", report },
    });
    renderBar(profile());
    await clickPlay();
    expect(
      await screen.findByText("Some mods have problems"),
    ).toBeInTheDocument();
    expect(await screen.findByText("Sodium")).toBeInTheDocument();
    expect(
      screen.getByText("Made for 1.20.x, profile is 1.18.2"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Play anyway" }));
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("game:launch", {
        profileId: "p1",
        accountId: "a1",
        problems: "ignore",
      });
    });
    expect(
      await screen.findByText("Started with 2 mod warnings. See the Mods tab."),
    ).toBeInTheDocument();
  });

  it("lists the mods it will disable before disabling them and playing", async () => {
    const api = mockApi({
      "account:list": () => [steve],
      "settings:get": () => settings({ selectedAccountId: "a1" }),
      "loaders:list": () => loaders,
      "mods:library": () => library,
      "mods:disablePlan": () => ({
        mods: [
          { sha1: SODIUM, name: "Sodium", reason: "error" },
          { sha1: INDIUM, name: "Indium", reason: "dependency" },
        ],
      }),
      "game:launch": (request) =>
        typeof (request as LaunchRequest).problems === "object"
          ? { status: "started", game, warnings: 0 }
          : { status: "blocked", report },
    });
    renderBar(profile());
    await clickPlay();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Disable problem mods and play",
      }),
    );
    expect(await screen.findByText("Indium")).toBeInTheDocument();
    expect(
      screen.getByText("needs a mod that gets disabled"),
    ).toBeInTheDocument();
    // Nothing is disabled until confirmed.
    expect(
      api.invoke.mock.calls.filter(([channel]) => channel === "game:launch"),
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Disable and play" }));
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("game:launch", {
        profileId: "p1",
        accountId: "a1",
        problems: { disable: [SODIUM, INDIUM] },
      });
    });
  });

  it("fixes a problem from the dialog, checks again, then offers Play", async () => {
    const damaged: ValidationReport = {
      issues: [
        {
          severity: "error",
          code: "damaged",
          reason: "sha1",
          modSha1: SODIUM,
          fix: { kind: "redownload" },
        },
      ],
      requiredBy: {},
      errorCount: 1,
      warningCount: 0,
    };
    let repaired = false;
    const api = mockApi({
      "account:list": () => [steve],
      "settings:get": () => settings({ selectedAccountId: "a1" }),
      "loaders:list": () => loaders,
      "mods:library": () => library,
      "mods:redownload": () => {
        repaired = true;
      },
      "mods:validate": () =>
        repaired ? { ...damaged, issues: [], errorCount: 0 } : damaged,
      "game:launch": () =>
        repaired
          ? { status: "started", game, warnings: 0 }
          : { status: "blocked", report: damaged },
    });
    renderBar(profile());
    await clickPlay();
    fireEvent.click(await screen.findByRole("button", { name: "Re-download" }));
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("mods:redownload", SODIUM);
    });
    expect(await screen.findByText("No errors left.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("game:launch", {
        profileId: "p1",
        accountId: "a1",
        problems: "check",
      });
    });
  });

  it("searches for a missing mod from the dialog", async () => {
    const missing: ValidationReport = {
      issues: [
        {
          severity: "error",
          code: "missingDep",
          depId: "fabric-api",
          range: "*",
          name: "Fabric API",
          modSha1: INDIUM,
          fix: { kind: "download", query: "fabric-api" },
        },
      ],
      requiredBy: {},
      errorCount: 1,
      warningCount: 0,
    };
    const api = mockApi({
      "account:list": () => [steve],
      "settings:get": () => settings({ selectedAccountId: "a1" }),
      "loaders:list": () => loaders,
      "mods:library": () => library,
      "mods:findRemote": () => [],
      "game:launch": () => ({ status: "blocked", report: missing }),
    });
    renderBar(profile());
    await clickPlay();
    expect(await screen.findByText("Needs Fabric API")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("mods:findRemote", {
        profileId: "p1",
        query: "fabric-api",
      });
    });
  });

  it("can start another game of a profile that is already running", async () => {
    const api = mockApi({
      "account:list": () => [steve],
      "settings:get": () => settings({ selectedAccountId: "a1" }),
      "loaders:list": () => loaders,
      "game:launch": () => ({ status: "started", game, warnings: 0 }),
    });
    renderBar(profile({ running: 1 }));
    const again = await screen.findByRole("button", { name: "Play another" });
    expect(
      await screen.findByText(
        /Already running\. Another copy uses the same profile folder/,
      ),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(again).toBeEnabled();
    });
    fireEvent.click(again);
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("game:launch", {
        profileId: "p1",
        accountId: "a1",
      });
    });
  });

  it("offers to create an account when there is none", async () => {
    const api = mockApi({
      "account:list": () => [],
      "settings:get": () => settings(),
      "loaders:list": () => loaders,
      "account:setUsername": (name) => ({ ...steve, username: name as string }),
      "settings:update": (patch) => settings(patch as object),
    });
    renderBar(profile());
    const input = await screen.findByLabelText("Create account");
    fireEvent.change(input, { target: { value: "no spaces!" } });
    expect(input).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(input, { target: { value: "Alex" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("account:setUsername", "Alex");
    });
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("settings:update", {
        selectedAccountId: "a1",
      });
    });
  });

  it("shows install progress with a cancel button", async () => {
    const api = mockApi({
      "account:list": () => [steve],
      "settings:get": () => settings({ selectedAccountId: "a1" }),
      "loaders:list": () => loaders,
      "versions:cancel": () => true,
    });
    renderBar(
      profile({
        installedVersionId: "26.3",
        gameVersion: "26.3",
        loader: null,
      }),
    );
    act(() => {
      launcherStore.installState({ versionId: "26.3", status: "running" });
      launcherStore.installProgress({
        versionId: "26.3",
        step: "downloading",
        files: 5,
        totalFiles: 10,
        bytes: 1048576,
        totalBytes: 2097152,
      });
    });
    expect(
      await screen.findByRole("button", { name: "Installing…" }),
    ).toBeDisabled();
    expect(screen.getByText("5 / 10 files · 1.0 / 2.0 MB")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api.invoke).toHaveBeenCalledWith("versions:cancel", "26.3");
  });

  it("names the profile that crashed", async () => {
    mockApi({
      "account:list": () => [steve],
      "settings:get": () => settings(),
      "loaders:list": () => loaders,
    });
    renderBar(undefined, [profile()]);
    act(() => {
      launcherStore.gameExit({ ...game, code: 1, crashed: true });
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Survival crashed (exit code 1)",
    );
  });
});
