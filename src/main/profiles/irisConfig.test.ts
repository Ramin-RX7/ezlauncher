import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  escapeValue,
  newIrisConfig,
  readIrisSelection,
  writeIrisSelection,
} from "./irisConfig";

describe("a real iris.properties written by Iris 1.11 on Minecraft 26.3", () => {
  const real = readFileSync(
    join(import.meta.dirname, "testing", "iris-26.3.properties"),
    "latin1",
  );

  it("reads the escaped pack name", () => {
    expect(readIrisSelection(real)).toEqual({
      shaderPack: "Compl é A=B #1.zip",
      enabled: true,
    });
  });

  it("writes the name back exactly as Iris did", () => {
    expect(writeIrisSelection(real, { shaderPack: "Compl é A=B #1.zip" })).toBe(
      real,
    );
  });

  it("changes only the two keys, keeping CRLF and the other lines", () => {
    const out = writeIrisSelection(real, {
      shaderPack: "Other.zip",
      enabled: false,
    });
    expect(out).toContain("\r\nshaderPack=Other.zip\r\n");
    expect(out).toContain("\r\nenableShaders=false\r\n");
    expect(out.replace(/^(shaderPack|enableShaders)=.*$/gm, "")).toBe(
      real.replace(/^(shaderPack|enableShaders)=.*$/gm, ""),
    );
  });
});

describe("escapeValue", () => {
  it("escapes like Properties.store", () => {
    expect(escapeValue("A=B:C#D!E")).toBe("A\\=B\\:C\\#D\\!E");
    expect(escapeValue(" lead and inner ")).toBe("\\ lead and inner ");
    expect(escapeValue("C:\\x é\t")).toBe("C\\:\\\\x \\u00E9\\t");
  });
});

describe("readIrisSelection", () => {
  it("treats a missing, empty or internal pack as none", () => {
    expect(readIrisSelection("")).toEqual({ shaderPack: null, enabled: true });
    expect(readIrisSelection("shaderPack=\n").shaderPack).toBeNull();
    expect(readIrisSelection("shaderPack=(internal)\n").shaderPack).toBeNull();
  });

  it("reads separators, comments and continuation lines", () => {
    const text = [
      "# comment",
      "! also a comment",
      "enableShaders : false",
      "shaderPack Long\\",
      "   Name.zip",
      "",
    ].join("\n");
    expect(readIrisSelection(text)).toEqual({
      shaderPack: "LongName.zip",
      enabled: false,
    });
  });
});

describe("writeIrisSelection", () => {
  it("adds missing keys and keeps LF files LF", () => {
    expect(
      writeIrisSelection("colorSpace=SRGB\n", { shaderPack: "A.zip" }),
    ).toBe("colorSpace=SRGB\nshaderPack=A.zip\n");
  });

  it("removes the pack, continuation lines included", () => {
    expect(
      writeIrisSelection("shaderPack=A\\\n  B.zip\nx=1\n", {
        shaderPack: null,
      }),
    ).toBe("x=1\n");
  });

  it("leaves keys it isn't given alone", () => {
    expect(
      writeIrisSelection("shaderPack=A.zip\nenableShaders=true\n", {
        enabled: false,
      }),
    ).toBe("shaderPack=A.zip\nenableShaders=false\n");
  });
});

describe("newIrisConfig", () => {
  it("makes a file Iris reads back", () => {
    const text = newIrisConfig(
      { shaderPack: "My Pack.zip", enabled: true },
      "\r\n",
    );
    expect(text.endsWith("\r\n")).toBe(true);
    expect(readIrisSelection(text)).toEqual({
      shaderPack: "My Pack.zip",
      enabled: true,
    });
  });
});
