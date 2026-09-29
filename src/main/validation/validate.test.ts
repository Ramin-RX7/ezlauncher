import { describe, expect, it } from "vitest";
import type { ValidationInput, ValidationMod } from "./types";
import { disableCascade, orphanedDependencies, validate } from "./validate";
import { parseMcVersion } from "./versions/mcVersion";

let next = 0;
const sha = () => String(++next).padStart(40, "0");

function mod(
  overrides: Partial<ValidationMod> & { modId: string },
): ValidationMod {
  return {
    sha1: sha(),
    name: overrides.modId,
    version: "1.0.0",
    loaders: ["fabric"],
    ...overrides,
  };
}

const dep = (id: string, range: string | string[] = "*") => ({
  id,
  range,
  format: "semver" as const,
});

function input(
  mods: ValidationMod[],
  overrides: Partial<ValidationInput> = {},
): ValidationInput {
  return {
    gameVersion: "1.18.2",
    mcVersion: parseMcVersion("1.18.2"),
    loader: { id: "fabric", version: "0.14.21" },
    javaMajor: 17,
    mods,
    ...overrides,
  };
}

const fabricApi = () =>
  mod({
    modId: "fabric-api",
    name: "Fabric API",
    version: "0.77.0+1.18.2",
    provides: ["fabric"],
    nested: [
      { modId: "fabric-api-base", version: "0.4.4" },
      { modId: "fabric-rendering-fluids-v1", version: "2.0.2" },
      {
        modId: "fabric-renderer-api-v1",
        version: "0.4.9",
        provides: ["fabric-renderer"],
      },
    ],
  });

const codes = (i: ValidationInput) =>
  validate(i).issues.map((x) => [x.severity, x.code]);

