import { describe, expect, expectTypeOf, it } from "vitest";
import { INVOKE_CHANNELS, type InvokeChannel } from "./ipc";

describe("IPC contract", () => {
  it("lists every invoke channel exactly once", () => {
    expect(new Set(INVOKE_CHANNELS).size).toBe(INVOKE_CHANNELS.length);
  });

  it("runtime channel list covers the whole contract", () => {
    expectTypeOf<
      (typeof INVOKE_CHANNELS)[number]
    >().toEqualTypeOf<InvokeChannel>();
  });
});
