import type { HarnessManifest, Skill } from "./harness.js";

export interface RouteDecision {
  skill?: Skill;
  reason: "explicit" | "trigger" | "single-skill" | "general" | "unresolved";
  candidates?: Skill[];
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Host-side routing from the manifest triggers (ADR-0003). Phase 4 implements
 * deterministic trigger matching plus a single-skill fallback; the bounded
 * `choose/4` judgment and dispatcher DML are added in a later phase.
 */
export function routeRequest(manifest: HarnessManifest, message: string, explicitSkill?: string): RouteDecision {
  if (explicitSkill) {
    const skill = manifest.skills.find((candidate) => candidate.id === explicitSkill);
    if (skill) return { skill, reason: "explicit" };
  }

  const text = normalize(message);
  if (!text && manifest.skills.length === 1) {
    return { skill: manifest.skills[0], reason: "single-skill" };
  }

  const matches: Array<{ skill: Skill; trigger: string }> = [];
  for (const skill of manifest.skills) {
    for (const trigger of skill.triggers) {
      const needle = normalize(trigger);
      if (needle && text.includes(needle)) matches.push({ skill, trigger: needle });
    }
  }

  if (matches.length === 0) {
    if (manifest.skills.length === 1) return { skill: manifest.skills[0], reason: "single-skill" };
    const general = manifest.skills.find((candidate) => candidate.id === "general");
    if (general) return { skill: general, reason: "general" };
    return { reason: "unresolved", candidates: manifest.skills };
  }

  // Longest matching trigger wins; ties resolve to the first skill.
  const best = matches.reduce((left, right) => (right.trigger.length > left.trigger.length ? right : left));
  return { skill: best.skill, reason: "trigger" };
}
