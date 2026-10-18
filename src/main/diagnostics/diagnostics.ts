import { redact, type Secrets } from "./redact";

/*
 * "Copy diagnostics": what a bug report needs, as plain text, with everything that
 * identifies the user replaced (see redact.ts). Gathered by the caller (Electron
 * side), formatted here.
 */

export const MAX_DIAGNOSTICS_CHARS = 100_000;

export interface DiagnosticsProfile {
  name: string;
  gameVersion: string;
  loader?: string;
  /** The pinned loader build, if any. */
  loaderBuild?: string;
  installedVersionId?: string;
  modpack?: string;
  memoryMaxMb?: number;
  extraJvmArgs?: number;
  extraGameArgs?: number;
  running: boolean;
  playTimeMs?: number;
  mods: {
    name: string;
    version?: string;
    modId?: string;
    fromModrinth: boolean;
  }[];
  /** `severity code (mod)` lines from the mod check. */
  issues: string[];
  /** The newest crash report: its name and first lines. */
  crashReport?: { name: string; modifiedAt: string; head: string };
  latestLog?: string;
}

export interface DiagnosticsInput {
  createdAt: string;
  app: {
    version: string;
    build: string;
    electron: string;
    os: string;
    arch: string;
    totalMemoryMb: number;
    dataDriveFreeMb?: number;
  };
  settings?: {
    memoryMaxMb: number;
    onGameStart: string;
    extraJvmArgs: number;
    extraGameArgs: number;
  };
  java?: string[];
  profile?: DiagnosticsProfile;
  launcherLog?: string;
  secrets: Secrets;
}

function section(title: string, lines: (string | undefined | false)[]) {
  const body = lines.filter((l): l is string => typeof l === "string");
  return body.length ? `## ${title}\n${body.join("\n")}\n` : "";
}

function block(title: string, text: string | undefined) {
  return text?.trim() ? `## ${title}\n\`\`\`\n${text.trimEnd()}\n\`\`\`\n` : "";
}

const minutes = (ms: number) => `${Math.round(ms / 60_000)} min`;

/** The report, with secrets replaced and at most `MAX_DIAGNOSTICS_CHARS` long. */
export function formatDiagnostics(input: DiagnosticsInput): string {
  const { app, settings, java, profile } = input;
  const parts = [
    `# EZLauncher diagnostics (${input.createdAt})\n`,
    section("Launcher", [
      `- Version: ${app.version} (${app.build})`,
      `- System: ${app.os}, ${app.arch}, ${app.totalMemoryMb} MB RAM`,
      `- Electron: ${app.electron}`,
      app.dataDriveFreeMb !== undefined &&
        `- Free space on the data drive: ${app.dataDriveFreeMb} MB`,
    ]),
    settings
      ? section("Settings", [
          `- Memory: ${settings.memoryMaxMb} MB`,
          `- When the game starts: ${settings.onGameStart}`,
          `- Extra JVM arguments: ${settings.extraJvmArgs}, extra game arguments: ${settings.extraGameArgs}`,
        ])
      : "",
    java?.length
      ? section(
          "Java",
          java.map((j) => `- ${j}`),
        )
      : "",
    profile
      ? section("Profile", [
          `- Minecraft ${profile.gameVersion}, ${profile.loader ?? "vanilla"}${profile.loaderBuild ? ` ${profile.loaderBuild} (pinned)` : ""}`,
          profile.installedVersionId &&
            `- Installed version: ${profile.installedVersionId}`,
          profile.modpack && `- Mod pack: ${profile.modpack}`,
          `- Memory: ${profile.memoryMaxMb !== undefined ? `${profile.memoryMaxMb} MB (own)` : "global"}, JVM arguments: ${profile.extraJvmArgs ?? "global"}, game arguments: ${profile.extraGameArgs ?? "global"}`,
          `- Running: ${profile.running ? "yes" : "no"}${profile.playTimeMs ? `, played ${minutes(profile.playTimeMs)}` : ""}`,
        ])
      : "",
    profile
      ? section(
          `Enabled mods (${profile.mods.length})`,
          profile.mods.map(
            (m) =>
              `- ${m.name}${m.version ? ` ${m.version}` : ""}${m.modId ? ` [${m.modId}]` : ""}${m.fromModrinth ? "" : " (not from Modrinth)"}`,
          ),
        )
      : "",
    profile?.issues.length
      ? section(
          "Mod check",
          profile.issues.map((i) => `- ${i}`),
        )
      : "",
    profile?.crashReport
      ? block(
          `Newest crash report: ${profile.crashReport.name} (${profile.crashReport.modifiedAt})`,
          profile.crashReport.head,
        )
      : "",
    block("Game log (end of latest.log)", profile?.latestLog),
    block("Launcher log (end)", input.launcherLog),
  ];
  let text = redact(parts.filter(Boolean).join("\n"), input.secrets);
  if (text.length > MAX_DIAGNOSTICS_CHARS)
    text = `${text.slice(0, MAX_DIAGNOSTICS_CHARS)}\n… (cut)\n`;
  return text;
}