describe("validate", () => {
  it("passes a good set of mods, with bundled modules counting as present", () => {
    const api = fabricApi();
    const sodium = mod({
      modId: "sodium",
      name: "Sodium",
      version: "0.4.1+build.15",
      mcVersionRange: "1.18.x",
      depends: [
        dep("fabricloader", ">=0.12"),
        dep("fabric-rendering-fluids-v1", ">=2"),
        dep("fabric-api-base"),
        dep("java", ">=17"),
      ],
    });
    const report = validate(input([api, sodium]));
    expect(report.issues).toEqual([]);
    expect(report.requiredBy).toEqual({ [api.sha1]: [sodium.sha1] });
  });

  it("reports a mod for another loader", () => {
    const forge = mod({ modId: "jei", loaders: ["forge"] });
    expect(validate(input([forge])).issues).toEqual([
      {
        severity: "error",
        code: "wrongLoader",
        loaders: ["forge"],
        modSha1: forge.sha1,
      },
    ]);
  });

  it("lets Quilt profiles run Fabric mods, with fabricloader provided by Quilt", () => {
    const m = mod({ modId: "m", depends: [dep("fabricloader", ">=9")] });
    expect(
      codes(input([m], { loader: { id: "quilt", version: "0.19.0" } })),
    ).toEqual([]);
  });

  it("reports a Minecraft version outside the range, with both versions", () => {
    const m = mod({ modId: "m", mcVersionRange: "~1.20.1" });
    expect(validate(input([m])).issues[0]).toMatchObject({
      severity: "error",
      code: "mcVersion",
      range: "~1.20.1",
      gameVersion: "1.18.2",
    });
  });

  it("reads Maven ranges for Forge-style metadata", () => {
    const m = mod({
      modId: "m",
      loaders: ["fabric"],
      mcVersionRange: "[1.20,1.21)",
      rangeFormat: "maven",
    });
    expect(codes(input([m]))).toEqual([["error", "mcVersion"]]);
  });

  it("reports a loader build that is too old", () => {
    const m = mod({ modId: "m", depends: [dep("fabricloader", ">=0.15")] });
    expect(validate(input([m])).issues[0]).toMatchObject({
      severity: "error",
      code: "loaderVersion",
      loader: "fabric",
      range: ">=0.15",
      installed: "0.14.21",
    });
    // Not installed yet: the build isn't known, so nothing is said.
    expect(codes(input([m], { loader: { id: "fabric" } }))).toEqual([]);
  });

  it("reports Fabric API once when its modules are missing, with a download fix", () => {
    const m = mod({
      modId: "sodium",
      depends: [dep("fabric-api-base"), dep("fabric-rendering-fluids-v1")],
    });
    expect(validate(input([m])).issues).toEqual([
      {
        severity: "error",
        code: "missingDep",
        depId: "fabric-api",
        range: "*",
        name: "Fabric API",
        modSha1: m.sha1,
        fix: { kind: "download", query: "fabric-api" },
      },
    ]);
  });

  it("reports other missing mods by id, and the old `fabric` id is provided by Fabric API", () => {
    const m = mod({
      modId: "m",
      depends: [dep("fabric"), dep("cloth-config", ">=6")],
    });
    expect(validate(input([m, fabricApi()])).issues).toEqual([
      {
        severity: "error",
        code: "missingDep",
        depId: "cloth-config",
        range: ">=6",
        modSha1: m.sha1,
        fix: { kind: "download", query: "cloth-config" },
      },
    ]);
  });

  it("doesn't treat fabric-language-kotlin as part of Fabric API", () => {
    const m = mod({ modId: "m", depends: [dep("fabric-language-kotlin")] });
    expect(validate(input([m])).issues[0]).toMatchObject({
      depId: "fabric-language-kotlin",
    });
  });

  it("reports a required mod at the wrong version", () => {
    const sodium = mod({ modId: "sodium", name: "Sodium", version: "0.3.4" });
    const indium = mod({ modId: "indium", depends: [dep("sodium", "0.4.x")] });
    expect(validate(input([sodium, indium])).issues).toEqual([
      expect.objectContaining({
        severity: "error",
        code: "depVersion",
        depId: "sodium",
        range: "0.4.x",
        found: "0.3.4",
        otherName: "Sodium",
        modSha1: indium.sha1,
      }),
    ]);
  });

  it("reports mods that break each other, and conflicts as warnings", () => {
    const a = mod({ modId: "a", breaks: [dep("b", "<2")] });
    const b = mod({ modId: "b", version: "1.5" });
    const c = mod({ modId: "c", conflicts: [dep("b")] });
    const d = mod({ modId: "d", breaks: [dep("b", ">=2")] }); // b is 1.5: fine
    expect(codes(input([a, b, c, d]))).toEqual([
      ["error", "breaks"],
      ["warning", "conflicts"],
    ]);
  });

  it("reports two enabled jars with the same id", () => {
    const one = mod({ modId: "lithium", version: "0.7" });
    const two = mod({ modId: "lithium", version: "0.8" });
    expect(codes(input([one, two]))).toEqual([
      ["error", "duplicateId"],
      ["error", "duplicateId"],
    ]);
  });

  it("reports Java that is too old; unknown Java says nothing", () => {
    const m = mod({ modId: "m", depends: [dep("java", ">=21")] });
    expect(validate(input([m])).issues[0]).toMatchObject({
      code: "java",
      range: ">=21",
      java: 17,
    });
    const noJava = input([m]);
    delete noJava.javaMajor;
    expect(codes(noJava)).toEqual([]);
  });

  it("reports damaged files, with Re-download only for mods from a source", () => {
    const known = mod({ modId: "a", source: { sourceId: "modrinth" } });
    const local = mod({ modId: "b" });
    const report = validate(
      input([known, local], {
        damaged: new Map([
          [known.sha1, "sha1"],
          [local.sha1, "unreadable"],
        ]),
      }),
    );
    expect(report.issues).toEqual([
      {
        severity: "error",
        code: "damaged",
        reason: "sha1",
        modSha1: known.sha1,
        fix: { kind: "redownload" },
      },
      {
        severity: "error",
        code: "damaged",
        reason: "unreadable",
        modSha1: local.sha1,
      },
    ]);
  });

  it("warns, never errors, when unsure", () => {
    const noMeta = mod({ modId: "x", loaders: [] });
    delete noMeta.modId;
    const badRange = mod({ modId: "y", mcVersionRange: "1.18 || banana" });
    const oddVersion = mod({ modId: "odd", version: "build-seven" });
    const needsOdd = mod({ modId: "z", depends: [dep("odd", ">=1")] });
    const report = validate(input([noMeta, badRange, oddVersion, needsOdd]));
    expect(report.errorCount).toBe(0);
    expect(report.issues.map((i) => "reason" in i && i.reason)).toEqual([
      "noMetadata",
      "range",
      "version",
    ]);
    // A snapshot that can't be mapped: the range can't be checked.
    const ranged = mod({ modId: "r", mcVersionRange: ">=1.18" });
    const snapshot = input([ranged], { gameVersion: "22w13a" });
    delete snapshot.mcVersion;
    expect(codes(snapshot)).toEqual([["warning", "unknown"]]);
  });

  it("uses Modrinth data only for warnings, and the jar's answer first", () => {
    const fits = mod({
      modId: "a",
      mcVersionRange: ">=1.18",
      source: { sourceId: "modrinth", gameVersions: ["1.19", "1.19.1"] },
    });
    const noRange = mod({
      modId: "b",
      source: { sourceId: "modrinth", gameVersions: ["1.20.1"] },
    });
    const outside = mod({
      modId: "c",
      mcVersionRange: ">=1.19",
      source: { sourceId: "modrinth", gameVersions: ["1.19"] },
    });
    expect(codes(input([fits, noRange, outside]))).toEqual([
      ["warning", "sourceMcVersion"],
      ["warning", "sourceMcVersion"],
      ["error", "mcVersion"], // no extra warning: the jar already rules it out
    ]);
  });

  it("returns nothing for Vanilla profiles", () => {
    expect(validate(input([mod({ modId: "m" })], { loader: null }))).toEqual({
      issues: [],
      requiredBy: {},
      errorCount: 0,
      warningCount: 0,
    });
  });
});

