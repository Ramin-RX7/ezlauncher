/** Release notes (CHANGELOG.md sections) as blocks; see releaseNotes.tsx. */

export interface Item {
  text: string;
  children: string[];
}

export type Block =
  | { kind: "heading"; text: string }
  | { kind: "list"; items: Item[] }
  | { kind: "text"; text: string };

export function parseNotes(markdown: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of markdown.replace(/\r\n/g, "\n").split("\n")) {
    if (!raw.trim()) continue;
    const heading = /^#{1,6}\s+(.*)$/.exec(raw);
    const item = /^(\s*)[-*]\s+(.*)$/.exec(raw);
    const last = blocks.at(-1);
    if (heading) {
      blocks.push({ kind: "heading", text: heading[1] ?? "" });
    } else if (item) {
      const nested = (item[1] ?? "").length >= 2;
      const text = item[2] ?? "";
      const list =
        last?.kind === "list"
          ? last
          : (blocks[blocks.push({ kind: "list", items: [] }) - 1] as Extract<
              Block,
              { kind: "list" }
            >);
      const parent = list.items.at(-1);
      if (nested && parent) parent.children.push(text);
      else list.items.push({ text, children: [] });
    } else {
      blocks.push({ kind: "text", text: raw.trim() });
    }
  }
  return blocks;
}
