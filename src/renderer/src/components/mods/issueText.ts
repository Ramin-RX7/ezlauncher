import type { TFunction } from "i18next";
import type { ValidationIssue } from "@shared/launcher";
import { loaderLabel, sourceName } from "./compatText";

const loaders = (t: TFunction, ids: readonly string[]) =>
  ids.map((l) => loaderLabel(t, l)).join(" / ");

/** "Needs Fabric API", "Made for 1.20.1, profile is 1.18.2", … */
export function issueText(t: TFunction, issue: ValidationIssue): string {
  switch (issue.code) {
    case "wrongLoader":
      return t("validation.issue.wrongLoader", {
        loaders: loaders(t, issue.loaders),
      });
    case "mcVersion":
      return t("validation.issue.mcVersion", {
        range: issue.range,
        gameVersion: issue.gameVersion,
      });
    case "loaderVersion":
      return t("validation.issue.loaderVersion", {
        loader: loaderLabel(t, issue.loader),
        range: issue.range,
        installed: issue.installed,
      });
    case "missingDep": {
      const name = issue.name ?? issue.depId;
      return issue.range === "*"
        ? t("validation.issue.missingDep", { name })
        : t("validation.issue.missingDepRange", { name, range: issue.range });
    }
    case "depVersion":
      return t("validation.issue.depVersion", {
        name: issue.otherName,
        range: issue.range,
        found: issue.found,
      });
    case "breaks":
    case "conflicts":
      return t(`validation.issue.${issue.code}`, { name: issue.otherName });
    case "duplicateId":
      return t("validation.issue.duplicateId", { name: issue.otherName });
    case "java":
      return t("validation.issue.java", {
        range: issue.range,
        java: issue.java,
      });
    case "damaged":
      return t(`validation.issue.damaged.${issue.reason}`);
    case "unknown":
      return t(`validation.issue.unknown.${issue.reason}`, {
        detail: issue.detail ?? "",
      });
    case "sourceMcVersion":
      return t("validation.issue.sourceMcVersion", {
        source: sourceName(t, issue.sourceId),
        versions: issue.versions,
        gameVersion: issue.gameVersion,
      });
    case "sourceLoader":
      return t("validation.issue.sourceLoader", {
        source: sourceName(t, issue.sourceId),
        loaders: loaders(t, issue.loaders),
      });
  }
}
