import { useMutation } from "@tanstack/react-query";
import { invoke } from "./api";

/**
 * "Copy diagnostics": the bug-report text (names and paths already hidden by the
 * main process) put on the clipboard. Resolves to the text, so it can be shown.
 */
export function useCopyDiagnostics() {
  return useMutation({
    mutationFn: async (profileId?: string) => {
      const text = await invoke(
        "app:diagnostics",
        profileId ? { profileId } : {},
      );
      await navigator.clipboard.writeText(text);
      return text;
    },
  });
}
