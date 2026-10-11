import { emptyResume, hydrateDraft, uid, type ProfileDraft, type Resume } from "./schema.ts";

export type ProfileSource = { id: string; name: string; text: string; draft: ProfileDraft };
export type ProfileConflict = { field: string; values: { value: string; source: string }[] };
export type ProfileFacts = Pick<Resume, "basics" | "summary" | "achievements" | "experience" | "education" | "projects" | "skills" | "certifications">;
export type MasterProfile = {
  id: string;
  createdAt: number;
  sources: ProfileSource[];
  facts: ProfileFacts;
  conflicts: ProfileConflict[];
};

// Normalization is only for comparison; original strings are always retained.
const key = (value: string) => value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
const unique = (values: string[]) => {
  const seen = new Set<string>();
  return values.filter((value) => {
    const k = key(value);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

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

/** Deterministic union. Match only concrete identity fields; ambiguous records
 * stay separate. Scalar alternatives are retained with source provenance. */
export function mergeProfiles(sources: ProfileSource[]): MasterProfile {
  if (!sources.length) throw new Error("Add at least one CV.");
  sources.forEach((s) => validateProfileDraft(s.draft, s.text));
  const conflicts: ProfileConflict[] = [];
  const resumes = sources.map((s) => ({ source: s.name, resume: hydrateDraft(s.draft, emptyResume()) }));
  const scalar = (field: string, values: { value: string; source: string }[]) => {
    const seen = new Set<string>();
    const alternatives = values.filter((v) => {
      if (!key(v.value) || seen.has(key(v.value))) return false;
      seen.add(key(v.value)); return true;
    });
    if (alternatives.length > 1) conflicts.push({ field, values: alternatives });
    return alternatives[0]?.value || "";
  };
  const basics = { ...resumes[0].resume.basics };
  for (const field of Object.keys(basics) as (keyof typeof basics)[]) {
    basics[field] = scalar(`Contact: ${field}`, resumes.map((r) => ({ value: r.resume.basics[field], source: r.source })));
  }
  const summary = scalar("Summary", resumes.map((r) => ({ value: r.resume.summary, source: r.source })));
  type Entry = { id: string; [field: string]: string | boolean | string[] };
  const mergeEntries = (section: "experience" | "education" | "projects" | "certifications", identity: string[]) => {
    const groups = new Map<string, { entry: Entry; source: string }[]>();
    for (const { resume, source } of resumes) {
      for (const record of resume[section]) {
        const entry = record as unknown as Entry;
        const parts = identity.map((f) => key(String(entry[f] || "")));
        // Missing identities must not collapse unrelated records.
        const content = Object.fromEntries(Object.entries(entry).filter(([field]) => field !== "id"));
        const k = identity.filter((f) => f !== "start").every((f) => key(String(entry[f] || ""))) ? parts.join("\u0000") : JSON.stringify(content);
        const group = groups.get(k) || [];
        group.push({ entry, source }); groups.set(k, group);
      }
    }
    if (section === "experience" || section === "education") {
      const candidates = new Map<string, { value: string; source: string }[]>();
      for (const group of groups.values()) {
        const { entry } = group[0];
        const identityFields = identity.filter((f) => f !== "start");
        if (!identityFields.every((f) => key(String(entry[f] || "")))) continue;
        const k = identityFields.map((f) => key(String(entry[f]))).join(" / ");
        const records = candidates.get(k) || [];
        records.push(...group.map((g) => ({ value: JSON.stringify(Object.fromEntries(Object.entries(g.entry).filter(([f]) => f !== "id"))), source: g.source })));
        candidates.set(k, records);
      }
      for (const [identity, values] of candidates) {
        const starts = new Set(values.map((v) => key(JSON.parse(v.value).start)));
        if (starts.size > 1) conflicts.push({ field: `${section}: ${identity} — different dates; retained separately`, values });
      }
    }
    return [...groups.values()].map((group, index) => {
      const entry = structuredClone(group[0].entry);
      for (const field of Object.keys(entry)) {
        if (field === "id") continue;
        if (Array.isArray(entry[field])) {
          entry[field] = unique(group.flatMap((g) => g.entry[field] as string[]));
        } else if (typeof entry[field] === "string") {
          entry[field] = scalar(`${section} ${index + 1}: ${field}`, group.map((g) => ({ value: g.entry[field] as string, source: g.source })));
        } else if (group.some((g) => g.entry[field] !== entry[field])) {
          conflicts.push({ field: `${section} ${index + 1}: ${field}`, values: group.map((g) => ({ value: String(g.entry[field]), source: g.source })) });
        }
      }
      return entry;
    });
  };
  const skillGroups = new Map<string, Resume["skills"][number]>();
  const skillsSeen = new Set<string>();
  for (const { resume } of resumes) for (const g of resume.skills) {
    const group = skillGroups.get(key(g.name)) || { id: uid(), name: g.name, items: [] };
    for (const item of g.items) if (key(item) && !skillsSeen.has(key(item))) {
      group.items.push(item); skillsSeen.add(key(item));
    }
    skillGroups.set(key(g.name), group);
  }
  return {
    id: uid(), createdAt: Date.now(), sources: structuredClone(sources), conflicts,
    facts: {
      basics, summary,
      achievements: unique(sources.flatMap((s) => s.draft.achievements)),
      experience: mergeEntries("experience", ["company", "role", "start"]) as unknown as Resume["experience"],
      education: mergeEntries("education", ["school", "degree", "start"]) as unknown as Resume["education"],
      projects: mergeEntries("projects", ["name"]) as unknown as Resume["projects"],
      certifications: mergeEntries("certifications", ["name"]) as unknown as Resume["certifications"],
      skills: [...skillGroups.values()].filter((g) => g.items.length),
    },
  };
}
