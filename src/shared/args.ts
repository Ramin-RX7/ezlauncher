/*
 * Extra arguments are typed as one line of text and stored as an array. They are
 * split the way a shell would (quotes, backslash escapes), but never run through one.
 */

export type SplitResult = { args: string[] } | { error: "unclosedQuote" };

/** `-Xss4M "-Dname=a b" --width 1280` → `["-Xss4M", "-Dname=a b", "--width", "1280"]`. */
export function splitArgs(text: string): SplitResult {
  const args: string[] = [];
  let current = "";
  let started = false;
  let quote: '"' | "'" | undefined;
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    if (quote) {
      if (c === quote) quote = undefined;
      else if (c === "\\" && quote === '"' && /["\\]/.test(text.charAt(i + 1)))
        current += text.charAt(++i);
      else current += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      started = true;
    } else if (c === "\\" && /["'\\\s]/.test(text.charAt(i + 1))) {
      current += text.charAt(++i);
      started = true;
    } else if (/\s/.test(c)) {
      if (started) args.push(current);
      current = "";
      started = false;
    } else {
      current += c;
      started = true;
    }
  }
  if (quote) return { error: "unclosedQuote" };
  if (started) args.push(current);
  return { args };
}

/** The other way round, for showing stored arguments: quotes what needs it. */
export function joinArgs(args: readonly string[]): string {
  return args
    .map((a) =>
      a === "" || /[\s"'\\]/.test(a)
        ? `"${a.replace(/["\\]/g, (m) => `\\${m}`)}"`
        : a,
    )
    .join(" ");
}

/** `-Xmx` / `-Xms` belong to the Memory setting, not to extra JVM arguments. */
export function setsMemory(args: readonly string[]): boolean {
  return args.some((a) => /^-Xm[xs]/i.test(a));
}
