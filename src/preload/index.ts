import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import {
  EVENT_CHANNELS,
  INVOKE_CHANNELS,
  type EventChannel,
  type EventPayload,
  type InvokeArgs,
  type InvokeChannel,
  type InvokeResult,
  type IpcResponse,
} from "@shared/ipc";
import type { Api } from "./api";

const invokeChannels = new Set<string>(INVOKE_CHANNELS);
const eventChannels = new Set<string>(EVENT_CHANNELS);

const api: Api = {
  /** Call a main-process handler. Resolves to `{ ok, value }` or `{ ok: false, error }`. */
  invoke<C extends InvokeChannel>(
    channel: C,
    ...args: InvokeArgs<C>
  ): Promise<IpcResponse<InvokeResult<C>>> {
    if (!invokeChannels.has(channel)) {
      return Promise.reject(new Error(`Unknown IPC channel: ${channel}`));
    }
    return ipcRenderer.invoke(channel, ...args) as Promise<
      IpcResponse<InvokeResult<C>>
    >;
  },

  /** Subscribe to a main-process event. Returns an unsubscribe function. */
  on<C extends EventChannel>(
    channel: C,
    listener: (payload: EventPayload<C>) => void,
  ): () => void {
    if (!eventChannels.has(channel))
      throw new Error(`Unknown IPC event: ${String(channel)}`);
    const wrapped = (
      _event: IpcRendererEvent,
      payload: EventPayload<C>,
    ): void => {
      listener(payload);
    };
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
};

contextBridge.exposeInMainWorld("api", api);
