import type { Resume } from "./schema.ts";
import type { ProfileConflict, ProfileFacts } from "./masterProfile.ts";

export const MATCH_VERSION = 3;
export const normalized = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
const words = (s: string) => normalized(s).replace(/[.,()®™]/g, " ").replace(/\s+/g, " ").trim();
export const companyKey = (s: string) => words(s).replace(/\b(?:incorporated|inc|limited|ltd|llc|l l c|corporation|corp|co)\b\s*$/g, "").trim();
export const schoolKey = (s: string) => companyKey(s).replace(/[, -]+(?:sudan|saudi arabia|united kingdom|united states|usa|uk|uae)$/g, "").trim();
export const roleKey = (s: string) => words(s).replace(/\bsr\b/g, "senior").replace(/\bjr\b/g, "junior").replace(/\bmgr\b/g, "manager").replace(/\basst\b/g, "assistant").replace(/\bvp\b/g, "vice president").split(/\s+/).sort().join(" ");
export const degreeKey = (s: string) => words(s)
  .replace(/\b(?:b sc|bsc|bachelor(?:'s|s)?(?: of)? science)\b/g, "bachelor science")
  .replace(/\b(?:b a|ba|bachelor(?:'s|s)?(?: of)? arts)\b/g, "bachelor arts")
  .replace(/\b(?:b eng|beng|bachelor(?:'s|s)?(?: of)? engineering)\b/g, "bachelor engineering")
  .replace(/\b(?:m sc|msc|master(?:'s|s)?(?: of)? science)\b/g, "master science")
  .replace(/\b(?:mba|master(?:'s|s)?(?: of)? business administration)\b/g, "master business administration");
export function certificationKey(s: string): string {
  const k = words(s).replace(/\s+/g, " ");
  if (/^(?:pmp(?: certification| certified)?|pmp project management professional|(?:pmi )?project management professional(?: pmp)?(?: certification| certified)?)$/.test(k)) return "pmp";
  if (/^(?:(?:cisco )?ccnp(?: certification| certified)?|ccnp cisco certified network professional|cisco certified network professional(?: ccnp)?(?: certification| certified)?)$/.test(k)) return "ccnp";
  return k;
}
export const skillKey = (s: string) => certificationKey(s)
  .replace(/\bms office\b/g, "microsoft office").replace(/\bms excel\b/g, "microsoft excel")
  .replace(/\bjs\b/g, "javascript").replace(/\bts\b/g, "typescript");

const semanticStopWords = new Set("a an the and or of to for in on at by with from as is are was were be been being that this these those it its their our while through across within into including include such using used use ensure ensuring ensured support supported supporting lead led leading manage managed managing provide provided providing develop developed developing design designed designing implement implemented implementing improve improved improving enhance enhanced enhancing establish established establishing coordinate coordinated coordinating work worked working contribute contributed contributing help helped helping review reviewed reviewing successfully key role played drive driving".split(" "));
const semanticStem = (token: string) => {
  const aliases: Record<string, string> = { operations: "operation", operational: "operation", regulatory: "compliance", regulations: "compliance", policies: "policy", processes: "process", systems: "system", services: "service", networks: "network", solutions: "solution", vendors: "vendor", suppliers: "vendor", stakeholders: "stakeholder", initiatives: "initiative", projects: "project", certifications: "certification", frameworks: "framework" };
  if (aliases[token]) return aliases[token];
  for (const suffix of ["ization", "isation", "ments", "ment", "tion", "ing", "ed", "ies", "s"]) if (token.length > suffix.length + 3 && token.endsWith(suffix)) return token.slice(0, -suffix.length);
  return token;
};
export function semanticTokens(value: string): Set<string> {
  const body = value.includes(":") ? value.slice(value.indexOf(":") + 1) : value;
  return new Set(normalized(body).replace(/\bpre[ -]sales\b/g, "presales").match(/[a-z0-9]+(?:\.[0-9]+)?%?/g)?.filter((token) => !semanticStopWords.has(token)).map(semanticStem) || []);
}
const numbers = (value: string) => new Set(normalized(value).match(/\b\d+(?:\.\d+)?%?\b/g) || []);
const hasNewNumber = (value: string, covered: Set<string>) => [...numbers(value)].some((n) => !covered.has(n));
const coveredBy = (value: string, covered: Set<string>, noveltyLimit: number, minimumShared: number) => {
  const tokens = semanticTokens(value);
  if (!tokens.size || hasNewNumber(value, covered)) return false;
  const shared = [...tokens].filter((token) => covered.has(token)).length;
  return shared >= minimumShared && (tokens.size - shared) / tokens.size <= noveltyLimit;
};

const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
export function dateKey(s: string): string {
  const k = words(s);
  if (/^(present|current|now|ongoing|to date)$/.test(k)) return "present";
  const year = k.match(/\b(?:19|20)\d{2}\b/)?.[0];
  if (!year) return k;
  const month = months.findIndex((m) => new RegExp(`\\b(?:${m}|${m.slice(0, 3)}${m === "september" ? "|sept" : ""})\\b`).test(k));
  const numeric = k.match(/^(\d{1,2})[/-]((?:19|20)\d{2})$/) || k.match(/^((?:19|20)\d{2})[-/](\d{1,2})(?:[-/]\d{1,2})?$/);
  let n = month + 1;
  if (!n && numeric) n = Number(numeric[1].length === 4 ? numeric[2] : numeric[1]);
  if (!n && k !== year) return k; // Unrecognized precision is never silently discarded.
  return n >= 1 && n <= 12 ? `${year}-${String(n).padStart(2, "0")}` : year;
}
export function compatibleDate(a: string, b: string): boolean {
  const x = dateKey(a), y = dateKey(b);
  return !x || !y || x === y || (/^\d{4}$/.test(x) && y.startsWith(`${x}-`)) || (/^\d{4}$/.test(y) && x.startsWith(`${y}-`));
}

// Explicit vocabulary equivalences, not a fuzzy similarity score. Numbers,
// entities, technologies, qualifiers and negations remain part of the key.
const equivalentWords: Record<string, string> = {
  designed: "design", designing: "design", designs: "design",
  maintained: "maintain", maintaining: "maintain", maintenance: "maintain",
  developed: "develop", developing: "develop", development: "develop",
  implemented: "implement", implementing: "implement", implementation: "implement",
  managed: "manage", managing: "manage", management: "manage",
  optimized: "optimize", optimised: "optimize", optimizing: "optimize", optimisation: "optimize", optimization: "optimize",
  reduced: "reduce", reducing: "reduce", reduction: "reduce",
  improved: "improve", improving: "improve", improvement: "improve",
  networks: "network", systems: "system", solutions: "solution", tools: "tool", costs: "cost", services: "service",
};
export function bulletKey(s: string): string {
  const tokens = normalized(s).replace(/\bpre[ -]sales\b/g, "presales").replace(/\bpercent\b/g, "%")
    .replace(/(?<!\d)[.,]|[.,](?!\d)|[;:!?()]/g, " ").split(/\s+/)
    .filter((t) => t && !/^(a|an|the|and|of|was|were)$/.test(t))
    .map((t) => equivalentWords[t] || t);
  const actions = tokens.filter((t) => new Set(Object.values(equivalentWords).filter((v) => !["network", "system", "solution", "tool", "cost", "service"].includes(v))).has(t));
  // Bag-of-words is safe only for a single simple action without attributed
  // actors or multiple metrics. Complex sentences keep their relationships.
  const simple = actions.length === 1 && !tokens.some((t) => /^(for|to|in|on|by|with|from|not|without)$/.test(t)) && tokens.filter((t) => /\d/.test(t)).length <= 1;
  return (simple ? tokens.sort() : tokens).join(" ");
}

/** Remove repeated complete sentences/clauses and verbatim repeated token
 * sequences. This only deletes repeats; it never generates replacement prose. */
export function cleanBullet(input: string): string {
  let text = input.trim();
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z])|;\s*/);
  const seen = new Set<string>();
  text = sentences.filter((s) => {
    const k = bulletKey(s);
    if (seen.has(k)) return false;
    seen.add(k); return true;
  }).map((s) => s.trim()).join(" ");
  // Adjacent repeated phrases of at least four words, ignoring a joining comma.
  const tokens = text.split(/\s+/);
  for (let size = Math.floor(tokens.length / 2); size >= 4; size--) {
    for (let i = 0; i + size * 2 <= tokens.length; i++) {
      const first = tokens.slice(i, i + size).map((w) => normalized(w).replace(/[,;.]$/, "")).join(" ");
      const second = tokens.slice(i + size, i + size * 2).map((w) => normalized(w).replace(/[,;.]$/, "")).join(" ");
      if (first === second) tokens.splice(i + size, size);
    }
  }
  for (let size = Math.floor(tokens.length / 2); size >= 4; size--) {
    for (let i = 0; i + size * 2 + 1 <= tokens.length; i++) {
      if (tokens[i + size].toLowerCase() !== "and") continue;
      const first = tokens.slice(i, i + size).map((w) => normalized(w).replace(/[,;.]$/, "")).join(" ");
      const second = tokens.slice(i + size + 1, i + size * 2 + 1).map((w) => normalized(w).replace(/[,;.]$/, "")).join(" ");
      if (first === second) tokens.splice(i + size, size + 1);
    }
  }
  // Source CVs sometimes contain a phrase pasted twice with one joining word
  // between copies. Remove only the second verbatim sequence.
  for (let size = Math.floor(tokens.length / 2); size >= 4; size--) {
    for (let first = 0; first + size < tokens.length; first++) {
      const phrase = tokens.slice(first, first + size).map((w) => normalized(w).replace(/[,;.]$/, "")).join(" ");
      for (let second = first + size; second + size <= tokens.length; second++) {
        const candidate = tokens.slice(second, second + size).map((w) => normalized(w).replace(/[,;.]$/, "")).join(" ");
        if (phrase === candidate) tokens.splice(second, size);
      }
    }
  }
  for (let i = tokens.length - 1; i > 0; i--) if (normalized(tokens[i]).replace(/[,;.]$/, "") === normalized(tokens[i - 1]).replace(/[,;.]$/, "")) tokens.splice(i, 1);
  return tokens.join(" ");
}
export function uniqueBullets(values: string[]): string[] {
  const seen = new Set<string>();
  const covered = new Set<string>();
  return values.map(cleanBullet).filter((s) => {
    const k = bulletKey(s);
    if (!k || seen.has(k) || coveredBy(s, covered, 0.35, 4)) return false;
    seen.add(k); semanticTokens(s).forEach((token) => covered.add(token)); return true;
  });
}

/** Keep the first source wording for a skill and discard later labels whose
 * meaning is already covered by the accumulated canonical skill list. */
export function uniqueSkills(values: string[]): string[] {
  const seen = new Set<string>(), covered = new Set<string>(), result: string[] = [];
  for (const value of values) {
    const key = skillKey(value);
    const tokens = semanticTokens(value);
    if (!key || seen.has(key) || (tokens.size > 1 && coveredBy(value, covered, 0.5, 1))) continue;
    seen.add(key); semanticTokens(value).forEach((token) => covered.add(token)); result.push(value);
  }
  return result;
}

export type EvidenceRecord = { section: string; entryId: string; sourceId: string; source: string; original: unknown };
export type FactInput = { facts: ProfileFacts; sourceId: string; source: string };
type Entry = { id: string; [field: string]: string | boolean | string[] };
export function canonicalFacts(inputs: FactInput[]): { facts: ProfileFacts; conflicts: ProfileConflict[]; provenance: EvidenceRecord[] } {
  if (!inputs.length) throw new Error("No facts to consolidate.");
  const conflicts: ProfileConflict[] = [], provenance: EvidenceRecord[] = [];
  const scalar = (field: string, values: { value: string; source: string }[], match = normalized, entryId?: string, disputedDate = false) => {
    const alternatives: typeof values = [];
    for (const v of values) if (v.value.trim() && !alternatives.some((a) => match(a.value) === match(v.value))) alternatives.push(v);
    // Year-only and month+year describe compatible precision, not a conflict.
    if (disputedDate && alternatives.every((a) => alternatives.every((b) => compatibleDate(a.value, b.value)))) {
      return [...alternatives].sort((a, b) => dateKey(b.value).length - dateKey(a.value).length)[0]?.value || "";
    }
    if (alternatives.length > 1) conflicts.push({ field, values: alternatives, ...(entryId ? { entryId } : {}) });
    return disputedDate && alternatives.length > 1 ? "" : alternatives[0]?.value || "";
  };
  const base = inputs[0].facts;
  const facts: ProfileFacts = structuredClone({ basics: base.basics, summary: base.summary, achievements: base.achievements, experience: base.experience, education: base.education, projects: base.projects, skills: base.skills, certifications: base.certifications });
  for (const field of Object.keys(facts.basics) as (keyof typeof facts.basics)[]) facts.basics[field] = scalar(`Contact: ${field}`, inputs.map((i) => ({ value: i.facts.basics[field], source: i.source })));
  facts.summary = scalar("Summary", inputs.map((i) => ({ value: i.facts.summary, source: i.source })));
  const mergeEntries = (section: "experience" | "education" | "projects" | "certifications") => {
    const groups: { identity: string; start: string; records: { entry: Entry; input: FactInput }[] }[] = [];
    for (const input of inputs) for (const raw of input.facts[section]) {
      const entry = raw as unknown as Entry;
      let identity: string;
      if (section === "experience") identity = entry.company && entry.role ? `${companyKey(String(entry.company))}|${roleKey(String(entry.role))}` : `unknown|${JSON.stringify(Object.fromEntries(Object.entries(entry).filter(([k]) => k !== "id")))}`;
      else if (section === "education") identity = entry.school && entry.degree ? `${schoolKey(String(entry.school))}|${degreeKey(String(entry.degree))}` : `unknown|${JSON.stringify(Object.fromEntries(Object.entries(entry).filter(([k]) => k !== "id")))}`;
      else identity = section === "certifications" ? certificationKey(String(entry.name)) : words(String(entry.name));
      const start = String(entry.start || "");
      const candidates = groups.filter((g) => {
        if (g.identity !== identity) return false;
        const prior = g.records[0].entry;
        if (section === "education" && entry.field && prior.field && words(String(entry.field)) !== words(String(prior.field))) return false;
        if (section !== "experience" && section !== "education") return true;
        if (g.start && start) return compatibleDate(g.start, start);
        // Without a start date, require the same end date or identical job
        // evidence; an unknown period must not bridge unrelated periods.
        if (dateKey(String(prior.end || "")) !== dateKey(String(entry.end || ""))) return false;
        return section === "education" || !!prior.end || JSON.stringify(prior.bullets) === JSON.stringify(entry.bullets);
      });
      // Missing dates cannot bridge multiple distinct employment periods.
      const group = candidates.length === 1 ? candidates[0] : undefined;
      if (group) {
        group.records.push({ entry, input });
        if (dateKey(start).length > dateKey(group.start).length) group.start = start;
      } else groups.push({ identity, start, records: [{ entry, input }] });
    }
    if (section === "experience" || section === "education") {
      for (const group of groups) {
        const alternatives = groups.filter((g) => g !== group && g.identity === group.identity);
        if (alternatives.length && groups.indexOf(group) < groups.indexOf(alternatives[0])) {
          conflicts.push({ field: `${section}: ${group.identity} — different dates; retained separately`, values: [group, ...alternatives].flatMap((g) => g.records.map((r) => ({ value: JSON.stringify(r.entry), source: r.input.source }))) });
        }
      }
    }
    return groups.map((group, index) => {
      const { entry: first } = group.records[0];
      const entry = structuredClone(first);
      entry.id = first.id;
      for (const { entry: original, input } of group.records) provenance.push({ section, entryId: entry.id, sourceId: input.sourceId, source: input.source, original: structuredClone(original) });
      for (const field of Object.keys(entry)) {
        if (field === "id") continue;
        if (Array.isArray(entry[field])) entry[field] = uniqueBullets(group.records.flatMap((r) => r.entry[field] as string[]));
        else if (typeof entry[field] === "string") {
          const match = field === "company" ? companyKey : field === "school" ? schoolKey : field === "role" ? roleKey : field === "degree" ? degreeKey : field === "name" && section === "certifications" ? certificationKey : field === "start" || field === "end" || field === "date" ? dateKey : normalized;
          entry[field] = scalar(`${section} ${index + 1}: ${field}`, group.records.map((r) => ({ value: r.entry[field] as string, source: r.input.source })), match, entry.id, field === "start" || field === "end" || field === "date");
        }
      }
      if (section === "experience") {
        const states = new Set(group.records.map((r) => r.entry.current));
        if (states.size > 1) {
          conflicts.push({ field: `${section} ${index + 1}: current`, entryId: entry.id, values: group.records.map((r) => ({ value: String(r.entry.current), source: r.input.source })) });
          entry.current = false;
          entry.end = ""; // Never print Present when sources disagree.
        } else entry.current = !!entry.end && first.current === true;
      }
      if (Array.isArray(entry.bullets)) {
        const metrics = new Map<string, { value: string; source: string }[]>();
        for (const r of group.records) for (const value of (r.entry.bullets || []) as string[]) {
          const k = bulletKey(value).split(" ").filter((t) => !/^[$€£]?\d[\d,.]*%?$/.test(t)).join(" ");
          const values = metrics.get(k) || [];
          if (!values.some((v) => bulletKey(v.value) === bulletKey(value))) values.push({ value, source: r.input.source });
          metrics.set(k, values);
        }
        for (const values of metrics.values()) if (values.length > 1) conflicts.push({ field: `${section} ${index + 1}: conflicting bullet metrics`, entryId: entry.id, values });
      }
      if (Array.isArray(entry.bullets)) {
        for (let a = 0; a < entry.bullets.length; a++) for (let b = a + 1; b < entry.bullets.length; b++) {
          const left = new Set(bulletKey(entry.bullets[a]).split(" "));
          const right = new Set(bulletKey(entry.bullets[b]).split(" "));
          const all = new Set([...left, ...right]);
          const shared = [...left].filter((t) => right.has(t)).length;
          if (all.size >= 5 && shared / all.size >= 0.7) {
            conflicts.push({ field: `${section} ${index + 1}: possible repeated fact — review wording and scope`, entryId: entry.id, values: [{ value: entry.bullets[a], source: group.records[0].input.source }, { value: entry.bullets[b], source: group.records[0].input.source }] });
          }
        }
      }
      return entry;
    });
  };
  facts.experience = mergeEntries("experience") as unknown as Resume["experience"];
  facts.education = mergeEntries("education") as unknown as Resume["education"];
  facts.certifications = mergeEntries("certifications") as unknown as Resume["certifications"];
  facts.projects = mergeEntries("projects") as unknown as Resume["projects"];
  const skillGroups = new Map<string, Resume["skills"][number]>();
  for (const input of inputs) for (const raw of input.facts.skills) {
    const group = skillGroups.get(words(raw.name)) || { ...raw, items: [] };
    for (const item of raw.items) {
      group.items.push(item);
      provenance.push({ section: "skills", entryId: group.id, sourceId: input.sourceId, source: input.source, original: item });
    }
    skillGroups.set(words(raw.name), group);
  }
  const allSkills = uniqueSkills([...skillGroups.values()].flatMap((g) => g.items));
  const remainingSkills = new Set(allSkills);
  facts.skills = [...skillGroups.values()].map((g) => ({ ...g, items: g.items.filter((item) => {
    if (!remainingSkills.has(item)) return false;
    remainingSkills.delete(item); return true;
  }) })).filter((g) => g.items.length);
  facts.achievements = uniqueBullets(inputs.flatMap((i) => i.facts.achievements));
  for (const input of inputs) for (const value of input.facts.achievements) provenance.push({ section: "achievements", entryId: "", sourceId: input.sourceId, source: input.source, original: value });
  const used = new Set<string>(), usedExact = new Set<string>();
  facts.experience.flatMap((e) => e.bullets).forEach((b) => { usedExact.add(bulletKey(b)); semanticTokens(b).forEach((token) => used.add(token)); });
  const redundant = (value: string) => !!value && (usedExact.has(bulletKey(value)) || coveredBy(value, used, 0.35, 4));
  facts.projects = facts.projects.map((p) => ({ ...p, description: redundant(p.description) ? "" : p.description, bullets: p.bullets.filter((b) => !redundant(b)) })).filter((p, i) => p.description || p.bullets.length || p.link || (!facts.projects[i].description && !facts.projects[i].bullets.length));
  facts.projects.forEach((p) => { if (p.description) usedExact.add(bulletKey(p.description)); semanticTokens(p.description).forEach((token) => used.add(token)); p.bullets.forEach((b) => { usedExact.add(bulletKey(b)); semanticTokens(b).forEach((token) => used.add(token)); }); });
  facts.achievements = facts.achievements.filter((b) => !redundant(b));
  return { facts, conflicts, provenance };
}
