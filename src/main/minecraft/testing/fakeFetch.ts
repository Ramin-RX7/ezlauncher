import { createHash } from "node:crypto";
import type { FetchFn } from "../downloader";

/** Test helper: serves fixed bodies by URL and records every request. */
export function createFakeFetch(
  routes: Record<string, string | Uint8Array> = {},
) {
  const state = { offline: false };
  const requests: string[] = [];

  const fetch: FetchFn = (url) => {
    requests.push(url);
    if (state.offline) return Promise.reject(new TypeError("fetch failed"));
    const body = routes[url];
    if (body === undefined)
      return Promise.resolve(new Response("not found", { status: 404 }));
    return Promise.resolve(
      new Response(typeof body === "string" ? body : new Uint8Array(body)),
    );
  };

  return {
    fetch,
    requests,
    routes,
    /** Make every request fail as if the network were down. */
    setOffline(offline: boolean): void {
      state.offline = offline;
    },
  };
}

export function sha1(data: string | Uint8Array): string {
  return createHash("sha1").update(data).digest("hex");
}
