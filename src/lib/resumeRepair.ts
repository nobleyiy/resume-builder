import { canonicalFacts, MATCH_VERSION, uniqueBullets, skillKey } from "./canonicalProfile.ts";
import { mergeProfiles, type ProfileConflict, type ProfileFacts } from "./masterProfile.ts";
import { resumeToText } from "./text.ts";
import { emptyResume, type Resume, type TailorResult } from "./schema.ts";

const factsOf = (r: Resume): ProfileFacts => ({ basics: r.basics, summary: r.summary, achievements: r.achievements, experience: r.experience, education: r.education, projects: r.projects, skills: r.skills, certifications: r.certifications });

/** Repair the working document, not a reconstruction from old source CVs.
 * This keeps deletions, added facts and unsaved revisions made in the editor. */
export function repairResume(current: Resume): Resume {
  const result = canonicalFacts([{ facts: factsOf(current), source: "Working resume", sourceId: current.id }]);
  const next: Resume = { ...structuredClone(current), ...result.facts, sectionOrder: [...new Set(current.sectionOrder)] };
  if (current.masterProfile) {
    const rebuilt = mergeProfiles(current.masterProfile.sources);
    const prior = current.masterProfile.conflicts || [];
    const conflicts: ProfileConflict[] = [];
    for (const c of [...rebuilt.conflicts, ...prior, ...result.conflicts]) {
      const k = `${c.field}|${JSON.stringify(c.values)}`;
      if (!conflicts.some((x) => `${x.field}|${JSON.stringify(x.values)}` === k)) conflicts.push(c);
    }
    const provenance = [...(current.masterProfile.provenance || []), ...rebuilt.provenance || [], ...result.provenance];
    const seen = new Set<string>();
    next.masterProfile = {
      ...rebuilt, id: current.masterProfile.id, createdAt: current.masterProfile.createdAt,
      mergeVersion: MATCH_VERSION, conflicts,
      provenance: provenance.filter((p) => { const k = JSON.stringify(p); if (seen.has(k)) return false; seen.add(k); return true; }),
    };
  }
  return next;
}

/** A revision is a replacement at stable canonical entry IDs, not a union of
 * old and generated bullets. Unknown/duplicate indexes are rejected. */
export function tailoringFacts(current: Resume): ProfileFacts {
  return canonicalFacts([{ facts: factsOf(current), source: "Working resume", sourceId: current.id }]).facts;
}

export function applyTailorRevision(current: Resume, source: ProfileFacts, result: TailorResult, parts: { head: boolean; bullets: boolean; skills: boolean }): Resume {
  const indexes = new Set<number>();
  for (const e of result.experience) {
    if (indexes.has(e.index) || !Number.isInteger(e.index) || !source.experience[e.index]) throw new Error("The revision contains duplicate or unknown job indexes. Analyze again.");
    indexes.add(e.index);
  }
  const next = structuredClone(current);
  if (parts.head) { next.basics.headline = result.headline || next.basics.headline; next.summary = result.summary || next.summary; }
  if (parts.bullets) {
    const canonical = tailoringFacts(current);
    next.experience = canonical.experience.map((e) => {
      const index = source.experience.findIndex((s) => s.id === e.id);
      const revision = result.experience.find((t) => t.index === index);
      return { ...e, bullets: uniqueBullets(revision?.bullets ?? e.bullets) };
    });
  }
  if (parts.skills) {
    const seen = new Set<string>();
    next.skills = result.skills.map((g, index) => ({ ...g, id: `tailored-skills-${index}`, items: g.items.filter((v) => { const k = skillKey(v); if (!k || seen.has(k)) return false; seen.add(k); return true; }) })).filter((g) => g.items.length);
  }
  const cleaned = canonicalFacts([{ facts: factsOf(next), source: "AI revision", sourceId: current.id }]);
  // Only replacement sections and redundant cross-section text are changed.
  if (parts.bullets) {
    next.experience = cleaned.facts.experience;
    next.projects = cleaned.facts.projects;
    next.achievements = cleaned.facts.achievements;
  }
  if (parts.skills) next.skills = cleaned.facts.skills;
  return next;
}

export function resumeCounts(r: ProfileFacts) {
  const text = resumeToText("sectionOrder" in r ? r as Resume : { ...emptyResume(), ...r });
  return { jobs: r.experience.length, bullets: r.experience.reduce((n, e) => n + e.bullets.length, 0), skills: r.skills.reduce((n, g) => n + g.items.length, 0), education: r.education.length, certifications: r.certifications.length, projects: r.projects.length, achievements: r.achievements.length, words: text.split(/\s+/).filter(Boolean).length };
}
