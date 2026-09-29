import type { ReactNode } from "react";

/*
 * Mojang's patch notes are HTML. It is never injected: the browser's inert parser
 * (`DOMParser`: no scripts run, no images load) reads it, and only a small set of
 * text elements is rebuilt as React elements, without their attributes. Links keep
 * an http(s) `href` only, and open in the system browser.
 */

/** Dropped with everything inside. */
const DROP = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "img",
  "video",
  "audio",
  "svg",
  "math",
  "form",
  "input",
  "button",
  "select",
  "textarea",
  "template",
  "noscript",
]);

function safeHref(href: string | null): string | undefined {
  if (!href) return undefined;
  try {
    const url = new URL(href, "https://www.minecraft.net/");
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function convert(node: Node, key: string): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (DROP.has(tag)) return null;
  const kids = [...el.childNodes].map((c, i) => convert(c, `${key}.${i}`));

  switch (tag) {
    case "h1":
      return (
        <h3 key={key} className="mt-5 mb-2 text-base font-semibold">
          {kids}
        </h3>
      );
    case "h2":
      return (
        <h4 key={key} className="mt-4 mb-1.5 font-semibold">
          {kids}
        </h4>
      );
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      return (
        <h5 key={key} className="mt-3 mb-1 text-sm font-semibold">
          {kids}
        </h5>
      );
    case "p":
      return (
        <p key={key} className="my-2">
          {kids}
        </p>
      );
    case "ul":
      return (
        <ul key={key} className="my-2 list-disc ps-5">
          {kids}
        </ul>
      );
    case "ol":
      return (
        <ol key={key} className="my-2 list-decimal ps-5">
          {kids}
        </ol>
      );
    case "li":
      return (
        <li key={key} className="my-0.5">
          {kids}
        </li>
      );
    case "code":
      return (
        <code
          key={key}
          className="rounded-ezl bg-surface-2 px-1 font-mono text-xs"
        >
          {kids}
        </code>
      );
    case "pre":
      return (
        <pre
          key={key}
          className="my-2 overflow-x-auto rounded-ezl bg-surface-2 p-2 font-mono text-xs"
        >
          {kids}
        </pre>
      );
    case "b":
    case "strong":
      return <strong key={key}>{kids}</strong>;
    case "i":
    case "em":
      return <em key={key}>{kids}</em>;
    case "br":
      return <br key={key} />;
    case "a": {
      const href = safeHref(el.getAttribute("href"));
      return href ? (
        <a
          key={key}
          href={href}
          target="_blank"
          rel="noreferrer"
          className="text-accent underline"
        >
          {kids}
        </a>
      ) : (
        <span key={key}>{kids}</span>
      );
    }
    default:
      // Unknown wrappers (div, span, section…): keep only their content.
      return <span key={key}>{kids}</span>;
  }
}

/** Patch notes HTML → safe React elements. */
export function patchNotesNodes(html: string): ReactNode[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return [...doc.body.childNodes].map((n, i) => convert(n, String(i)));
}
