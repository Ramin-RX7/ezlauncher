/**
 * The single IPC contract between the main process and the renderer.
 * Every channel is named here and nowhere else.
 */

export interface AppInfo {
  version: string;
  /** `process.platform` of the main process, e.g. `win32`, `linux`, `darwin`. */
  platform: string;
  arch: string;
  electron: string;
  node: string;
}

/** Renderer → main request/response calls (`ipcRenderer.invoke`). */
export interface IpcInvokeContract {
  "app:getInfo": { args: []; result: AppInfo };
}

/** Main → renderer push events (`webContents.send`). Empty until a scope adds one. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface IpcEventContract {}

export type InvokeChannel = keyof IpcInvokeContract;
export type InvokeArgs<C extends InvokeChannel> = IpcInvokeContract[C]["args"];
export type InvokeResult<C extends InvokeChannel> =
  IpcInvokeContract[C]["result"];

export type EventChannel = keyof IpcEventContract;
export type EventPayload<C extends EventChannel> = IpcEventContract[C];

/** Runtime list of channels; the preload only forwards these. Must match the contract. */
export const INVOKE_CHANNELS = [
  "app:getInfo",
] as const satisfies readonly InvokeChannel[];
export const EVENT_CHANNELS = [] as const satisfies readonly EventChannel[];

/** Errors cross the IPC boundary in this shape. */
export interface IpcError {
  code: string;
  message: string;
}

export type IpcResponse<T> =
  { ok: true; value: T } | { ok: false; error: IpcError };
