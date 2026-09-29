import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "../../lib/queryClient";
import { launcherStore } from "../../state/launcherStore";
import { settings, steve } from "../../test/fixtures";
import { mockApi } from "../../test/mockApi";
import { AccountsDialog } from "./AccountsDialog";

const alex = {
  id: "a2",
  username: "Alex",
  uuid: "0123456789abcdef0123456789abcdef",
};

function renderDialog() {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <AccountsDialog onClose={() => undefined} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  launcherStore.setRunning([]);
});

describe("AccountsDialog", () => {
  it("adds an account, and shows why a taken name is refused", async () => {
    const api = mockApi({
      "account:list": () => [steve],
      "settings:get": () => settings({ selectedAccountId: "a1" }),
      "account:add": (name) => {
        if ((name as string).toLowerCase() === "steve")
          throw Object.assign(new Error("taken"), {
            code: "ACCOUNT_NAME_TAKEN",
          });
        return { ...alex, username: name as string };
      },
    });
    renderDialog();
    const field = await screen.findByLabelText("New account's name");
    fireEvent.change(field, { target: { value: "STEVE" } });
    fireEvent.click(screen.getByRole("button", { name: "Add account" }));
    expect(
      await screen.findByText(
        "Another account already has that name (names ignore case).",
      ),
    ).toBeInTheDocument();
    fireEvent.change(field, { target: { value: "Alex" } });
    const add = screen.getByRole("button", { name: "Add account" });
    await waitFor(() => {
      expect(add).toBeEnabled();
    });
    fireEvent.click(add);
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("account:add", "Alex");
    });
  });

  it("renames with the server warning, and keeps the UUID shown", async () => {
    const api = mockApi({
      "account:list": () => [alex],
      "settings:get": () => settings(),
      "account:rename": () => ({ ...alex, username: "Alexa" }),
    });
    renderDialog();
    expect(
      await screen.findByText("01234567-89ab-cdef-0123-456789abcdef"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Rename Alex" }));
    expect(
      screen.getByText(/a renamed account counts as a new player/),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("New name for Alex"), {
      target: { value: "Alexa" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("account:rename", {
        id: "a2",
        username: "Alexa",
      });
    });
  });

  it("copies the UUID", async () => {
    mockApi({
      "account:list": () => [alex],
      "settings:get": () => settings(),
    });
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    renderDialog();
    fireEvent.click(
      await screen.findByRole("button", { name: "Copy UUID of Alex" }),
    );
    expect(writeText).toHaveBeenCalledWith(
      "01234567-89ab-cdef-0123-456789abcdef",
    );
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("asks before deleting, and can't delete an account that is playing", async () => {
    launcherStore.setRunning([
      {
        launchId: "l",
        profileId: "p1",
        accountId: "a1",
        versionId: "1.18.2",
        pid: 1,
      },
    ]);
    const api = mockApi({
      "account:list": () => [steve, alex],
      "settings:get": () => settings(),
      "account:remove": () => undefined,
    });
    renderDialog();
    expect(
      await screen.findByRole("button", { name: "Delete Steve" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Delete Alex" }));
    expect(await screen.findByText("Delete Alex?")).toBeInTheDocument();
    expect(screen.getByText(/Worlds are not touched/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(api.invoke).toHaveBeenCalledWith("account:remove", "a2");
    });
  });
});
