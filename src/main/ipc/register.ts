import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron";
import type {
  EventChannel,
  EventPayload,
  InvokeArgs,
  InvokeChannel,
  InvokeResult,
  IpcResponse,
} from "@shared/ipc";
import { AppError, toIpcError } from "../core/errors";
import { getLogger } from "../log";

type Handler<C extends InvokeChannel> = (
  event: IpcMainInvokeEvent,
  ...args: InvokeArgs<C>
) => InvokeResult<C> | Promise<InvokeResult<C>>;

/**
 * Register a typed handler for a channel from the IPC contract.
 * Errors are logged and returned as `{ ok: false, error }` instead of being thrown across IPC,
 * so the renderer always gets a clean, serialisable error.
 */
export function handle<C extends InvokeChannel>(
  channel: C,
  handler: Handler<C>,
): void {
  const log = getLogger().child("ipc");
  ipcMain.handle(
    channel,
    async (
      event,
      ...args: unknown[]
    ): Promise<IpcResponse<InvokeResult<C>>> => {
      try {
        const value = await handler(event, ...(args as InvokeArgs<C>));
        return { ok: true, value };
      } catch (err) {
        if (err instanceof AppError && err.code === "CANCELLED") {
          log.info(`${channel} cancelled`);
        } else {
          log.error(`${channel} failed`, err);
        }
        return { ok: false, error: toIpcError(err) };
      }
    },
  );
}

/** Send a typed event from the IPC contract to every open window. */
export function broadcast<C extends EventChannel>(
  channel: C,
  payload: EventPayload<C>,
): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}
