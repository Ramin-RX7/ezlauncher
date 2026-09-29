import { useEffect, useRef } from "react";
import type { EventChannel, EventPayload } from "@shared/ipc";

/** Subscribe to a main-process event for the lifetime of the component. */
export function useIpcEvent<C extends EventChannel>(
  channel: C,
  handler: (payload: EventPayload<C>) => void,
): void {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(
    () =>
      window.api.on(channel, (payload) => {
        ref.current(payload);
      }),
    [channel],
  );
}
