import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { createQueryClient } from "../../lib/queryClient";
import { profile } from "../../test/fixtures";
import { mockApi } from "../../test/mockApi";
import { DeleteProfileDialog } from "./DeleteProfileDialog";

const a = profile();
const b = profile({ id: "p2", name: "Creative" });
const worlds = [
  { id: "w1", name: "Castle", linked: true },
  { id: "w2", name: "Farm", linked: true },
];

function renderDialog() {
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={createQueryClient()}>
      <DeleteProfileDialog profile={a} profiles={[a, b]} onClose={onClose} />
    </QueryClientProvider>,
  );
  return onClose;
}

describe("DeleteProfileDialog", () => {
  it("deletes nothing until a choice for the worlds is made", async () => {
    const api = mockApi({
      "worlds:list": () => worlds,
      "profiles:delete": () => undefined,
    });
    renderDialog();
    const confirm = await screen.findByRole("button", {
      name: "Delete profile",
    });
    await screen.findByText("Delete its 2 worlds");
    expect(confirm).toBeDisabled();

    fireEvent.click(screen.getByRole("radio", { name: "Delete its 2 worlds" }));
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("profiles:delete", {
        id: "p1",
        worlds: "delete",
      });
    });
  });

  it("can move the worlds to another profile instead", async () => {
    const api = mockApi({
      "worlds:list": () => worlds,
      "profiles:delete": () => undefined,
    });
    renderDialog();
    fireEvent.click(
      await screen.findByRole("radio", {
        name: "Move them to another profile",
      }),
    );
    expect(
      screen.getByRole("combobox", { name: "Profile to move the worlds to" }),
    ).toHaveValue("p2");
    fireEvent.click(screen.getByRole("button", { name: "Delete profile" }));
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("profiles:delete", {
        id: "p1",
        worlds: { moveTo: "p2" },
      });
    });
  });

  it("needs no choice for a profile without worlds", async () => {
    mockApi({ "worlds:list": () => [] });
    renderDialog();
    expect(await screen.findByText("It has no worlds.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete profile" }),
    ).toBeEnabled();
  });
});
