import { open, stat } from "node:fs/promises";
import { sha1File } from "../minecraft/verify";
import type { DamageReason } from "./types";

/*
 * Is a mod file damaged? Every launch: the file exists, its size is right and the
 * jar's index opens (only its end is read). The full SHA1 costs time, so it only runs
 * when the file changed since it was last hashed, or when asked (Check mods).
 */

export interface IntegrityFile {
  sha1: string;
  /** The stored file, `mods-store/<sha1>.jar`. */
  path: string;
  /** The size recorded when the mod entered the library. */
  size?: number;
  /** When the SHA1 was last found right. */
  verified?: { size: number; mtimeMs: number };
  /** Profile copies of this mod (where hard links don't work). */
  copies?: readonly string[];
}

export interface IntegrityResult {
  damaged: Map<string, DamageReason>;
  /** Files whose SHA1 was checked and right now: save these as `verified`. */
  verified: { sha1: string; size: number; mtimeMs: number }[];
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const EOCD_SIZE = 22;
const MAX_COMMENT = 0xffff;

/** Does the zip's central directory (its index) read cleanly? Reads only the end of the file. */
export async function jarIndexOpens(
  path: string,
  size: number,
): Promise<boolean> {
  if (size < EOCD_SIZE) return false;
  const file = await open(path, "r");
  try {
    const tailLength = Math.min(size, MAX_COMMENT + EOCD_SIZE);
    const tail = Buffer.alloc(tailLength);
    await file.read(tail, 0, tailLength, size - tailLength);
    let at = -1;
    for (let i = tailLength - EOCD_SIZE; i >= 0; i--) {
      if (tail.readUInt32LE(i) === EOCD) {
        at = i;
        break;
      }
    }
    if (at < 0) return false;
    const entries = tail.readUInt16LE(at + 10);
    const dirSize = tail.readUInt32LE(at + 12);
    const dirOffset = tail.readUInt32LE(at + 16);
    // Zip64: the real values are elsewhere; the jar counts as fine.
    if (
      entries === 0xffff ||
      dirSize === 0xffffffff ||
      dirOffset === 0xffffffff
    )
      return true;
    const eocdOffset = size - tailLength + at;
    if (dirOffset + dirSize > eocdOffset) return false;
    const dir = Buffer.alloc(dirSize);
    const { bytesRead } = await file.read(dir, 0, dirSize, dirOffset);
    if (bytesRead !== dirSize) return false;
    let pos = 0;
    for (let n = 0; n < entries; n++) {
      if (pos + 46 > dirSize || dir.readUInt32LE(pos) !== CENTRAL) return false;
      pos +=
        46 +
        dir.readUInt16LE(pos + 28) +
        dir.readUInt16LE(pos + 30) +
        dir.readUInt16LE(pos + 32);
    }
    return pos <= dirSize;
  } catch {
    return false;
  } finally {
    await file.close();
  }
}

/** One file's quick check, then its SHA1 if needed. undefined = fine. */
async function checkFile(
  path: string,
  sha1: string,
  expectedSize: number | undefined,
  hash: (current: { size: number; mtimeMs: number }) => boolean,
  onVerified?: (current: { size: number; mtimeMs: number }) => void,
): Promise<DamageReason | undefined> {
  let info;
  try {
    info = await stat(path);
  } catch {
    return "missing";
  }
  if (!info.isFile()) return "missing";
  const current = { size: info.size, mtimeMs: Math.floor(info.mtimeMs) };
  if (expectedSize !== undefined && current.size !== expectedSize)
    return "size";
  if (!(await jarIndexOpens(path, current.size))) return "unreadable";
  if (!hash(current)) return undefined;
  try {
    if ((await sha1File(path)) !== sha1) return "sha1";
  } catch {
    return "unreadable";
  }
  onVerified?.(current);
  return undefined;
}

export async function checkIntegrity(
  files: readonly IntegrityFile[],
  { full = false }: { full?: boolean } = {},
): Promise<IntegrityResult> {
  const result: IntegrityResult = { damaged: new Map(), verified: [] };
  for (const f of files) {
    const changed = (current: { size: number; mtimeMs: number }) =>
      full ||
      f.verified?.size !== current.size ||
      f.verified.mtimeMs !== current.mtimeMs;
    let reason = await checkFile(f.path, f.sha1, f.size, changed, (current) => {
      result.verified.push({ sha1: f.sha1, ...current });
    });
    // Copies have no record of their own: quick check, and the SHA1 on Check mods.
    for (const copy of f.copies ?? []) {
      reason ??= await checkFile(copy, f.sha1, f.size, () => full);
    }
    if (reason) result.damaged.set(f.sha1, reason);
  }
  return result;
}
