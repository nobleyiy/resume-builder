import { emptyResume, hydrateDraft, type ProfileDraft, type Resume } from "./schema.ts";

export type ProfileSource = { id: string; name: string; text: string; draft: ProfileDraft };
export type ProfileConflict = { field: string; entryId?: string; values: { value: string; source: string }[] };
export type ProfileFacts = Pick<Resume, "basics" | "summary" | "achievements" | "experience" | "education" | "projects" | "skills" | "certifications">;
export type MasterProfile = {
  id: string;
  createdAt: number;
  sources: ProfileSource[];
  facts: ProfileFacts;
  conflicts: ProfileConflict[];
  mergeVersion?: number;
  provenance?: import("./canonicalProfile").EvidenceRecord[];
};

import { canonicalFacts, MATCH_VERSION, normalized } from "./canonicalProfile.ts";

function fingerprint(s: string): string {
  let h = 2166136261;
  for (const char of s) { h ^= char.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}

/** Reject model rewrites or invented strings before they reach stored facts.
 * Whitespace may differ after PDF extraction, but accepted wording stays verbatim. */
export function validateProfileDraft(draft: ProfileDraft, text: string): void {
  const source = text.normalize("NFKC").replace(/\s+/g, " ");
  const visit = (value: unknown, path: string) => {
    if (typeof value === "string" && value.trim() && !source.includes(value.normalize("NFKC").replace(/\s+/g, " ").trim())) {
      throw new Error(`${path} is not verbatim in the CV. Parse again using the original wording.`);
    }
    if (Array.isArray(value)) value.forEach((v, i) => visit(v, `${path}[${i}]`));
    else if (value && typeof value === "object") Object.entries(value).forEach(([k, v]) => visit(v, `${path}.${k}`));
  };
  visit(draft, "CV");
  draft.experience.forEach((job) => {
    if (job.current && !/\b(present|current)\b/i.test(job.end)) {
      throw new Error("A current job must have Present or Current in its source end date.");
    }
  });
}

/** Source variants are evidence, never additional printed resume entries. */
export function mergeProfiles(sources: ProfileSource[]): MasterProfile {
  if (!sources.length) throw new Error("Add at least one CV.");
  sources.forEach((s) => validateProfileDraft(s.draft, s.text));
  const seen = new Set<string>();
  const evidence = sources.filter((s) => {
    const k = normalized(s.text);
    if (seen.has(k)) return false;
    seen.add(k); return true;
  }).map((s) => ({ ...structuredClone(s), id: `source-${fingerprint(normalized(s.text))}` }));
  const inputs = evidence.map((s) => {
    const facts = hydrateDraft(s.draft, emptyResume());
    facts.achievements = [...s.draft.achievements];
    for (const section of ["experience", "education", "projects", "skills", "certifications"] as const) {
      facts[section].forEach((entry, i) => { entry.id = `${section}-${s.id}-${i}`; });
    }
    return { facts, source: s.name, sourceId: s.id };
  });
  const result = canonicalFacts(inputs);
  return { id: `profile-${fingerprint(evidence.map((s) => s.id).join("|"))}`, createdAt: Date.now(), sources: evidence, ...result, mergeVersion: MATCH_VERSION };
}
