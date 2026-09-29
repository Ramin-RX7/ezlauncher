import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { patchNotesNodes } from "./patchNotesHtml";

const view = (html: string) => render(<div>{patchNotesNodes(html)}</div>);

describe("patchNotesNodes", () => {
  it("keeps headings, paragraphs, lists and code (Mojang leaves tags open)", () => {
    const { container } = view(
      "<p>Hi<h1>Changes</h1><ul><li>One<li><code>minecraft:x</code></ul>",
    );
    expect(container.querySelector("h3")?.textContent).toBe("Changes");
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("code")?.textContent).toBe("minecraft:x");
  });

  it("drops scripts, images, event handlers and styles", () => {
    const { container } = view(
      '<p onclick="alert(1)" style="color:red">Text<script>alert(1)</script><img src="https://x/y.png" onerror="alert(1)"><iframe src="https://x"></iframe></p>',
    );
    expect(container.querySelector("script, img, iframe")).toBeNull();
    const p = container.querySelector("p");
    expect(p?.textContent).toBe("Text");
    expect(p?.getAttribute("onclick")).toBeNull();
    expect(p?.getAttribute("style")).toBeNull();
  });

  it("keeps only http(s) links", () => {
    const { container } = view(
      '<a href="https://aka.ms/x">ok</a><a href="javascript:alert(1)">bad</a><a href="/relative">rel</a>',
    );
    const links = [...container.querySelectorAll("a")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "https://aka.ms/x",
      "https://www.minecraft.net/relative",
    ]);
    expect(container.textContent).toContain("bad");
  });
});
