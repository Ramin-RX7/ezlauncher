import { open, type FileHandle } from "node:fs/promises";
import { inflateSync } from "fflate";

/*
 * Read a few small entries from a zip without reading the whole file: the index
 * (central directory) at its end, then only the entries asked for. Resource packs
 * can be hundreds of MB; their `pack.mcmeta` and `pack.png` are a few KB.
 * Anything unusual (zip64, encryption, other compression) reads as "unreadable".
 */

export interface ZipEntry {
  name: string;
  method: number;
  flags: number;
  compressedSize: number;
  size: number;
  localHeaderOffset: number;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const EOCD_SIZE = 22;
const MAX_COMMENT = 0xffff;

async function readAt(
  file: FileHandle,
  position: number,
  length: number,
): Promise<Buffer | undefined> {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await file.read(buf, 0, length, position);
  return bytesRead === length ? buf : undefined;
}

async function readIndex(file: FileHandle): Promise<ZipEntry[] | undefined> {
  const { size } = await file.stat();
  if (size < EOCD_SIZE) return undefined;
  const tailLength = Math.min(size, MAX_COMMENT + EOCD_SIZE);
  const tail = await readAt(file, size - tailLength, tailLength);
  if (!tail) return undefined;
  let at = -1;
  for (let i = tailLength - EOCD_SIZE; i >= 0; i--) {
    if (tail.readUInt32LE(i) === EOCD) {
      at = i;
      break;
    }
  }
  if (at < 0) return undefined;
  const count = tail.readUInt16LE(at + 10);
  const dirSize = tail.readUInt32LE(at + 12);
  const dirOffset = tail.readUInt32LE(at + 16);
  if (count === 0xffff || dirSize === 0xffffffff || dirOffset === 0xffffffff)
    return undefined; // zip64
  if (dirOffset + dirSize > size - tailLength + at) return undefined;
  const dir = await readAt(file, dirOffset, dirSize);
  if (!dir) return undefined;

  const entries: ZipEntry[] = [];
  let pos = 0;
  for (let n = 0; n < count; n++) {
    if (pos + 46 > dirSize || dir.readUInt32LE(pos) !== CENTRAL)
      return undefined;
    const nameLength = dir.readUInt16LE(pos + 28);
    const extraLength = dir.readUInt16LE(pos + 30);
    const commentLength = dir.readUInt16LE(pos + 32);
    if (pos + 46 + nameLength > dirSize) return undefined;
    entries.push({
      flags: dir.readUInt16LE(pos + 8),
      method: dir.readUInt16LE(pos + 10),
      compressedSize: dir.readUInt32LE(pos + 20),
      size: dir.readUInt32LE(pos + 24),
      localHeaderOffset: dir.readUInt32LE(pos + 42),
      name: dir.toString("utf8", pos + 46, pos + 46 + nameLength),
    });
    pos += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function readData(
  file: FileHandle,
  entry: ZipEntry,
  maxBytes: number,
): Promise<Uint8Array | undefined> {
  if (entry.flags & 1) return undefined; // encrypted
  if (entry.size > maxBytes || entry.compressedSize > maxBytes)
    return undefined;
  const header = await readAt(file, entry.localHeaderOffset, 30);
  if (!header || header.readUInt32LE(0) !== LOCAL) return undefined;
  const start =
    entry.localHeaderOffset +
    30 +
    header.readUInt16LE(26) +
    header.readUInt16LE(28);
  // Sizes come from the index, so entries with a data descriptor read fine too.
  const raw = await readAt(file, start, entry.compressedSize);
  if (!raw) return undefined;
  if (entry.method === 0) return new Uint8Array(raw);
  if (entry.method !== 8) return undefined;
  try {
    const out = inflateSync(new Uint8Array(raw), {
      out: new Uint8Array(entry.size),
    });
    return out.length === entry.size ? out : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Open a zip and read the entries `pick` chooses from its index. Resolves to
 * undefined when the file isn't a zip this can read.
 */
export async function readZipEntries(
  path: string,
  pick: (entries: readonly ZipEntry[]) => readonly ZipEntry[],
  maxBytes: number,
): Promise<
  { entries: ZipEntry[]; data: Map<string, Uint8Array | undefined> } | undefined
> {
  let file: FileHandle | undefined;
  try {
    file = await open(path, "r");
    const entries = await readIndex(file);
    if (!entries) return undefined;
    const data = new Map<string, Uint8Array | undefined>();
    for (const entry of pick(entries))
      data.set(entry.name, await readData(file, entry, maxBytes));
    return { entries, data };
  } catch {
    return undefined;
  } finally {
    await file?.close();
  }
}
