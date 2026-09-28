import type { IpcError } from "@shared/ipc";

/** An error with a stable machine-readable code, safe to send to the renderer. */
export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "AppError";
  }
}

export function toIpcError(err: unknown): IpcError {
  if (err instanceof AppError) return { code: err.code, message: err.message };
  return { code: "INTERNAL", message: "An unexpected error occurred." };
}
