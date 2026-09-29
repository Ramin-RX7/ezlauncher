import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectPlatform } from "./platform";
import { detectSystemJava, parseRelease } from "./systemJava";

const linux = detectPlatform("linux", "x64", "6.0");

let dir: string;
beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), "ezl-sysjava-")));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A fake Java home with `bin/java` and, optionally, a `release` file. */
async function javaHome(home: string, release?: string) {
  await mkdir(join(home, "bin"), { recursive: true });
  await writeFile(join(home, "bin", "java"), "");
  if (release) await writeFile(join(home, "release"), release);
  return home;
}

describe("parseRelease", () => {
  it("reads quoted and bare values", () => {
    expect(
      parseRelease(
        'JAVA_VERSION="17.0.8"\nIMPLEMENTOR="Eclipse Adoptium"\nX=1',
      ),
    ).toEqual({
      JAVA_VERSION: "17.0.8",
      IMPLEMENTOR: "Eclipse Adoptium",
      X: "1",
    });
  });
});

describe("detectSystemJava", () => {
  it("finds JAVA_HOME, the PATH and install folders, once each", async () => {
    const a = await javaHome(
      join(dir, "jdk-21"),
      'JAVA_VERSION="21.0.2"\nIMPLEMENTOR="Oracle Corporation"',
    );
    const b = await javaHome(
      join(dir, "jvm", "java-8"),
      'JAVA_VERSION="1.8.0_392"',
    );
    await mkdir(join(dir, "jvm", "not-java"), { recursive: true });
    const found = await detectSystemJava({
      platform: linux,
      env: { JAVA_HOME: a, PATH: [join(a, "bin"), "/nope"].join(delimiter) },
      roots: [join(dir, "jvm")],
    });
    expect(found).toEqual([
      {
        home: a,
        executable: join(a, "bin", "java"),
        version: "21.0.2",
        major: 21,
        vendor: "Oracle Corporation",
      },
      {
        home: b,
        executable: join(b, "bin", "java"),
        version: "1.8.0_392",
        major: 8,
      },
    ]);
  });

  it("leaves out the launcher's own runtimes and folders without Java", async () => {
    const own = await javaHome(
      join(dir, "data", "runtimes", "java-runtime-delta"),
    );
    await mkdir(join(dir, "empty", "bin"), { recursive: true });
    const found = await detectSystemJava({
      platform: linux,
      env: { JAVA_HOME: own, PATH: join(dir, "empty", "bin") },
      roots: [],
      exclude: [join(dir, "data", "runtimes")],
    });
    expect(found).toEqual([]);
  });
});
