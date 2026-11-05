import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { ProfileInfo, SavedServerList } from "@shared/launcher";
import { createQueryClient } from "../../lib/queryClient";
import { profile } from "../../test/fixtures";
import { mockApi } from "../../test/mockApi";
import { ServersTab } from "./ServersTab";

const LIST: SavedServerList = {
  locked: false,
  servers: [
    {
      key: 0,
      name: "Friends",
      address: "friends.example.com:25566",
      resourcePacks: "prompt",
    },
    {
      key: 2,
      name: "Broken",
      address: "--evil",
      resourcePacks: "enabled",
    },
  ],
};

function renderTab(
  p: ProfileInfo = { ...profile(), running: 0 },
  handlers: Parameters<typeof mockApi>[0] = {},
) {
  const api = mockApi({
    "servers:list": () => LIST,
    "servers:save": () => undefined,
    "servers:status": () => ({ online: false }),
    "servers:lan": () => [],
    ...handlers,
  });
  const onJoin = vi.fn();
  render(
    <QueryClientProvider client={createQueryClient()}>
      <ServersTab profile={p} onJoin={onJoin} />
    </QueryClientProvider>,
  );
  return { onJoin, api };
}

const sent = (api: ReturnType<typeof mockApi>) =>
  api.invoke.mock.calls.find((c) => c[0] === "servers:save")?.[1] as
    { profileId: string; servers: { key?: number }[] } | undefined;

describe("ServersTab", () => {
  it("shows whether each saved server is up, with players, latency and its message", async () => {
    const { api } = renderTab(undefined, {
      "servers:status": (address) =>
        address === "friends.example.com:25566"
          ? {
              online: true,
              version: "1.21.4",
              players: { online: 12, max: 100 },
              motd: "Welcome to Friends",
              latencyMs: 45,
            }
          : { online: false },
    });
    expect(
      await screen.findByText("12/100 players · 45 ms · 1.21.4"),
    ).toBeInTheDocument();
    expect(screen.getByText("Welcome to Friends")).toBeInTheDocument();
    // A broken address is never asked about.
    expect(api.invoke).not.toHaveBeenCalledWith("servers:status", "--evil");
  });

  it("says when a server is offline", async () => {
    renderTab();
    expect(
      await screen.findByText("Offline or not reachable"),
    ).toBeInTheDocument();
  });

  it("lists LAN worlds and joins one", async () => {
    const { onJoin } = renderTab(undefined, {
      "servers:lan": () => [
        { name: "Alex - Island", address: "192.168.1.5:61000" },
        { name: "", address: "192.168.1.9:50000" },
      ],
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Join Alex - Island" }),
    );
    expect(onJoin).toHaveBeenCalledWith("192.168.1.5:61000", "Alex - Island");
    fireEvent.click(screen.getByRole("button", { name: "Join LAN world" }));
    expect(onJoin).toHaveBeenCalledWith("192.168.1.9:50000", "LAN world");
  });

  it("says it's looking while no LAN world is found", async () => {
    renderTab();
    expect(
      await screen.findByText(
        "Looking for worlds opened to LAN on your network…",
      ),
    ).toBeInTheDocument();
  });

  it("joins a server from the game's list", async () => {
    const { onJoin } = renderTab();
    fireEvent.click(
      await screen.findByRole("button", { name: "Join Friends" }),
    );
    expect(onJoin).toHaveBeenCalledWith("friends.example.com:25566", "Friends");
    expect(screen.getByRole("button", { name: "Join Broken" })).toBeDisabled();
  });

  it("joins a typed address, and only a real one", async () => {
    const { onJoin } = renderTab();
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

  it("adds a server to the end of the list", async () => {
    const { api } = renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "Add server" }));
    fireEvent.change(screen.getByLabelText("Server name"), {
      target: { value: "New" },
    });
    fireEvent.change(screen.getAllByLabelText("Server address").at(-1)!, {
      target: { value: "new.example.com" },
    });
    fireEvent.change(screen.getByLabelText("Server resource packs"), {
      target: { value: "disabled" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(sent(api)).toEqual({
        profileId: "p1",
        servers: [
          {
            key: 0,
            name: "Friends",
            address: "friends.example.com:25566",
            resourcePacks: "prompt",
          },
          {
            key: 2,
            name: "Broken",
            address: "--evil",
            resourcePacks: "enabled",
          },
          {
            name: "New",
            address: "new.example.com",
            resourcePacks: "disabled",
          },
        ],
      });
    });
  });

  it("moves a server down and removes one", async () => {
    const { api } = renderTab();
    fireEvent.click(
      await screen.findByRole("button", { name: "Move Friends down" }),
    );
    await waitFor(() => {
      expect(sent(api)?.servers.map((s) => s.key)).toEqual([2, 0]);
    });
    api.invoke.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Remove Broken" }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    await waitFor(() => {
      expect(sent(api)?.servers.map((s) => s.key)).toEqual([0]);
    });
  });

  it("can't be changed while the game runs", async () => {
    renderTab({ ...profile(), running: 1 });
    await screen.findByText("Friends");
    expect(
      await screen.findByText(/Close the game to change the server list/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add server" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Edit Friends" })).toBeDisabled();
    // Joining still works.
    expect(screen.getByRole("button", { name: "Join Friends" })).toBeEnabled();
  });
});
