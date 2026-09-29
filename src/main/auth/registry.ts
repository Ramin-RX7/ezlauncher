import { AppError } from "../core/errors";
import { offlineProvider } from "./providers/offline";
import type { AuthProvider } from "./types";

/** All login methods. Adding Microsoft login later = one more provider here. */
const providers = new Map<string, AuthProvider>([
  [offlineProvider.id, offlineProvider],
]);

export function getProvider(id: string): AuthProvider {
  const provider = providers.get(id);
  if (!provider)
    throw new AppError("UNKNOWN_PROVIDER", `Unknown login method: ${id}`);
  return provider;
}
