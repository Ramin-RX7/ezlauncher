import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Check, Copy, ExternalLink } from "lucide-react";
import { chunkbasePlatform, chunkbaseUrl } from "@shared/chunkbase";
import type {
  MapPoint,
  ProfileInfo,
  WorldInfo,
  WorldMapInfo,
} from "@shared/launcher";
import { invoke } from "../../lib/api";
import { errorMessage } from "../../lib/errors";
import { useVersionList } from "../../state/queries";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { RadioGroup } from "../ui/RadioGroup";

type Place = "player" | "respawn" | "spawn" | "death";

const PLACES = ["player", "respawn", "spawn", "death"] as const;

/** Open a world in Chunkbase's Seed Map, at the player's last position, respawn point, the world spawn or last death. */
export function SeedMapDialog({
  profile,
  world,
  onClose,
}: {
  profile: ProfileInfo;
  world: WorldInfo;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const labelId = useId();
  const info = useQuery({
    queryKey: ["worlds", "mapInfo", profile.id, world.id],
    queryFn: () =>
      invoke("worlds:mapInfo", { profileId: profile.id, worldId: world.id }),
  });
  const versions = useVersionList();
  const [chosen, setChosen] = useState<Place>();
  const [copied, setCopied] = useState(false);

  const map = info.data;
  const points: Record<Place, MapPoint | undefined> = {
    player: map?.player,
    respawn: map?.respawn,
    spawn: map?.spawn,
    death: map?.lastDeath,
  };
  const place: Place | undefined = chosen ?? PLACES.find((p) => points[p]);
  const version = map?.version ?? profile.gameVersion;
  const platform =
    map && versions.data
      ? chunkbasePlatform(
          version,
          map.worldType === "largeBiomes",
          versions.data.versions,
        )
      : undefined;
  // While the version list loads, don't claim the version is unsupported.
  const blocked =
    map && blockedReason(map, platform !== undefined || versions.isPending);
  const point = place && points[place];
  const url =
    map?.seed && platform && !blocked
      ? chunkbaseUrl({
          seed: map.seed,
          platform: platform.platform,
          ...(point && { point }),
        })
      : undefined;

  /** Where a choice is, or why it isn't known. */
  const detail = (p: Place): string => {
    const at = points[p];
    if (at)
      return t("seedMap.at", {
        dimension: t(`seedMap.dimension.${at.dimension}`),
        x: at.x,
        z: at.z,
      });
    if (p === "spawn") return t("seedMap.noSpawn");
    if (!map?.playerFound) return t("seedMap.noPlayer");
    if (p === "respawn") return t("seedMap.noRespawn");
    return p === "player" ? t("seedMap.playerElsewhere") : t("seedMap.noDeath");
  };

  const choices = PLACES.map((p) => ({
    value: p,
    disabled: points[p] === undefined,
    label: (
      <span className="flex flex-col">
        <span>{t(`seedMap.place.${p}`)}</span>
        <span className="text-xs text-muted">{detail(p)}</span>
      </span>
    ),
  }));

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("seedMap.title", { name: world.name })}
      description={t("seedMap.description")}
      closeLabel={t("seedMap.cancel")}
      footer={
        <>
          <Button onClick={onClose}>{t("seedMap.cancel")}</Button>
          <Button
            variant="primary"
            disabled={!url}
            onClick={() => {
              if (url) window.open(url);
              onClose();
            }}
          >
            <ExternalLink size={16} aria-hidden />
            {t("seedMap.open")}
          </Button>
        </>
      }
    >
      {info.isPending && (
        <p className="text-sm text-muted">{t("seedMap.reading")}</p>
      )}
      {info.isError && (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(t, info.error)}
        </p>
      )}
      {map && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span id={labelId} className="text-sm font-medium">
              {t("seedMap.where")}
            </span>
            <RadioGroup<Place>
              labelledBy={labelId}
              value={place ?? "spawn"}
              onChange={setChosen}
              options={choices}
            />
          </div>
          {map.seed && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted">{t("seedMap.seed")}</span>
              <code
                dir="ltr"
                className="rounded-ezl bg-surface-2 px-2 py-0.5 text-xs select-all"
              >
                {map.seed}
              </code>
              <Button
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => {
                  if (!map.seed) return;
                  void navigator.clipboard.writeText(map.seed).then(() => {
                    setCopied(true);
                  });
                }}
              >
                {copied ? (
                  <Check size={14} aria-hidden />
                ) : (
                  <Copy size={14} aria-hidden />
                )}
                {copied ? t("seedMap.copied") : t("seedMap.copySeed")}
              </Button>
            </div>
          )}
          {blocked ? (
            <p role="alert" className="text-sm text-warning">
              {t(`seedMap.blocked.${blocked}`, { version })}
            </p>
          ) : (
            <ul className="flex list-disc flex-col gap-1 ps-5 text-xs text-muted">
              <li>{t("seedMap.note.version", { version })}</li>
              <li>{t("seedMap.note.lastSave")}</li>
              {platform?.approximate && (
                <li>{t("seedMap.note.approximate")}</li>
              )}
              {map.worldType === "amplified" && (
                <li>{t("seedMap.note.amplified")}</li>
              )}
              {profile.loader && <li>{t("seedMap.note.modded")}</li>}
            </ul>
          )}
        </div>
      )}
    </Dialog>
  );
}

/** Why the map can't be opened for this world, if it can't. */
function blockedReason(
  map: WorldMapInfo,
  versionKnown: boolean,
): "noSeed" | "worldType" | "version" | undefined {
  if (!map.seed) return "noSeed";
  if (map.worldType === "flat" || map.worldType === "custom")
    return "worldType";
  if (!versionKnown) return "version";
  return undefined;
}
