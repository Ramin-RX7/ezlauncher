import { AppError } from "../core/errors";
import { parseServerAddress } from "@shared/serverAddress";
import {
  get,
  readNbt,
  remove,
  set,
  TAG,
  writeNbt,
  type Compound,
  type Tag,
} from "./nbtTree";

/*
 * The game's multiplayer list (`servers.dat`), for editing. Each entry keeps every
 * tag the game wrote (its icon, chat-report flags, …): the launcher changes only
 * `name`, `ip` and `acceptTextures`. Hidden entries (made by the game for direct
 * connections) are kept where they are and never shown.
 */

/** The game's "Server Resource Packs" choice: `acceptTextures` 1, 0, or missing. */
export type ResourcePackChoice = "prompt" | "enabled" | "disabled";

export interface ServerEntry {
  /** Its place in the file's list (to match edits with the entry they change). */
  key: number;
  name: string;
  address: string;
  resourcePacks: ResourcePackChoice;
  /** Base64 PNG, as the game cached it. */
  icon?: string;
}

export interface ServerEdit {
  /** An existing entry's key; missing = a new server. */
  key?: number;
  name: string;
  address: string;
  resourcePacks: ResourcePackChoice;
}

export const MAX_SERVERS = 1000;
export const MAX_SERVER_NAME = 128;

interface Parsed {
  name: string;
  root: Compound;
  /** The `servers` list's compounds, in file order. */
  entries: Compound[];
}

function parse(file: Uint8Array | undefined): Parsed {
  if (!file)
    return { name: "", root: { type: TAG.COMPOUND, value: [] }, entries: [] };
  let read;
  try {
    read = readNbt(file);
  } catch (err) {
    throw new AppError(
      "SERVERS_UNREADABLE",
      "The game's server list can't be read.",
      { cause: err },
    );
  }
  const list = get(read.root, "servers");
  const entries =
    list?.type === TAG.LIST
      ? list.value.filter((t): t is Compound => t.type === TAG.COMPOUND)
      : [];
  return { name: read.name, root: read.root, entries };
}

const str = (c: Compound, name: string) => {
  const t = get(c, name);
  return t?.type === TAG.STRING ? t.value : "";
};

const hidden = (c: Compound) => {
  const t = get(c, "hidden");
  return t?.type === TAG.BYTE && t.value !== 0;
};

function choiceOf(c: Compound): ResourcePackChoice {
  const t = get(c, "acceptTextures");
  if (t?.type !== TAG.BYTE) return "prompt";
  return t.value !== 0 ? "enabled" : "disabled";
}

/** The visible servers of a `servers.dat` (undefined = no file yet: none). */
export function readServers(file: Uint8Array | undefined): ServerEntry[] {
  return parse(file)
    .entries.map((c, key) => ({ c, key }))
    .filter(({ c }) => !hidden(c))
    .map(({ c, key }) => {
      const icon = str(c, "icon");
      return {
        key,
        name: str(c, "name"),
        address: str(c, "ip"),
        resourcePacks: choiceOf(c),
        ...(icon && { icon }),
      };
    });
}

/** Check edits from the renderer; throws `INVALID_ADDRESS` / `INVALID_INPUT`. */
export function checkEdits(edits: unknown): ServerEdit[] {
  if (!Array.isArray(edits) || edits.length > MAX_SERVERS)
    throw new AppError("INVALID_INPUT", "Too many servers.");
  return edits.map((e: unknown) => {
    const x = (e ?? {}) as Partial<Record<keyof ServerEdit, unknown>>;
    const name = typeof x.name === "string" ? x.name.trim() : "";
    const address = typeof x.address === "string" ? x.address.trim() : "";
    if (name.length === 0 || name.length > MAX_SERVER_NAME)
      throw new AppError("INVALID_INPUT", "Give each server a name.");
    if (!parseServerAddress(address))
      throw new AppError("INVALID_ADDRESS", `Not a server address: ${address}`);
    const resourcePacks =
      x.resourcePacks === "enabled" || x.resourcePacks === "disabled"
        ? x.resourcePacks
        : "prompt";
    return {
      ...(typeof x.key === "number" &&
        Number.isInteger(x.key) && { key: x.key }),
      name,
      address,
      resourcePacks,
    };
  });
}

/**
 * A new `servers.dat`: the visible servers in the edits' order (existing ones keep
 * all their tags), hidden entries at their old places, the rest of the file as it was.
 */
export function writeServers(
  file: Uint8Array | undefined,
  edits: readonly ServerEdit[],
): Uint8Array {
  const { name, root, entries } = parse(file);
  const used = new Set<number>();
  const visible: Compound[] = edits.map((e) => {
    const old =
      e.key !== undefined && !used.has(e.key) ? entries[e.key] : undefined;
    if (old && !hidden(old)) used.add(e.key ?? -1);
    const c: Compound =
      old && !hidden(old)
        ? { type: TAG.COMPOUND, value: [...old.value] }
        : { type: TAG.COMPOUND, value: [] };
    set(c, "name", { type: TAG.STRING, value: e.name });
    set(c, "ip", { type: TAG.STRING, value: e.address });
    if (e.resourcePacks === "prompt") remove(c, "acceptTextures");
    else
      set(c, "acceptTextures", {
        type: TAG.BYTE,
        value: e.resourcePacks === "enabled" ? 1 : 0,
      });
    return c;
  });
  // Hidden entries stay at their index; the visible ones fill the rest in order.
  const out: Tag[] = [];
  let next = 0;
  const total = visible.length + entries.filter(hidden).length;
  for (let i = 0; i < total; i++) {
    const original = entries[i];
    if (original && hidden(original)) out.push(original);
    else {
      const v = visible[next++];
      if (v) out.push(v);
    }
  }
  while (next < visible.length) {
    const v = visible[next++];
    if (v) out.push(v);
  }
  set(root, "servers", {
    type: TAG.LIST,
    itemType: TAG.COMPOUND,
    value: out,
  });
  return writeNbt(name, root);
}
