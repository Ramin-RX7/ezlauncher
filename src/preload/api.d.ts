import type {
  EventChannel,
  EventPayload,
  InvokeArgs,
  InvokeChannel,
  InvokeResult,
  IpcResponse,
} from "../shared/ipc";

export interface Api {
  invoke<C extends InvokeChannel>(
    channel: C,
    ...args: InvokeArgs<C>
  ): Promise<IpcResponse<InvokeResult<C>>>;
  on<C extends EventChannel>(
    channel: C,
    listener: (payload: EventPayload<C>) => void,
  ): () => void;
  /** Path of a file dropped into the page; empty if it isn't a file on disk. */
  pathForFile(file: File): string;
}

declare global {
  interface Window {
    api: Api;
  }
}