describe("disableCascade", () => {
  it("disables mods with errors, then the ones that needed them", () => {
    const api = fabricApi();
    const broken = mod({
      modId: "sodium",
      name: "Sodium",
      mcVersionRange: "1.20.x",
    });
    const indium = mod({
      modId: "indium",
      name: "Indium",
      depends: [dep("sodium")],
    });
    const addon = mod({
      modId: "addon",
      name: "Addon",
      depends: [dep("indium")],
    });
    const fine = mod({ modId: "fine", depends: [dep("fabric-api-base")] });
    expect(disableCascade(input([api, broken, indium, addon, fine]))).toEqual({
      mods: [
        { sha1: broken.sha1, name: "Sodium", reason: "error" },
        { sha1: indium.sha1, name: "Indium", reason: "dependency" },
        { sha1: addon.sha1, name: "Addon", reason: "dependency" },
      ],
    });
  });
});

describe("orphanedDependencies", () => {
  it("takes along what only the disabled mod needed, and keeps shared ones", () => {
    const api = fabricApi();
    const sodium = mod({ modId: "sodium", depends: [dep("fabric-api-base")] });
    const indium = mod({
      modId: "indium",
      depends: [dep("sodium"), dep("fabric-renderer-api-v1")],
    });
    const lithium = mod({
      modId: "lithium",
      depends: [dep("fabric-api-base")],
    });
    // Transitively: only Indium needed Sodium, and then only Sodium needed Fabric API.
    expect(
      orphanedDependencies(input([api, sodium, indium]), indium.sha1),
    ).toEqual([sodium.sha1, api.sha1]);
    // Lithium still needs Fabric API, so it stays.
    expect(
      orphanedDependencies(input([api, sodium, indium, lithium]), indium.sha1),
    ).toEqual([sodium.sha1]);
    // A mod nothing depends on takes nothing along.
    expect(orphanedDependencies(input([api, lithium]), api.sha1)).toEqual([]);
  });
});
