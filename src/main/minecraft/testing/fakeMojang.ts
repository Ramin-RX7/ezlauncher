import { strToU8, zipSync } from "fflate";
import { JAVA_ALL_URL } from "../java";
import { MANIFEST_URL } from "../manifest";
import { createFakeFetch, sha1 } from "./fakeFetch";

/** A tiny fake Mojang: one version with a library, a native jar, assets, logging and Java. */
export function fakeMojang() {
  const libJar = "library-bytes";
  const nativeJar = zipSync({
    "liblwjgl.so": strToU8("native"),
    "META-INF/MANIFEST.MF": strToU8("skip me"),
  });
  const clientJar = "client-bytes";
  const logXml = "<log/>";
  const asset1 = "sound-data";
  const asset2 = "lang-data";
  const javaBin = "#!java";
  const assetIndex = JSON.stringify({
    objects: {
      "minecraft/sounds/a.ogg": { hash: sha1(asset1), size: asset1.length },
      "minecraft/lang/en.json": { hash: sha1(asset2), size: asset2.length },
      "minecraft/sounds/copy.ogg": { hash: sha1(asset1), size: asset1.length },
    },
  });
  const runtimeManifest = JSON.stringify({
    files: {
      bin: { type: "directory" },
      "bin/java": {
        type: "file",
        executable: true,
        downloads: {
          raw: {
            url: "https://java/bin/java",
            sha1: sha1(javaBin),
            size: javaBin.length,
          },
        },
      },
      "bin/java-link": { type: "link", target: "java" },
    },
  });
  const javaAll = JSON.stringify({
    linux: {
      "java-runtime-test": [
        {
          manifest: {
            url: "https://java/manifest.json",
            sha1: sha1(runtimeManifest),
            size: runtimeManifest.length,
          },
          version: { name: "21.0.0" },
        },
      ],
    },
  });
  const assetUrl = (d: string) =>
    `https://resources.download.minecraft.net/${sha1(d).slice(0, 2)}/${sha1(d)}`;
  const versionJson = JSON.stringify({
    id: "1.0",
    type: "release",
    mainClass: "net.minecraft.client.main.Main",
    javaVersion: { component: "java-runtime-test", majorVersion: 21 },
    assetIndex: {
      id: "idx",
      url: "https://meta/idx.json",
      sha1: sha1(assetIndex),
      size: assetIndex.length,
    },
    downloads: {
      client: {
        url: "https://meta/client.jar",
        sha1: sha1(clientJar),
        size: clientJar.length,
      },
    },
    logging: {
      client: {
        argument: "-Dlog4j.configurationFile=${path}",
        file: {
          id: "client.xml",
          url: "https://meta/client.xml",
          sha1: sha1(logXml),
          size: logXml.length,
        },
      },
    },
    libraries: [
      {
        name: "com.example:lib:1.0",
        downloads: {
          artifact: {
            path: "com/example/lib/1.0/lib-1.0.jar",
            url: "https://libs/lib.jar",
            sha1: sha1(libJar),
            size: libJar.length,
          },
        },
      },
      {
        name: "org.lwjgl:lwjgl-platform:2.9",
        natives: { linux: "natives-linux" },
        extract: { exclude: ["META-INF/"] },
        downloads: {
          classifiers: {
            "natives-linux": {
              path: "org/lwjgl/n.jar",
              url: "https://libs/n.jar",
              sha1: sha1(nativeJar),
              size: nativeJar.length,
            },
          },
        },
      },
    ],
  });
  const manifest = JSON.stringify({
    latest: { release: "1.0", snapshot: "1.0" },
    versions: [
      {
        id: "1.0",
        type: "release",
        url: "https://meta/1.0.json",
        sha1: sha1(versionJson),
        time: "t",
        releaseTime: "2020-01-01T00:00:00+00:00",
      },
    ],
  });

  return createFakeFetch({
    [MANIFEST_URL]: manifest,
    "https://meta/1.0.json": versionJson,
    "https://meta/idx.json": assetIndex,
    "https://meta/client.jar": clientJar,
    "https://meta/client.xml": logXml,
    "https://libs/lib.jar": libJar,
    "https://libs/n.jar": nativeJar,
    [assetUrl(asset1)]: asset1,
    [assetUrl(asset2)]: asset2,
    [JAVA_ALL_URL]: javaAll,
    "https://java/manifest.json": runtimeManifest,
    "https://java/bin/java": javaBin,
  });
}
