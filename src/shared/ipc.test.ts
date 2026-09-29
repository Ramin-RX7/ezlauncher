import { describe, expect, expectTypeOf, it } from "vitest";
import {
  EVENT_CHANNELS,
  INVOKE_CHANNELS,
  type EventChannel,
  type InvokeChannel,
} from "./ipc";

describe("IPC contract", () => {
  it("lists every channel exactly once", () => {
    expect(new Set(INVOKE_CHANNELS).size).toBe(INVOKE_CHANNELS.length);
    expect(new Set(EVENT_CHANNELS).size).toBe(EVENT_CHANNELS.length);
  });

  it("runtime channel lists cover the whole contract", () => {
    expectTypeOf<
      (typeof INVOKE_CHANNELS)[number]
    >().toEqualTypeOf<InvokeChannel>();
    expectTypeOf<
      (typeof EVENT_CHANNELS)[number]
    >().toEqualTypeOf<EventChannel>();
  });
});
