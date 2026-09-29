import { describe, expect, it } from "vitest";
import { joinArgs, splitArgs } from "./args";

describe("splitArgs", () => {
  it("splits on any whitespace", () => {
    expect(splitArgs("  -Xss4M\t--width   1280\n--height 720 ")).toEqual({
      args: ["-Xss4M", "--width", "1280", "--height", "720"],
    });
  });

  it("keeps quoted text together, in double or single quotes", () => {
    expect(splitArgs(`"-Dname=a b" '--title=My World' x"y z"`)).toEqual({
      args: ["-Dname=a b", "--title=My World", "xy z"],
    });
  });

  it("understands escaped quotes and spaces", () => {
    expect(splitArgs(`"say \\"hi\\"" a\\ b 'C:\\dir'`)).toEqual({
      args: ['say "hi"', "a b", "C:\\dir"], // single quotes keep backslashes
    });
  });

  it("keeps an empty quoted argument", () => {
    expect(splitArgs(`--name ""`)).toEqual({ args: ["--name", ""] });
  });

  it("gives nothing for empty input", () => {
    expect(splitArgs("")).toEqual({ args: [] });
    expect(splitArgs("   ")).toEqual({ args: [] });
  });

  it("reports an unclosed quote", () => {
    expect(splitArgs(`-Dx="open`)).toEqual({ error: "unclosedQuote" });
  });

  it("round-trips through joinArgs", () => {
    const args = ["-XX:+UseG1GC", "-Dname=a b", 'say "hi"', "", "back\\slash"];
    expect(joinArgs(args)).toBe(
      `-XX:+UseG1GC "-Dname=a b" "say \\"hi\\"" "" "back\\\\slash"`,
    );
    expect(splitArgs(joinArgs(args))).toEqual({ args });
  });
});
