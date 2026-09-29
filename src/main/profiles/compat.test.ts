import { describe, expect, it } from "vitest";
import { checkCompat } from "./compat";

const fabric118 = { gameVersion: "1.18.2", loader: { id: "fabric" } };
const quilt118 = { gameVersion: "1.18.2", loader: { id: "quilt" } };

describe("checkCompat", () => {
  it("accepts a Fabric mod for the profile's version", () => {
    expect(
      checkCompat({ loaders: ["fabric"], mcVersionRange: ">=1.18" }, fabric118),
    ).toEqual({ status: "compatible" });
  });

  it("lets Quilt profiles use Fabric mods, but not the other way round", () => {
    expect(checkCompat({ loaders: ["fabric"] }, quilt118).status).toBe(
      "compatible",
    );
    expect(checkCompat({ loaders: ["quilt"] }, fabric118)).toEqual({
      status: "incompatible",
      reason: { code: "loader", loaders: ["quilt"] },
    });
  });

  it("refuses Forge mods in a Fabric profile", () => {
    expect(
      checkCompat(
        {
          loaders: ["forge"],
          mcVersionRange: "[1.18,1.19)",
          rangeFormat: "maven",
        },
        fabric118,
      ),
    ).toEqual({
      status: "incompatible",
      reason: { code: "loader", loaders: ["forge"] },
    });
  });

  it("names the version a mod needs", () => {
    expect(
      checkCompat({ loaders: ["fabric"], mcVersionRange: "1.20.1" }, fabric118),
    ).toEqual({
      status: "incompatible",
      reason: { code: "mcVersion", range: "1.20.1" },
    });
    expect(
      checkCompat(
        { loaders: ["fabric"], mcVersionRange: ["1.20.1", "1.20.2"] },
        fabric118,
      ).reason,
    ).toEqual({ code: "mcVersion", range: "1.20.1 or 1.20.2" });
  });

  it("is unknown when it can't tell", () => {
    expect(checkCompat({ loaders: [] }, fabric118).status).toBe("unknown");
    expect(
      checkCompat(
        { loaders: ["fabric"], mcVersionRange: "whatever" },
        fabric118,
      ).status,
    ).toBe("unknown");
    expect(
      checkCompat(
        { loaders: ["fabric"], mcVersionRange: ">=1.18" },
        { gameVersion: "24w14a", loader: { id: "fabric" } },
      ).status,
    ).toBe("unknown");
  });

  it("vanilla profiles take no mods", () => {
    expect(
      checkCompat(
        { loaders: ["fabric"] },
        { gameVersion: "1.18.2", loader: null },
      ),
    ).toEqual({ status: "incompatible", reason: { code: "vanilla" } });
  });
});
