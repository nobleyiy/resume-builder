import test from "node:test";
import assert from "node:assert/strict";
import { emptyResume, type ProfileDraft, type Resume, type TailorResult } from "./schema.ts";
import { mergeProfiles, type ProfileSource } from "./masterProfile.ts";
import { repairResume, applyTailorRevision, resumeCounts, tailoringFacts } from "./resumeRepair.ts";
import { uniqueBullets, dateKey } from "./canonicalProfile.ts";
import { preserveResumeBackup } from "./resumeBackup.ts";

const draft = (): ProfileDraft => ({ basics: emptyResume().basics, summary: "", achievements: [], experience: [{ company: "Geidea", role: "Service Delivery Senior Manager", start: "2022", end: "June 2025", current: false, location: "", bullets: ["Designed networks", "Reduced costs by 10%"] }], education: [{ school: "City University", degree: "Bachelor of Science", field: "Computing", start: "2016", end: "2019", location: "", notes: "" }], certifications: [{ name: "Project Management Professional (PMP)", issuer: "PMI", date: "2020" }, { name: "Cisco Certified Network Professional", issuer: "Cisco", date: "2021" }], projects: [], skills: [{ name: "Tools", items: ["MS Office", "TypeScript", "C++", "C#"] }] });
const source = (name: string, d = draft()): ProfileSource => ({ id: name, name, draft: d, text: JSON.stringify(d) });
const profileResume = (sources: ProfileSource[]): Resume => { const masterProfile = mergeProfiles(sources); return { ...emptyResume(), ...structuredClone(masterProfile.facts), masterProfile }; };

test("reimporting identical source evidence is idempotent, including record IDs", () => {
  const s = source("CV.docx");
  const one = mergeProfiles([s]); const two = mergeProfiles([s, { ...s, id: "other", name: "copy.docx" }]);
  assert.deepEqual(one.facts, two.facts);
  assert.equal(two.sources.length, 1);
  assert.deepEqual(mergeProfiles(two.sources).facts, two.facts);
});

test("Sr/Senior, company suffixes and Sep/September consolidate the same period", () => {
  const a = draft(); a.experience[0].company = "INET LLC"; a.experience[0].start = "September 2011"; a.experience[0].end = "2021";
  const b = structuredClone(a); b.experience[0].company = "INET"; b.experience[0].role = "Service Delivery Sr. Manager"; b.experience[0].start = "Sep 2011"; b.experience[0].bullets[0] = "Network design";
  const p = mergeProfiles([source("a", a), source("b", b)]);
  assert.equal(p.facts.experience.length, 1);
  assert.equal(p.facts.experience[0].bullets.length, 2);
  assert.equal(p.conflicts.length, 0);
  assert.equal(p.provenance?.filter((p) => p.section === "experience").length, 2);
  assert.equal(dateKey("09/2011"), dateKey("September 2011"));
});

test("Geidea end-date conflicts do not print a chosen date or Present", () => {
  const a = draft(), b = draft(); b.experience[0].role = "Service Delivery Sr. Manager"; b.experience[0].end = "Present"; b.experience[0].current = true;
  const p = mergeProfiles([source("ended", a), source("ongoing", b)]);
  assert.equal(p.facts.experience.length, 1);
  assert.equal(p.facts.experience[0].end, "");
  assert.equal(p.facts.experience[0].current, false);
  assert.deepEqual(p.conflicts.find((c) => c.field.endsWith(": end"))?.values.map((v) => v.value), ["June 2025", "Present"]);
});

test("distinct positions and nonmatching employment periods stay separate", () => {
  const a = draft(), b = draft(), c = draft(); b.experience[0].role = "Service Delivery Director"; c.experience[0].start = "2010"; c.experience[0].end = "2015";
  const p = mergeProfiles([source("a", a), source("b", b), source("c", c)]);
  assert.equal(p.facts.experience.length, 3);
  assert.ok(p.conflicts.some((c) => c.field.includes("different dates")));
});

test("degree, PMP, CCNP and cross-category skill aliases are deduplicated", () => {
  const b = draft(); b.education[0].degree = "B.Sc."; b.certifications[0].name = "PMP"; b.certifications[1].name = "CCNP";
  b.skills = [{ name: "Software", items: ["Microsoft Office", "typescript", "C++", "C#"] }];
  const p = mergeProfiles([source("a"), source("b", b)]);
  assert.equal(p.facts.education.length, 1);
  assert.equal(p.facts.certifications.length, 2);
  assert.equal(p.facts.skills.flatMap((g) => g.items).length, 4);
});

