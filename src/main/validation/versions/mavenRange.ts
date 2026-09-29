import { compareSemVer, parseSemVer, type SemVer } from "./semver";

/*
 * Forge/NeoForge Maven version ranges (`mods.toml` `versionRange`):
 * `[1.18,1.19)`, `[1.20.1]`, `[47,)`, `(,1.19]`, and unions `[1.18,1.18.2],[1.19,)`.
 * A bare version (`1.18.2`) is only a recommendation in Maven, so it can't be
 * checked: undefined.
 */

type Test = (v: SemVer) => boolean;

function parseSet(set: string): Test | undefined {
  const match = /^([[(])\s*([^,\])]*)\s*(?:,\s*([^\])]*))?\s*([\])])$/.exec(
    set,
  );
  if (!match) return undefined;
  const [, open, lowText = "", highText, close] = match;
  const hasComma = highText !== undefined;

  if (!hasComma) {
    // [1.20.1] = exactly that version.
    if (open !== "[" || close !== "]") return undefined;
    const exact = parseSemVer(lowText);
    return exact ? (v) => compareSemVer(v, exact) === 0 : undefined;
  }

  const low = lowText.trim() ? parseSemVer(lowText) : null;
  const high = highText.trim() ? parseSemVer(highText) : null;
  if (low === undefined || high === undefined) return undefined;
  return (v) => {
    if (low) {
      const c = compareSemVer(v, low);
      if (open === "[" ? c < 0 : c <= 0) return false;
    }
    if (high) {
      const c = compareSemVer(v, high);
      if (close === "]" ? c > 0 : c >= 0) return false;
    }
    return true;
  };
}

export function parseMavenRange(range: string): Test | undefined {
  const text = range.trim();
  if (text === "" || text === "*") return () => true;
  const sets = text.match(/[[(][^\])]*[\])]/g);
  if (!sets) return undefined;
  // Everything must be sets separated by commas.
  if (text.replace(/[[(][^\])]*[\])]/g, "").replace(/[\s,]/g, "") !== "")
    return undefined;
  const tests: Test[] = [];
  for (const set of sets) {
    const test = parseSet(set);
    if (!test) return undefined;
    tests.push(test);
  }
  return (v) => tests.some((t) => t(v));
}

/** Does `version` fall in `range`? undefined = the range can't be read. */
export function matchesMavenRange(
  range: string,
  version: SemVer,
): boolean | undefined {
  return parseMavenRange(range)?.(version);
}
