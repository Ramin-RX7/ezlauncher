/**
 * A Minecraft server address as the game takes it: a host name, IPv4 or `[IPv6]`,
 * with an optional `:port`. Shared so the UI checks a typed address the same way
 * the launcher does before passing it to the game.
 */
export interface ServerAddress {
  host: string;
  port?: number;
}

const HOST_NAME =
  /^(?=.{1,253}$)[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,62})(?:\.[A-Za-z0-9_-]{1,63})*\.?$/;
const IPV6 = /^[0-9A-Fa-f:.]{2,45}$/;

/** The address, or null when it isn't one (never something that reads as an option). */
export function parseServerAddress(text: string): ServerAddress | null {
  const value = text.trim();
  if (value.length === 0 || value.length > 255 || value.startsWith("-"))
    return null;
  let host: string;
  let portText: string | undefined;
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    if (end < 0) return null;
    host = value.slice(1, end);
    const rest = value.slice(end + 1);
    if (rest !== "" && !rest.startsWith(":")) return null;
    portText = rest === "" ? undefined : rest.slice(1);
    if (!IPV6.test(host) || !host.includes(":")) return null;
  } else {
    const parts = value.split(":");
    if (parts.length > 2) return null;
    host = parts[0] ?? "";
    portText = parts[1];
    if (!HOST_NAME.test(host)) return null;
  }
  if (portText === undefined) return { host };
  if (!/^\d{1,5}$/.test(portText)) return null;
  const port = Number(portText);
  if (port < 1 || port > 65535) return null;
  return { host, port };
}

/** The address as the game's Quick Play takes it (`host`, `host:port`, `[v6]:port`). */
export function formatServerAddress({ host, port }: ServerAddress): string {
  const h = host.includes(":") ? `[${host}]` : host;
  return port === undefined ? h : `${h}:${port}`;
}
