import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { versionList } from "../../test/fixtures";
import { VersionList, type VersionListProps } from "./VersionList";

function renderList(
  onSelect = vi.fn(),
  props: Partial<Pick<VersionListProps, "types" | "selectedId">> = {},
) {
  render(
    <VersionList
      versions={[
        ...versionList.versions,
        {
          id: "b1.7.3",
          type: "old_beta",
          releaseTime: "2011-07-08T00:00:00Z",
          installed: false,
        },
      ]}
      selectedId="26.3"
      onSelect={onSelect}
      {...props}
    />,
  );
  return onSelect;
}

const ids = () => screen.getAllByRole("option").map((o) => o.textContent);

describe("VersionList", () => {
  it("shows releases first and switches between tabs", () => {
    renderList();
    expect(ids().join()).toMatch(/26\.3.*1\.18\.2.*1\.12\.2/);
    expect(ids().join()).not.toMatch(/snapshot/);

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Old beta" }));
    expect(ids()).toHaveLength(1);
    expect(ids()[0]).toContain("b1.7.3");
  });

  it("lists Minecraft versions only, not loader installs", () => {
    renderList();
    expect(ids().join()).not.toMatch(/fabric-loader/);
  });

  it("filters by search text and shows an empty message", () => {
    renderList();
    const search = screen.getByRole("searchbox", { name: "Search versions" });
    fireEvent.change(search, { target: { value: "1.18" } });
    expect(ids()).toHaveLength(1);
    fireEvent.change(search, { target: { value: "nope" } });
    expect(screen.getByText("No versions match.")).toBeInTheDocument();
  });

  it("selects a version and marks the selected one", () => {
    const onSelect = renderList();
    fireEvent.click(screen.getByText("1.12.2"));
    expect(onSelect).toHaveBeenCalledWith("1.12.2");
    const selected = screen
      .getAllByRole("option")
      .find((o) => o.getAttribute("aria-selected") === "true");
    expect(selected?.textContent).toContain("26.3");
  });

  it("shows only the version types that are turned on; releases always", () => {
    renderList(vi.fn(), { types: ["release", "snapshot"] });
    expect(screen.getByRole("tab", { name: "Snapshots" })).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "Old beta" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "Old alpha" }),
    ).not.toBeInTheDocument();
  });

  it("shows no tabs when only releases are on", () => {
    renderList(vi.fn(), { types: ["release"] });
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(ids().join()).toMatch(/26.3/);
  });

  it("keeps showing a hidden type's tab when the profile uses such a version", () => {
    renderList(vi.fn(), { types: ["release"], selectedId: "b1.7.3" });
    // Opens on its tab, with its version.
    expect(screen.getByRole("tab", { name: "Old beta" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(ids()[0]).toContain("b1.7.3");
    expect(
      screen.queryByRole("tab", { name: "Snapshots" }),
    ).not.toBeInTheDocument();
  });
});
