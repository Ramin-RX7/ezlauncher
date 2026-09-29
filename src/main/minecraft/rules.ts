import type { Platform } from "./platform";
import type { Rule } from "./schemas";

export interface RuleEnv {
  platform: Platform;
  /** Launcher features (`is_demo_user`, `has_custom_resolution`, …). Missing = false. */
  features?: Record<string, boolean>;
}

function matches(rule: Rule, env: RuleEnv): boolean {
  const { os, features } = rule;
  if (os) {
    if (os.name !== undefined && os.name !== env.platform.os) return false;
    if (os.arch !== undefined && os.arch !== env.platform.arch) return false;
    if (os.version !== undefined) {
      try {
        if (!new RegExp(os.version).test(env.platform.osVersion)) return false;
      } catch {
        return false;
      }
    }
  }
  if (features) {
    for (const [name, wanted] of Object.entries(features)) {
      if ((env.features?.[name] ?? false) !== wanted) return false;
    }
  }
  return true;
}

/**
 * Mojang rule semantics: no rules means allowed. Otherwise start disallowed,
 * and every rule that matches sets the result to its action; the last match wins.
 */
export function rulesAllow(
  rules: readonly Rule[] | undefined,
  env: RuleEnv,
): boolean {
  if (!rules || rules.length === 0) return true;
  let allowed = false;
  for (const rule of rules) {
    if (matches(rule, env)) allowed = rule.action === "allow";
  }
  return allowed;
}
