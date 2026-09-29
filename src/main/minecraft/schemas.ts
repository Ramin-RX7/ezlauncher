import { z } from "zod";

/*
 * Schemas for the JSON files Mojang (and later mod loaders) publish.
 * They are tolerant on purpose: unknown fields are kept, and most fields are optional,
 * because version JSONs changed shape many times over the years.
 */

export const ruleSchema = z.looseObject({
  action: z.enum(["allow", "disallow"]),
  os: z
    .looseObject({
      name: z.string().optional(),
      arch: z.string().optional(),
      version: z.string().optional(),
    })
    .optional(),
  features: z.record(z.string(), z.boolean()).optional(),
});
export type Rule = z.infer<typeof ruleSchema>;

export const argumentSchema = z.union([
  z.string(),
  z.looseObject({
    rules: z.array(ruleSchema).optional(),
    value: z.union([z.string(), z.array(z.string())]),
  }),
]);
export type Argument = z.infer<typeof argumentSchema>;

export const artifactSchema = z.looseObject({
  path: z.string().optional(),
  sha1: z.string().optional(),
  size: z.number().optional(),
  url: z.string().optional(),
});
export type Artifact = z.infer<typeof artifactSchema>;

export const librarySchema = z.looseObject({
  name: z.string(),
  downloads: z
    .looseObject({
      artifact: artifactSchema.optional(),
      classifiers: z.record(z.string(), artifactSchema).optional(),
    })
    .optional(),
  /** Maven repository base URL (mod loader libraries). */
  url: z.string().optional(),
  sha1: z.string().optional(),
  size: z.number().optional(),
  natives: z.record(z.string(), z.string()).optional(),
  extract: z
    .looseObject({ exclude: z.array(z.string()).optional() })
    .optional(),
  rules: z.array(ruleSchema).optional(),
});
export type Library = z.infer<typeof librarySchema>;

const downloadSchema = z.looseObject({
  sha1: z.string(),
  size: z.number(),
  url: z.string(),
});

export const versionJsonSchema = z.looseObject({
  id: z.string(),
  type: z.string().optional(),
  inheritsFrom: z.string().optional(),
  mainClass: z.string().optional(),
  minecraftArguments: z.string().optional(),
  arguments: z
    .looseObject({
      game: z.array(argumentSchema).optional(),
      jvm: z.array(argumentSchema).optional(),
    })
    .optional(),
  libraries: z.array(librarySchema).optional(),
  downloads: z.looseObject({ client: downloadSchema.optional() }).optional(),
  assetIndex: z
    .looseObject({
      id: z.string(),
      sha1: z.string(),
      size: z.number(),
      url: z.string(),
      totalSize: z.number().optional(),
    })
    .optional(),
  assets: z.string().optional(),
  javaVersion: z
    .looseObject({ component: z.string(), majorVersion: z.number().optional() })
    .optional(),
  logging: z
    .looseObject({
      client: z
        .looseObject({
          argument: z.string(),
          file: z.looseObject({
            id: z.string(),
            sha1: z.string(),
            size: z.number(),
            url: z.string(),
          }),
          type: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
  releaseTime: z.string().optional(),
  time: z.string().optional(),
});
export type VersionJson = z.infer<typeof versionJsonSchema>;

export const versionManifestSchema = z.looseObject({
  latest: z.looseObject({ release: z.string(), snapshot: z.string() }),
  versions: z.array(
    z.looseObject({
      id: z.string(),
      type: z.string(),
      url: z.string(),
      time: z.string(),
      releaseTime: z.string(),
      sha1: z.string().optional(),
    }),
  ),
});
export type VersionManifest = z.infer<typeof versionManifestSchema>;
export type ManifestEntry = VersionManifest["versions"][number];

/** How the manifest is saved in `launcher/version_manifest.json`. */
export const cachedManifestSchema = z.object({
  schema: z.literal(1),
  fetchedAt: z.string(),
  manifest: versionManifestSchema,
});

export const assetIndexSchema = z.looseObject({
  objects: z.record(
    z.string(),
    z.looseObject({ hash: z.string(), size: z.number() }),
  ),
  virtual: z.boolean().optional(),
  map_to_resources: z.boolean().optional(),
});
export type AssetIndex = z.infer<typeof assetIndexSchema>;

export const javaAllSchema = z.record(
  z.string(),
  z.record(
    z.string(),
    z.array(
      z.looseObject({
        manifest: downloadSchema,
        version: z.looseObject({ name: z.string() }).optional(),
      }),
    ),
  ),
);
export type JavaAll = z.infer<typeof javaAllSchema>;

export const runtimeManifestSchema = z.looseObject({
  files: z.record(
    z.string(),
    z.discriminatedUnion("type", [
      z.looseObject({
        type: z.literal("file"),
        executable: z.boolean().optional(),
        downloads: z.looseObject({ raw: downloadSchema }),
      }),
      z.looseObject({ type: z.literal("directory") }),
      z.looseObject({ type: z.literal("link"), target: z.string() }),
    ]),
  ),
});
export type RuntimeManifest = z.infer<typeof runtimeManifestSchema>;

export const runtimeMarkerSchema = z.object({
  schema: z.literal(1),
  component: z.string(),
  platform: z.string(),
  versionName: z.string().optional(),
  installedAt: z.string(),
});

export const loaderMarkerSchema = z.object({
  id: z.string(),
  loaderVersion: z.string(),
  gameVersion: z.string(),
});

export const installMarkerSchema = z.object({
  schema: z.literal(1),
  versionId: z.string(),
  installedAt: z.string(),
  /** Set for mod loader installs; vanilla installs have none. */
  loader: loaderMarkerSchema.optional(),
  /** Libraries whose download couldn't be checked against a hash. */
  unverified: z.array(z.string()).optional(),
});
export type InstallMarker = z.infer<typeof installMarkerSchema>;

/** A loader's supported Minecraft versions, saved in `launcher/loaders/<id>.json`. */
export const loaderGameVersionsCacheSchema = z.object({
  schema: z.literal(1),
  fetchedAt: z.string(),
  versions: z.array(z.string()),
});
