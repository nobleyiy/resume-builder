import test from "node:test";
import assert from "node:assert/strict";
import { emptyBasics, normalizeResume, emptyResume, type ProfileDraft } from "./schema.ts";
import { mergeProfiles, validateProfileDraft, type ProfileSource } from "./masterProfile.ts";

const draft = (): ProfileDraft => ({ basics: { ...emptyBasics(), name: "Alex Lee" }, summary: "", achievements: ["Won Design Award"], experience: [{ company: "Acme", role: "Engineer", location: "London", start: "2020", end: "2023", current: false, bullets: ["Built payment tools"] }], education: [{ school: "City University", degree: "BSc", field: "Computing", location: "", start: "2016", end: "2019", notes: "" }], projects: [], skills: [{ name: "Tools", items: ["TypeScript", "SQL"] }], certifications: [{ name: "Cloud Certificate", issuer: "Cloud Academy", date: "2022" }] });
const source = (name: string, d = draft()): ProfileSource => ({ id: name, name, draft: d, text: JSON.stringify(d) });

test("unions duplicate entries and skills across groups, preserving wording and inputs", () => {
  const a = source("first.txt");
  const d = draft();
  d.experience[0].bullets.push("Reduced costs by 10%");
  d.skills = [{ name: "Languages", items: ["typescript", "Python"] }];
  d.achievements.push("Won Design Award");
  const b = source("second.txt", d);
  const before = structuredClone([a, b]);
  const profile = mergeProfiles([a, b]);
  assert.equal(profile.facts.experience.length, 1);
  assert.deepEqual(profile.facts.experience[0].bullets, ["Built payment tools", "Reduced costs by 10%"]);
  assert.equal(profile.facts.education.length, 1);
  assert.equal(profile.facts.certifications.length, 1);
  assert.deepEqual(profile.facts.achievements, ["Won Design Award"]);
  assert.deepEqual(profile.facts.skills.flatMap((g) => g.items), ["TypeScript", "SQL", "Python"]);
  assert.deepEqual([a, b], before);
  assert.equal(profile.conflicts.length, 0);
});

test("retains contact, summary and entry alternatives with their sources", () => {
  const a = draft(); a.basics.email = "old@example.com"; a.summary = "Engineer in London";
  const b = draft(); b.basics.email = "new@example.com"; b.summary = "Engineer in Paris"; b.experience[0].end = "2024"; b.certifications[0].date = "2023";
  const p = mergeProfiles([source("old.txt", a), source("new.txt", b)]);
  assert.equal(p.facts.basics.email, "old@example.com");
  assert.deepEqual(p.conflicts.find((c) => c.field === "Contact: email")?.values, [{ value: "old@example.com", source: "old.txt" }, { value: "new@example.com", source: "new.txt" }]);
  assert.ok(p.conflicts.some((c) => c.field === "Summary"));
  assert.ok(p.conflicts.some((c) => c.field === "experience 1: end"));
  assert.ok(p.conflicts.some((c) => c.field === "certifications 1: date"));
});

test("keeps separate stints and ambiguous dates for review", () => {
  const b = draft(); b.experience[0].start = "2024"; b.experience[0].end = "Present"; b.experience[0].current = true;
  const p = mergeProfiles([source("past.txt"), source("current.txt", b)]);
  assert.equal(p.facts.experience.length, 2);
  assert.ok(p.conflicts.some((c) => c.field.includes("different dates")));
});

test("deduplicates identical records with missing identities without merging unrelated ones", () => {
  const a = draft(); a.education[0].start = "";
  const b = structuredClone(a); b.education.push({ ...a.education[0], school: "Other University" });
  const p = mergeProfiles([source("a", a), source("b", b)]);
  assert.equal(p.facts.education.length, 2);
});

test("rejects invented or rewritten text and unsupported current status", () => {
  const a = source("a");
  const changed = structuredClone(a.draft); changed.experience[0].bullets = ["Built award-winning payment systems"];
  assert.throws(() => validateProfileDraft(changed, a.text), /not verbatim/);
  changed.experience[0].bullets = a.draft.experience[0].bullets; changed.experience[0].current = true;
  assert.throws(() => validateProfileDraft(changed, a.text), /current job/);
  assert.throws(() => mergeProfiles([]), /at least one CV/);
});

test("profile survives stored-resume normalization and working edits do not mutate facts", () => {
  const profile = mergeProfiles([source("a")]);
  const resume = normalizeResume(JSON.parse(JSON.stringify({ ...emptyResume(), ...structuredClone(profile.facts), masterProfile: profile })));
  resume.experience[0].bullets[0] = "Tailored wording";
  assert.equal(resume.masterProfile?.facts.experience[0].bullets[0], "Built payment tools");
  assert.equal(normalizeResume(emptyResume()).masterProfile, undefined);
});