test("exact, supported semantic and within-bullet repeats are removed, while metrics and scope survive", () => {
  assert.deepEqual(uniqueBullets(["Designed networks", "Designed networks.", "Network design", "Designed networks. Designed networks.", "Designed secure corporate networks Designed secure corporate networks", "Designed secure corporate networks and Designed secure corporate networks"]), ["Designed networks", "Designed secure corporate networks"]);
  const distinct = ["Reduced costs by 10%", "Reduced costs by 20%", "Reduced costs by 10.5%", "Reduced costs by 5.10%", "Designed networks for Acme", "Designed networks with Acme", "Maintained networks", "Designed networks without downtime"];
  assert.deepEqual(uniqueBullets(distinct), distinct);
});

test("metrics differing on the same claim remain as evidence and are flagged", () => {
  const b = draft(); b.experience[0].bullets[1] = "Reduced costs by 20%";
  const p = mergeProfiles([source("a"), source("b", b)]);
  assert.equal(p.facts.experience[0].bullets.length, 3);
  assert.ok(p.conflicts.some((c) => c.field.includes("metrics")));
});

test("full cross-section repetition is removed; useful project detail remains", () => {
  const a = draft(); a.achievements = ["Network design", "Won industry award"];
  a.projects = [{ name: "Network refresh", link: "", description: "Designed networks", bullets: ["Network design", "Migrated 12 offices"] }];
  const p = mergeProfiles([source("a", a)]);
  assert.deepEqual(p.facts.achievements, ["Won industry award"]);
  assert.deepEqual(p.facts.projects[0].bullets, ["Migrated 12 offices"]);
  assert.equal(p.facts.projects[0].description, "");
  assert.equal(p.sources[0].draft.projects[0].bullets.length, 2);
});

test("AI revision replaces the target by stable ID, is idempotent, and cannot restore deleted jobs", () => {
  const r = profileResume([source("a")]);
  const snapshot = tailoringFacts(r);
  const result: TailorResult = { headline: "Manager", summary: "Experience", experience: [{ index: 0, bullets: ["Network design", "Network design"] }], skills: [{ name: "Tools", items: ["SQL", "sql"] }], keywords: { matched: [], missing: [] }, notes: [] };
  const parts = { head: true, bullets: true, skills: true };
  const first = applyTailorRevision(r, snapshot, result, parts);
  assert.deepEqual(first.experience[0].bullets, ["Network design"]);
  assert.deepEqual(applyTailorRevision(first, snapshot, result, parts), first);
  assert.deepEqual(first.masterProfile, r.masterProfile);
  assert.equal(applyTailorRevision({ ...r, experience: [] }, snapshot, result, parts).experience.length, 0);
  assert.throws(() => applyTailorRevision(r, snapshot, { ...result, experience: [result.experience[0], result.experience[0]] }, parts), /duplicate/);
});

test("repair preserves unsaved edits, source originals and a first recoverable backup", () => {
  const saved = profileResume([source("a")]);
  const working = structuredClone(saved);
  working.summary = "Unsaved summary"; working.title = "Unsaved title";
  working.experience.push({ ...working.experience[0], id: "old-variant", role: "Service Delivery Sr. Manager" });
  const data = new Map<string, string>();
  const storage = { getItem: (k: string) => data.get(k) || null, setItem: (k: string, v: string) => { data.set(k, v); } };
  const backup = preserveResumeBackup(storage, saved, working);
  const repaired = repairResume(working);
  assert.equal(repaired.summary, working.summary); assert.equal(repaired.title, working.title);
  assert.equal(repaired.experience.length, 1);
  const secondBackup = preserveResumeBackup(storage, saved, repaired);
  assert.deepEqual(secondBackup.working, backup.working);
  assert.deepEqual(secondBackup.saved, backup.saved);
  assert.deepEqual(secondBackup.snapshots?.[0], repaired);
  assert.equal(backup.working.experience.length, 2);
  assert.deepEqual(resumeCounts(repairResume(repaired)), resumeCounts(repaired));
  assert.deepEqual(saved.masterProfile?.sources, repaired.masterProfile?.sources);
  assert.throws(() => preserveResumeBackup({ getItem: () => null, setItem: () => { throw new Error("Quota"); } }, saved, working), /Quota/);
});
