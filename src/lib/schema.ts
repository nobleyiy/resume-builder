import { z } from "zod";

/* ── Stored shape (localStorage). Plain TS; we own both ends. ── */

export type Template = "classic" | "modern" | "compact" | "executive" | "technical";
export const TEMPLATE_IDS: Template[] = ["classic", "modern", "compact", "executive", "technical"];
export type Paper = "letter" | "a4";

export const SECTION_IDS = [
  "summary",
  "achievements",
  "experience",
  "education",
  "projects",
  "skills",
  "certifications",
] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export const SECTION_LABELS: Record<SectionId, string> = {
  summary: "Summary",
  achievements: "Key achievements",
  experience: "Experience",
  education: "Education",
  projects: "Projects",
  skills: "Skills",
  certifications: "Certifications",
};

export type Basics = {
  name: string;
  headline: string;
  email: string;
  phone: string;
  location: string;
  website: string;
  linkedin: string;
  github: string;
};

export type Experience = {
  id: string;
  company: string;
  role: string;
  location: string;
  start: string;
  end: string;
  current: boolean;
  bullets: string[];
};

export type Education = {
  id: string;
  school: string;
  degree: string;
  field: string;
  location: string;
  start: string;
  end: string;
  notes: string;
};

export type Project = {
  id: string;
  name: string;
  link: string;
  description: string;
  bullets: string[];
};

export type SkillGroup = {
  id: string;
  name: string;
  items: string[];
};

export type Certification = {
  id: string;
  name: string;
  issuer: string;
  date: string;
};

export type Resume = {
  id: string;
  title: string;
  template: Template;
  paper: Paper;
  updatedAt: number;
  basics: Basics;
  summary: string;
  /** One-line headline results for an optional "Key achievements" section. */
  achievements: string[];
  experience: Experience[];
  education: Education[];
  projects: Project[];
  skills: SkillGroup[];
  certifications: Certification[];
  sectionOrder: SectionId[];
  /** Sections the user chose to start on a fresh printed page (print/PDF only). */
  pageBreaks: SectionId[];
  targetRole: string;
  jobDescription: string;
  customInstructions: string;
  /** Immutable imported facts; tailoring only changes the working resume. */
  masterProfile?: import("./masterProfile").MasterProfile;
};

export type AppStatus = "saved" | "applied" | "interview" | "offer" | "rejected";
export const APP_STATUSES: AppStatus[] = ["saved", "applied", "interview", "offer", "rejected"];
export const APP_STATUS_LABELS: Record<AppStatus, string> = {
  saved: "Saved",
  applied: "Applied",
  interview: "Interview",
  offer: "Offer",
  rejected: "Closed",
};

export type Application = {
  id: string;
  company: string;
  role: string;
  link: string;
  notes: string;
  resumeId: string;
  resumeTitle: string;
  jobDescription: string;
  status: AppStatus;
  scanScore: number | null;
  createdAt: number;
  updatedAt: number;
};

export const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);

export const emptyBasics = (): Basics => ({
  name: "",
  headline: "",
  email: "",
  phone: "",
  location: "",
  website: "",
  linkedin: "",
  github: "",
});

export const emptyExperience = (): Experience => ({
  id: uid(),
  company: "",
  role: "",
  location: "",
  start: "",
  end: "",
  current: false,
  bullets: [""],
});

export const emptyEducation = (): Education => ({
  id: uid(),
  school: "",
  degree: "",
  field: "",
  location: "",
  start: "",
  end: "",
  notes: "",
});

export const emptyProject = (): Project => ({
  id: uid(),
  name: "",
  link: "",
  description: "",
  bullets: [""],
});

export const emptySkillGroup = (): SkillGroup => ({ id: uid(), name: "", items: [] });

export const emptyCertification = (): Certification => ({
  id: uid(),
  name: "",
  issuer: "",
  date: "",
});

export const emptyApplication = (p?: Partial<Application>): Application => ({
  id: uid(),
  company: "",
  role: "",
  link: "",
  notes: "",
  resumeId: "",
  resumeTitle: "",
  jobDescription: "",
  status: "saved",
  scanScore: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...p,
});

export const emptyResume = (title = "Untitled resume"): Resume => ({
  id: uid(),
  title,
  template: "classic",
  paper: "letter",
  updatedAt: Date.now(),
  basics: emptyBasics(),
  summary: "",
  achievements: [],
  experience: [],
  education: [],
  projects: [],
  skills: [],
  certifications: [],
  sectionOrder: [...SECTION_IDS],
  pageBreaks: [],
  targetRole: "",
  jobDescription: "",
  customInstructions: "",
});

