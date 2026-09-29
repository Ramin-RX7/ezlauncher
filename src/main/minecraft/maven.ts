/** A parsed Maven coordinate: `group:artifact:version[:classifier][@extension]`. */
export interface MavenCoordinate {
  group: string;
  artifact: string;
  version: string;
  classifier?: string;
  extension: string;
}

export function parseCoordinate(name: string): MavenCoordinate | undefined {
  const [main = "", extension = "jar"] = name.split("@", 2);
  const parts = main.split(":");
  const [group, artifact, version, classifier] = parts;
  if (!group || !artifact || !version || parts.length > 4) return undefined;
  return {
    group,
    artifact,
    version,
    ...(classifier ? { classifier } : {}),
    extension,
  };
}

/** Repository-relative path with forward slashes, e.g. `org/ow2/asm/asm/9.7/asm-9.7.jar`. */
export function coordinateToPath(c: MavenCoordinate): string {
  const file = `${c.artifact}-${c.version}${c.classifier ? `-${c.classifier}` : ""}.${c.extension}`;
  return [...c.group.split("."), c.artifact, c.version, file].join("/");
}

/** Identity used to de-duplicate libraries across versions: `group:artifact[:classifier]`. */
export function libraryKey(name: string): string {
  const c = parseCoordinate(name);
  if (!c) return name;
  return [c.group, c.artifact, c.classifier].filter(Boolean).join(":");
}
