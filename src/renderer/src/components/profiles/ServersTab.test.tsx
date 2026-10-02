import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { createQueryClient } from "../../lib/queryClient";
import { profile } from "../../test/fixtures";
import { mockApi } from "../../test/mockApi";
import { ServersTab } from "./ServersTab";

function renderTab() {
  mockApi({
    "profiles:playTargets": () => ({
      worlds: "yes",
      servers: [
        { name: "Friends", address: "friends.example.com:25566" },
        { name: "Broken", address: "--evil" },
      ],
    }),
  });
  const onJoin = vi.fn();
  render(
    <QueryClientProvider client={createQueryClient()}>
      <ServersTab profile={{ ...profile(), running: 0 }} onJoin={onJoin} />
    </QueryClientProvider>,
  );
  return onJoin;
}

describe("ServersTab", () => {
  it("joins a server from the game's list", async () => {
    const onJoin = renderTab();
    fireEvent.click(
      await screen.findByRole("button", { name: "Join Friends" }),
    );
    expect(onJoin).toHaveBeenCalledWith("friends.example.com:25566", "Friends");
    expect(screen.getByRole("button", { name: "Join Broken" })).toBeDisabled();
  });

  it("joins a typed address, and only a real one", async () => {
    const onJoin = renderTab();
    await screen.findByText("Friends");
    const input = screen.getByLabelText("Server address");
    const join = screen.getAllByRole("button", { name: "Join" })[0]!;
    fireEvent.change(input, { target: { value: "bad address" } });
    expect(join).toBeDisabled();
    expect(screen.getByText("Not a server address.")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: " mc.example.com " } });
    fireEvent.click(join);
    expect(onJoin).toHaveBeenCalledWith("mc.example.com", "mc.example.com");
  });
});