/** Fill any missing keys from an older stored version. */
export function normalizeResume(input: Partial<Resume> & { id: string }): Resume {
  const base = emptyResume();
  const r: Resume = { ...base, ...input, basics: { ...base.basics, ...(input.basics ?? {}) } };
  // Keep the stored order; slot any section added since (e.g. achievements)
  // right after the section that precedes it by default.
  const order = (r.sectionOrder ?? []).filter((s, i, a) => SECTION_IDS.includes(s) && a.indexOf(s) === i);
  SECTION_IDS.forEach((s, k) => {
    if (order.includes(s)) return;
    const prev = k > 0 ? order.indexOf(SECTION_IDS[k - 1]) : -1;
    order.splice(prev + 1, 0, s);
  });
  r.sectionOrder = order;
  r.achievements = Array.isArray(r.achievements) ? r.achievements.filter((a) => typeof a === "string") : [];
  r.pageBreaks = (r.pageBreaks ?? []).filter((s) => SECTION_IDS.includes(s));
  return r;
}

/* ── AI output shapes (strict JSON schema: every key required) ── */

const s = z.string();

export const DraftExperience = z.object({
  company: s,
  role: s,
  location: s,
  start: s,
  end: s,
  current: z.boolean(),
  bullets: z.array(s),
});

export const DraftEducation = z.object({
  school: s,
  degree: s,
  field: s,
  location: s,
  start: s,
  end: s,
  notes: s,
});

export const DraftProject = z.object({
  name: s,
  link: s,
  description: s,
  bullets: z.array(s),
});

export const DraftSkillGroup = z.object({ name: s, items: z.array(s) });

export const DraftCertification = z.object({ name: s, issuer: s, date: s });

export const DraftResume = z.object({
  basics: z.object({
    name: s,
    headline: s,
    email: s,
    phone: s,
    location: s,
    website: s,
    linkedin: s,
    github: s,
  }),
  summary: s,
  experience: z.array(DraftExperience),
  education: z.array(DraftEducation),
  projects: z.array(DraftProject),
  skills: z.array(DraftSkillGroup),
  certifications: z.array(DraftCertification),
});
export type DraftResume = z.infer<typeof DraftResume>;

export const ProfileDraft = DraftResume.extend({ achievements: z.array(s) });
export type ProfileDraft = z.infer<typeof ProfileDraft>;

export const QuestionsOut = z.object({
  questions: z.array(
    z.object({
      question: s,
      hint: s,
      topic: z.enum(["experience", "education", "projects", "skills", "summary", "achievements"]),
    }),
  ),
});
export type Question = z.infer<typeof QuestionsOut>["questions"][number];

export const VariantsOut = z.object({ variants: z.array(s) });
export const BulletsOut = z.object({ bullets: z.array(s) });
export const SkillsOut = z.object({ groups: z.array(DraftSkillGroup) });

export const TailorOut = z.object({
  headline: s,
  summary: s,
  experience: z.array(z.object({ index: z.number().int(), bullets: z.array(s) })),
  skills: z.array(DraftSkillGroup),
  keywords: z.object({ matched: z.array(s), missing: z.array(s) }),
  notes: z.array(s),
});
export type TailorResult = z.infer<typeof TailorOut>;

export const CoverOut = z.object({ letter: s });

export const LinkedInOut = z.object({ headline: s, about: s, tips: z.array(s) });
export type LinkedInResult = z.infer<typeof LinkedInOut>;

export const AchievementsOut = z.object({ achievements: z.array(s) });
export type AchievementsResult = z.infer<typeof AchievementsOut>;

/** Turn an AI draft into a stored resume, keeping ids and settings from `base`. */
export function hydrateDraft(draft: DraftResume, base: Resume): Resume {
  return {
    ...base,
    basics: { ...base.basics, ...draft.basics },
    summary: draft.summary,
    experience: draft.experience.map((e) => ({ ...e, id: uid() })),
    education: draft.education.map((e) => ({ ...e, id: uid() })),
    projects: draft.projects.map((p) => ({ ...p, id: uid() })),
    skills: draft.skills.map((g) => ({ ...g, id: uid() })),
    certifications: draft.certifications.map((c) => ({ ...c, id: uid() })),
    updatedAt: Date.now(),
  };
}
