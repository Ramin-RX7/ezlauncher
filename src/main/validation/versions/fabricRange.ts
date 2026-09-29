import { compareSemVer, parseSemVer, type SemVer } from "./semver";

/*
 * Fabric/Quilt version predicates (`fabric.mod.json` `depends`):
 * `*`, `1.18.2`, `=1.18.2`, `>=1.18.2`, `>1.18`, `<1.19`, `<=1.19`, `~1.18.2`, `^0.15`,
 * `1.18.x` / `1.18.*`; several separated by spaces must all hold; a list means "any of".
 */

type Test = (v: SemVer) => boolean;

function bump(nums: number[], index: number): SemVer {
  const next = nums.slice(0, index + 1);
  next[index] = (next[index] ?? 0) + 1;
  // The lowest pre-release of the next version, so e.g. 1.19-rc1 is already outside ~1.18.
  return { nums: next, pre: "" };
}

function parsePredicate(text: string): Test | undefined {
  if (text === "*" || text === "") return () => true;

  const wildcard = /^(\d+(?:\.\d+)*)\.[xX*]$/.exec(text);
  if (wildcard?.[1]) {
    const nums = wildcard[1].split(".").map(Number);
    const low: SemVer = { nums, pre: "" };
    const high = bump(nums, nums.length - 1);
    return (v) => compareSemVer(v, low) >= 0 && compareSemVer(v, high) < 0;
  }

  const match = /^(>=|<=|>|<|=|~|\^)?\s*(.+)$/.exec(text);
  if (!match?.[2]) return undefined;
  const op = match[1] ?? "=";
  const bound = parseSemVer(match[2]);
  if (!bound) return undefined;
  const cmp = (v: SemVer) => compareSemVer(v, bound);
  switch (op) {
    case ">=":
      return (v) => cmp(v) >= 0;
    case ">":
      return (v) => cmp(v) > 0;
    case "<=":
      return (v) => cmp(v) <= 0;
    case "<":
      return (v) => cmp(v) < 0;
    case "=":
      return (v) => cmp(v) === 0;
    case "~": {
      // Same major.minor, at least the bound.
      const high = bump(bound.nums, Math.min(1, bound.nums.length - 1));
      return (v) => cmp(v) >= 0 && compareSemVer(v, high) < 0;
    }
    case "^": {
      // Same major (Fabric doesn't special-case 0.x), at least the bound.
      const high = bump(bound.nums, 0);
      return (v) => cmp(v) >= 0 && compareSemVer(v, high) < 0;
    }
    default:
      return undefined;
  }
}

/** Parse one range string or a list of them; undefined if any part can't be parsed. */
export function parseFabricRange(
  range: string | readonly string[],
): Test | undefined {
  const alternatives = typeof range === "string" ? [range] : range;
  if (alternatives.length === 0) return undefined;
  const any: Test[] = [];
  for (const alt of alternatives) {
    const all: Test[] = [];
    for (const part of alt.trim().split(/\s+/)) {
      const test = parsePredicate(part);
      if (!test) return undefined;
      all.push(test);
    }
    any.push((v) => all.every((t) => t(v)));
  }
  return (v) => any.some((t) => t(v));
}

/** Does `version` fall in `range`? undefined = the range can't be read. */
export function matchesFabricRange(
  range: string | readonly string[],
  version: SemVer,
): boolean | undefined {
  return parseFabricRange(range)?.(version);
}
