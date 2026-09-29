import { describe, expect, it } from "vitest";
import { createDownloader } from "../downloader";
import { createFakeFetch } from "../testing/fakeFetch";
import {
  createFabricProvider,
  FABRIC_META_URL,
  pickFabricLoader,
} from "./fabric";

const build = (version: string, stable: boolean) => ({
  loader: { version, stable },
});

describe("pickFabricLoader", () => {
  it("takes the first stable build (the list is newest first)", () => {
    expect(
      pickFabricLoader([
        build("0.17.0", false),
        build("0.16.14", true),
        build("0.16.13", true),
      ]),
    ).toBe("0.16.14");
  });

  it("returns undefined with no stable build", () => {
    expect(pickFabricLoader([build("0.1.0", false)])).toBeUndefined();
  });
});

describe("Fabric provider", () => {
  const setup = (routes: Record<string, string>) => {
    const fake = createFakeFetch(routes);
    const fabric = createFabricProvider({
      downloader: createDownloader({
        fetch: fake.fetch,
        userAgent: "t",
        retries: 0,
      }),
    });
    return { fake, fabric };
  };

  it("lists supported Minecraft versions", async () => {
    const { fabric } = setup({
      [`${FABRIC_META_URL}/versions/game`]: JSON.stringify([
        { version: "1.21.4", stable: true },
        { version: "1.18.2", stable: true },
      ]),
    });
    expect(await fabric.listGameVersions()).toEqual(["1.21.4", "1.18.2"]);
  });

  it("gets the version JSON, escaping ids in the URL", async () => {
    const url = `${FABRIC_META_URL}/versions/loader/1.14%20Pre-Release%201/0.16.14/profile/json`;
    const { fake, fabric } = setup({
      [url]: JSON.stringify({
        id: "fabric-loader-0.16.14-1.14 Pre-Release 1",
        inheritsFrom: "1.14 Pre-Release 1",
      }),
    });
    const json = await fabric.getVersionJson("1.14 Pre-Release 1", "0.16.14");
    expect(json.inheritsFrom).toBe("1.14 Pre-Release 1");
    expect(fake.requests).toEqual([url]);
  });

  it("rejects data that isn't a version JSON", async () => {
    const { fabric } = setup({
      [`${FABRIC_META_URL}/versions/loader/1.18.2/0.1/profile/json`]: "{}",
    });
    await expect(fabric.getVersionJson("1.18.2", "0.1")).rejects.toMatchObject({
      code: "BAD_RESPONSE",
    });
  });
});
