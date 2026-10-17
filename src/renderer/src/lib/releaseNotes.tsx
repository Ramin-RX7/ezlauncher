import type { ReactNode } from "react";
import { parseNotes } from "./parseReleaseNotes";

/*
 * Release notes are CHANGELOG.md sections: `###` headings, `-` items (indented
 * items nest once), `code` and **bold**. They're rebuilt as React elements, never
 * injected as HTML; anything else shows as plain text.
 */

/** `code` and **bold** inside a line. */
function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /`([^`]+)`|\*\*([^*]+)\*\*/g;
  let at = 0;
  let key = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > at) parts.push(text.slice(at, m.index));
    parts.push(
      m[1] !== undefined ? (
        <code key={key++} className="rounded bg-surface-2 px-1 text-xs">
          {m[1]}
        </code>
      ) : (
        <strong key={key++}>{m[2]}</strong>
      ),
    );
    at = m.index + m[0].length;
  }
  if (at < text.length) parts.push(text.slice(at));
  return parts;
}

export function ReleaseNotes({ markdown }: { markdown: string }) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      {parseNotes(markdown).map((block, i) => {
        if (block.kind === "heading")
          return (
            <h4 key={i} className="mt-1 font-semibold">
              {inline(block.text)}
            </h4>
          );
        if (block.kind === "text") return <p key={i}>{inline(block.text)}</p>;
        return (
          <ul key={i} className="flex list-disc flex-col gap-1 ps-5">
            {block.items.map((item, j) => (
              <li key={j}>
                {inline(item.text)}
                {item.children.length > 0 && (
                  <ul className="mt-1 flex list-[circle] flex-col gap-1 ps-5">
                    {item.children.map((child, k) => (
                      <li key={k}>{inline(child)}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        );
      })}
    </div>
  );
}
