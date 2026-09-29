import { vi } from "vitest";
import type { InvokeChannel, InvokeResult } from "@shared/ipc";

type Handlers = {
  [C in InvokeChannel]?: (
    ...args: unknown[]
  ) => InvokeResult<C> | Promise<InvokeResult<C>>;
};

/** Install a fake `window.api`: each channel answers from `handlers`, others fail. */
export function mockApi(handlers: Handlers) {
  const invoke = vi.fn(async (channel: InvokeChannel, ...args: unknown[]) => {
    const handler = handlers[channel] as
      ((...a: unknown[]) => unknown) | undefined;
    if (!handler)
      return {
        ok: false,
        error: { code: "INTERNAL", message: `no mock for ${channel}` },
      };
    try {
      return { ok: true, value: await handler(...args) };
    } catch (err) {
      const code = (err as { code?: string }).code ?? "INTERNAL";
      return { ok: false, error: { code, message: String(err) } };
    }
  });
  const listeners = new Map<string, ((payload: unknown) => void)[]>();
  const on = vi.fn((channel: string, listener: (payload: unknown) => void) => {
    listeners.set(channel, [...(listeners.get(channel) ?? []), listener]);
    return () => undefined;
  });
  window.api = { invoke, on } as unknown as typeof window.api;
  return {
    invoke,
    emit(channel: string, payload: unknown) {
      for (const l of listeners.get(channel) ?? []) l(payload);
    },
  };
}
