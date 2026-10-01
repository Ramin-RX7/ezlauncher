import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { RemotePack, ShaderInstallResult } from "@shared/launcher";
import { createQueryClient } from "../../lib/queryClient";
import { profile } from "../../test/fixtures";
import { mockApi } from "../../test/mockApi";
import { FindShadersDialog } from "./FindShadersDialog";

const hit = (name: string, loaders: string[]): RemotePack => ({
  sourceId: "modrinth",
  projectId: name.toLowerCase(),
  slug: name.toLowerCase(),
  name,
  author: "someone",
  pageUrl: `https://modrinth.com/shader/${name.toLowerCase()}`,
  loaders,
});

function renderDialog(onGetIris = vi.fn()) {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <FindShadersDialog
        profile={{ ...profile(), running: 0 }}
        onGetIris={onGetIris}
        onClose={() => undefined}
      />
    </QueryClientProvider>,
  );
  return onGetIris;
}

describe("FindShadersDialog", () => {
  it("lists every shader and marks ones not tagged for Iris", async () => {
    const api = mockApi({
      "shaders:search": () => ({
        hits: [
          hit("Complementary", ["iris", "optifine"]),
          hit("Old", ["optifine"]),
        ],
        total: 2,
      }),
    });
    renderDialog();
    expect(await screen.findByText("Complementary")).toBeInTheDocument();
    expect(screen.getAllByText("May not work with Iris")).toHaveLength(1);
    expect(api.invoke).toHaveBeenCalledWith("shaders:search", {
      query: "",
      offset: 0,
      profileId: "p1",
    });
  });

  it("downloads a shader and offers Iris when the profile lacks it", async () => {
    const result: ShaderInstallResult = {
      sha1: "a".repeat(40),
      name: "ComplementaryReimagined_r5.9.3",
      versionNumber: "r5.9.3",
      otherVersion: false,
      irisTagged: true,
      activated: true,
      irisMissing: true,
    };
    const api = mockApi({
      "shaders:search": () => ({
        hits: [hit("Complementary", ["iris"])],
        total: 1,
      }),
      "shaders:install": () => result,
    });
    const onGetIris = renderDialog();
    fireEvent.click(
      await screen.findByRole("button", { name: "Download Complementary" }),
    );
    expect(
      await screen.findByText(/It is this profile's shader now/),
    ).toBeInTheDocument();
    expect(api.invoke).toHaveBeenCalledWith("shaders:install", {
      sourceId: "modrinth",
      projectId: "complementary",
      profileId: "p1",
    });
    fireEvent.click(screen.getByRole("button", { name: "Install Iris" }));
    expect(onGetIris).toHaveBeenCalled();
  });
});
