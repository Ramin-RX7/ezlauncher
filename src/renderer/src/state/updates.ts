import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { UpdateState } from "@shared/updates";
import { invoke } from "../lib/api";
import { useIpcEvent } from "../lib/useIpcEvent";

export const updateKeys = {
  state: ["updates", "state"] as const,
  prefs: ["updates", "prefs"] as const,
};

/** The launcher update's state, kept live by `updates:state` events. */
export function useUpdateState() {
  const queryClient = useQueryClient();
  useIpcEvent("updates:state", (state) => {
    queryClient.setQueryData(updateKeys.state, state);
  });
  return useQuery({
    queryKey: updateKeys.state,
    queryFn: () => invoke("updates:state"),
  });
}

/** The update a state is about, if any. */
export function stateUpdate(state: UpdateState | undefined) {
  return state && "update" in state ? state.update : undefined;
}
