import type {
  InvokeArgs,
  InvokeChannel,
  InvokeResult,
  IpcError,
} from "@shared/ipc";

/** A failed IPC call, carrying the main process's error code. */
export class IpcCallError extends Error {
  readonly code: string;
  readonly channel: string;

  constructor(channel: string, error: IpcError) {
    super(error.message);
    this.name = "IpcCallError";
    this.code = error.code;
    this.channel = channel;
  }
}

/** Call the main process. Resolves to the result, or throws `IpcCallError`. */
export async function invoke<C extends InvokeChannel>(
  channel: C,
  ...args: InvokeArgs<C>
): Promise<InvokeResult<C>> {
  const response = await window.api.invoke(channel, ...args);
  if (!response.ok) throw new IpcCallError(channel, response.error);
  return response.value;
}

/** The path of a file dropped into the page. */
export function pathForFile(file: File): string {
  return window.api.pathForFile(file);
}
