import { describe, expect, it } from "vitest";
import { mavenArtifactUrl } from "./loaders/maven";
import { coordinateToPath, libraryKey, parseCoordinate } from "./maven";

const path = (name: string) => {
  const c = parseCoordinate(name);
  return c && coordinateToPath(c);
};

describe("Maven coordinates", () => {
  it("builds the repository path", () => {
    expect(path("net.fabricmc:fabric-loader:0.16.14")).toBe(
      "net/fabricmc/fabric-loader/0.16.14/fabric-loader-0.16.14.jar",
    );
  });

  it("adds the classifier and extension", () => {
    expect(path("org.lwjgl:lwjgl:3.3.3:natives-windows")).toBe(
      "org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3-natives-windows.jar",
    );
    expect(path("net.minecraftforge:forge:1.20.1-47.2.0:installer@zip")).toBe(
      "net/minecraftforge/forge/1.20.1-47.2.0/forge-1.20.1-47.2.0-installer.zip",
    );
  });

  it("rejects malformed names", () => {
    expect(parseCoordinate("just-a-name")).toBeUndefined();
    expect(parseCoordinate("a:b")).toBeUndefined();
    expect(parseCoordinate("a:b:c:d:e")).toBeUndefined();
  });

  it("keys libraries by group, artifact and classifier, not version", () => {
    expect(libraryKey("org.ow2.asm:asm:9.7")).toBe("org.ow2.asm:asm");
    expect(libraryKey("org.lwjgl:lwjgl:3.3.3:natives-linux")).toBe(
      "org.lwjgl:lwjgl:natives-linux",
    );
  });

  it("builds a download URL from a repository base", () => {
    expect(
      mavenArtifactUrl(
        "https://maven.quiltmc.org/repository/release",
        "a.b:c:1",
      ),
    ).toBe("https://maven.quiltmc.org/repository/release/a/b/c/1/c-1.jar");
    expect(mavenArtifactUrl("https://repo/", "bad")).toBeUndefined();
  });
});
