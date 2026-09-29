import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { VersionSummary } from "@shared/launcher";
import { VersionList } from "./VersionList";

const versions: VersionSummary[] = [
  {
    id: "26.4-snapshot-1",
    type: "snapshot",
    releaseTime: "2026-09-22T00:00:00Z",
    installed: false,
  },
  {
    id: "26.3",
    type: "release",
    releaseTime: "2026-09-01T00:00:00Z",
    installed: true,
  },
  {
    id: "1.8.9",
    type: "release",
    releaseTime: "2015-12-03T00:00:00Z",
    installed: false,
  },
  {
    id: "b1.7.3",
    type: "old_beta",
    releaseTime: "2011-07-08T00:00:00Z",
    installed: false,
  },
];

function renderList(onSelect = vi.fn()) {
  render(
    <VersionList
      versions={versions}
      selectedId="26.3"
      onSelect={onSelect}
      onRepair={vi.fn()}
      onOpenFolder={vi.fn()}
      onDelete={vi.fn()}
    />,
  );
  return onSelect;
}

const ids = () => screen.getAllByRole("option").map((o) => o.textContent);

describe("VersionList", () => {
  it("shows releases first and switches between tabs", () => {
    renderList();
    expect(ids().join()).toMatch(/26\.3.*1\.8\.9/);
    expect(ids().join()).not.toMatch(/snapshot/);

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Old beta" }));
    expect(ids()).toHaveLength(1);
    expect(ids()[0]).toContain("b1.7.3");
  });

  it("filters by search text and shows an empty message", () => {
    renderList();
    const search = screen.getByRole("searchbox", { name: "Search versions" });
    fireEvent.change(search, { target: { value: "1.8" } });
    expect(ids()).toHaveLength(1);
    fireEvent.change(search, { target: { value: "nope" } });
    expect(screen.getByText("No versions match.")).toBeInTheDocument();
  });

  it("selects a version and marks the selected one", () => {
    const onSelect = renderList();
    fireEvent.click(screen.getByText("1.8.9"));
    expect(onSelect).toHaveBeenCalledWith("1.8.9");
    const selected = screen
      .getAllByRole("option")
      .find((o) => o.getAttribute("aria-selected") === "true");
    expect(selected?.textContent).toContain("26.3");
  });
});
