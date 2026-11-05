/** Flatten a text component (string, object with text/extra, or array) to plain text. */
export function plainText(component: unknown, depth = 0): string {
  if (depth > 16) return "";
  if (typeof component === "string") return component;
  if (typeof component === "number" || typeof component === "boolean")
    return String(component);
  if (Array.isArray(component))
    return component.map((c) => plainText(c, depth + 1)).join("");
  if (typeof component === "object" && component !== null) {
    const c = component as Record<string, unknown>;
    const own =
      typeof c.text === "string"
        ? c.text
        : typeof c.translate === "string"
          ? typeof c.fallback === "string"
            ? c.fallback
            : c.translate
          : "";
    return own + (c.extra === undefined ? "" : plainText(c.extra, depth + 1));
  }
  return "";
}

/** Without § formatting codes, runs of spaces collapsed, trimmed (line breaks kept). */
export const cleanText = (text: string): string =>
  text
    .replace(/§./g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
