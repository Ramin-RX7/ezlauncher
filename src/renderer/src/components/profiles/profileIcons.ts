/** The bundled profile icons, enumerated from the assets folder at build time. */
const modules: Record<string, string> = import.meta.glob(
  "../../assets/profile-icons/*.svg",
  { eager: true, query: "?url", import: "default" },
);

export interface ProfileIconChoice {
  id: string;
  url: string;
}

export const PROFILE_ICONS: ProfileIconChoice[] = Object.entries(modules)
  .map(([path, url]) => ({
    id: path.slice(path.lastIndexOf("/") + 1).replace(/\.svg$/, ""),
    url,
  }))
  .sort((a, b) => a.id.localeCompare(b.id));

const byId = new Map(PROFILE_ICONS.map((i) => [i.id, i.url]));

/** The URL of a built-in icon, or undefined for an unknown/missing id. */
export function profileIconUrl(id: string | undefined): string | undefined {
  return id ? byId.get(id) : undefined;
}
