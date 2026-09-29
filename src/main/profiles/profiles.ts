import { randomUUID } from "node:crypto";
import { z } from "zod";
import { PROFILE_NAME_MAX, type Profile } from "@shared/launcher";
import { AppError } from "../core/errors";
import { readJson, writeJsonAtomic } from "../core/fsAtomic";
import { safeId } from "../minecraft/paths";

const idString = z.string().refine((s) => {
  try {
    safeId(s);
    return true;
  } catch {
    return false;
  }
}, "invalid id");

const memorySchema = z.number().int().min(512).max(65536);
const argsSchema = z.array(z.string().max(4096)).max(200);

const profileSchema = z.object({
  id: idString,
  name: z.string().min(1).max(PROFILE_NAME_MAX),
  gameVersion: idString,
  loader: z.object({ id: idString }).nullable(),
  installedVersionId: idString.optional(),
  memoryMaxMb: memorySchema.optional(),
  extraJvmArgs: argsSchema.optional(),
  extraGameArgs: argsSchema.optional(),
  createdAt: z.string(),
  lastPlayedAt: z.string().optional(),
});

const fileSchema = z.object({
  schema: z.literal(1),
  profiles: z.array(profileSchema),
});

/** What the renderer may send; `null` clears an optional value. */
const inputSchema = z
  .object({
    name: z.string().trim().min(1).max(PROFILE_NAME_MAX),
    gameVersion: idString,
    loader: z.object({ id: idString }).strict().nullable(),
    memoryMaxMb: memorySchema.nullable().optional(),
    extraJvmArgs: argsSchema.nullable().optional(),
    extraGameArgs: argsSchema.nullable().optional(),
  })
  .strict();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError(
      "INVALID_PROFILE",
      result.error.issues[0]?.message ?? "Invalid profile.",
    );
  }
  return result.data;
}

type Input = z.infer<typeof inputSchema>;

function applyOptional(profile: Profile, input: Partial<Input>): Profile {
  const next = { ...profile };
  if (input.memoryMaxMb === null) delete next.memoryMaxMb;
  else if (input.memoryMaxMb !== undefined)
    next.memoryMaxMb = input.memoryMaxMb;
  // An empty list is a real override: "no extra arguments", instead of the global ones.
  if (input.extraJvmArgs === null) delete next.extraJvmArgs;
  else if (input.extraJvmArgs !== undefined)
    next.extraJvmArgs = input.extraJvmArgs;
  if (input.extraGameArgs === null) delete next.extraGameArgs;
  else if (input.extraGameArgs !== undefined)
    next.extraGameArgs = input.extraGameArgs;
  return next;
}

export function sameLoader(a: Profile["loader"], b: Profile["loader"]) {
  return (a?.id ?? null) === (b?.id ?? null);
}

/**
 * `launcher/profiles.json`. Every change is written atomically, one at a time,
 * so concurrent requests never lose each other's updates.
 */
export function createProfileStore(
  file: string,
  { now = () => new Date() }: { now?: () => Date } = {},
) {
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };

  async function read(): Promise<Profile[]> {
    return (await readJson(file, fileSchema))?.profiles ?? [];
  }
  async function write(profiles: Profile[]): Promise<void> {
    await writeJsonAtomic(file, { schema: 1, profiles });
  }

  /** Change one profile inside the queue. */
  function change(id: string, fn: (p: Profile) => Profile): Promise<Profile> {
    return serial(async () => {
      const profiles = await read();
      const index = profiles.findIndex((p) => p.id === id);
      const current = profiles[index];
      if (!current)
        throw new AppError("PROFILE_NOT_FOUND", `No profile ${id}.`);
      const next = parse(profileSchema, fn(current));
      profiles[index] = next;
      await write(profiles);
      return next;
    });
  }

  /** Add a complete profile record (e.g. from migration). */
  async function add(profile: Profile): Promise<Profile> {
    const valid = parse(profileSchema, profile);
    return serial(async () => {
      const profiles = await read();
      if (profiles.some((p) => p.id === valid.id))
        throw new AppError("PROFILE_EXISTS", `Profile ${valid.id} exists.`);
      await write([...profiles, valid]);
      return valid;
    });
  }

  return {
    list: (): Promise<Profile[]> => serial(read),
    add,

    async get(id: string): Promise<Profile | undefined> {
      return (await serial(read)).find((p) => p.id === id);
    },

    async create(input: unknown): Promise<Profile> {
      const data = parse(inputSchema, input);
      const profile = applyOptional(
        {
          id: randomUUID(),
          name: data.name,
          gameVersion: data.gameVersion,
          loader: data.loader,
          createdAt: now().toISOString(),
        },
        data,
      );
      return add(profile);
    },

    /**
     * Edit a profile. Changing the version or loader forgets the installed version,
     * so the next Play installs the new one. Renaming never touches files.
     */
    async update(id: string, patch: unknown): Promise<Profile> {
      const data = parse(inputSchema.partial(), patch);
      return change(id, (current) => {
        let next: Profile = { ...current };
        if (data.name !== undefined) next.name = data.name;
        if (data.gameVersion !== undefined) next.gameVersion = data.gameVersion;
        if (data.loader !== undefined) next.loader = data.loader;
        if (
          next.gameVersion !== current.gameVersion ||
          !sameLoader(next.loader, current.loader)
        ) {
          delete next.installedVersionId;
        }
        next = applyOptional(next, data);
        return next;
      });
    },

    remove(id: string): Promise<void> {
      return serial(async () => {
        const profiles = await read();
        await write(profiles.filter((p) => p.id !== id));
      });
    },

    setInstalled(id: string, versionId: string): Promise<Profile> {
      return change(id, (p) => ({ ...p, installedVersionId: versionId }));
    },

    touchLastPlayed(id: string): Promise<Profile> {
      return change(id, (p) => ({ ...p, lastPlayedAt: now().toISOString() }));
    },
  };
}

export type ProfileStore = ReturnType<typeof createProfileStore>;
