"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  AlignLeft,
  ArrowLeft,
  Award,
  Briefcase,
  ChevronDown,
  ChevronUp,
  Download,
  FileText,
  FolderGit2,
  GraduationCap,
  Files,
  ScanSearch,
  Scissors,
  Trophy,
  User,
  Wrench,
  ChevronDown as Caret,
} from "lucide-react";
import { ScaledSheet } from "@/components/resume/ScaledSheet";
import { Sheet } from "@/components/resume/Sheet";
import { Button, buttonClass } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";
import { AiProviderMenu } from "@/components/ui/AiProviderMenu";
import { AiSidebarStatus } from "@/components/ui/AiSidebarStatus";
import { HeaderAiBar } from "@/components/ui/HeaderAiBar";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { fitLabel, scoreResume } from "@/lib/ats";
import { cn } from "@/lib/cn";
import { downloadDocx } from "@/lib/docx";
import { SECTION_LABELS, type Resume, type SectionId } from "@/lib/schema";
import { store } from "@/lib/store";
import { TEMPLATES } from "@/lib/content";
import { resumeToText } from "@/lib/text";
import { CoverLetterDrawer } from "./CoverLetterDrawer";
import { FitDrawer } from "./FitDrawer";
import { LinkedInDrawer } from "./LinkedInDrawer";
import { AchievementsSection, CertificationsSection, DetailsSection, EducationSection, SummarySection } from "./Sections";
import { ExperienceSection, ProjectsSection } from "./Entries";
import { SkillsSection } from "./Skills";
import { repairResume, resumeCounts } from "@/lib/resumeRepair";
import { preserveResumeBackup, downloadResumeBackup, backupKey, type ResumeBackup } from "@/lib/resumeBackup";
import { MasterProfilePanel } from "./MasterProfilePanel";
import { TailorDrawer } from "./TailorDrawer";

export type Active = "basics" | SectionId;
export type Update = (patch: Partial<Resume> | ((r: Resume) => Resume)) => void;

type Drawer = "fit" | "tailor" | "cover" | "linkedin" | null;

// Fields compared to decide what is unsaved. updatedAt/id are excluded.
const DIFF_KEYS: (keyof Resume)[] = [
  "title", "basics", "summary", "achievements", "experience", "education", "projects", "skills",
  "certifications", "masterProfile", "sectionOrder", "pageBreaks", "template", "paper", "targetRole", "jobDescription", "customInstructions",
];

const SECTION_ICON: Record<Active, typeof User> = {
  basics: User,
  summary: AlignLeft,
  achievements: Trophy,
  experience: Briefcase,
  education: GraduationCap,
  projects: FolderGit2,
  skills: Wrench,
  certifications: Award,
};

export function Editor({ id }: { id: string }) {
  const stored = useSyncExternalStore(store.subscribe, () => store.get(id), () => undefined);
  const hydrated = useSyncExternalStore(() => () => {}, () => true, () => false);
  const [draft, setDraft] = useState<Resume | null>(null);
  const resume = draft ?? stored ?? null;
  const missing = hydrated && !resume;
  const [active, setActive] = useState<Active>("basics");
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [mobileView, setMobileView] = useState<"edit" | "preview">("edit");
  const [flash, setFlash] = useState<string | null>(null);
  const [repairMessage, setRepairMessage] = useState<string | null>(null);

  const [srcFile, setSrcFile] = useState<{ name: string; url: string } | null>(null);

  // Arriving from the scanner with ?tailor=1 opens the Tailor tool on the saved posting.
  // Also pick up the original uploaded file, if this resume came from an import this session.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (new URLSearchParams(window.location.search).get("tailor") === "1") setDrawer("tailor");
    try {
      const raw = sessionStorage.getItem(`bespoke:srcfile:${id}`);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setSrcFile(JSON.parse(raw));
    } catch {}
  }, [id]);

  const openSourceFile = () => {
    if (!srcFile) return;
    // Convert the stored data URL to a blob so the browser opens it in a tab.
    fetch(srcFile.url)
      .then((r) => r.blob())
      .then((b) => {
        const url = URL.createObjectURL(b);
        window.open(url, "_blank", "noopener");
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      })
      .catch(() => {});
  };

  // Staged save (Discord-style): edits live in `draft` until saved or discarded.
  const dirtyInfo = useMemo(() => {
    const tabs = new Set<Active>();
    if (!draft || !stored) return { dirty: false, count: 0, tabs };
    let count = 0;
    for (const k of DIFF_KEYS) {
      if (JSON.stringify(draft[k]) !== JSON.stringify(stored[k])) {
        count++;
        if (k === "title" || k === "basics" || k === "targetRole" || k === "jobDescription" || k === "customInstructions") tabs.add("basics");
        else if (k === "summary" || k === "achievements" || k === "experience" || k === "education" || k === "projects" || k === "skills" || k === "certifications") tabs.add(k);
      }
    }
    return { dirty: count > 0, count, tabs };
  }, [draft, stored]);

  // Native guard so an accidental refresh or tab close doesn't drop unsaved edits.
  useEffect(() => {
    if (!dirtyInfo.dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirtyInfo.dirty]);

  const update: Update = useCallback(
    (patch) => {
      setDraft((prev) => {
        const base = prev ?? store.get(id);
        if (!base) return prev;
        return typeof patch === "function" ? patch(base) : { ...base, ...patch };
      });
    },
    [id],
  );

  const fit = useMemo(() => (resume ? scoreResume(resume) : null), [resume]);

  const say = (msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash(null), 1800);
  };

  const repair = () => {
    if (!resume || !stored) return;
    try {
      const backup = preserveResumeBackup(localStorage, stored, resume);
      downloadResumeBackup(backup);
      const next = repairResume(resume);
      const before = resumeCounts(resume), after = resumeCounts(next);
      setDraft(next);
      setRepairMessage(`Repair staged: jobs ${before.jobs} → ${after.jobs}, bullets ${before.bullets} → ${after.bullets}, skills ${before.skills} → ${after.skills}. Your saved original and unsaved edits were backed up. Review and Save, or Discard to leave the saved resume unchanged.`);
    } catch (e) {
      setRepairMessage(`Repair stopped: ${(e as Error).message}. Your editor changes are intact.`);
    }
  };
  const exportOriginal = () => {
    if (!resume || !stored) return;
    const raw = localStorage.getItem(backupKey(id));
    downloadResumeBackup(raw ? JSON.parse(raw) as ResumeBackup : { version: 1, createdAt: Date.now(), saved: stored, working: resume });
  };
  const updateTailor: Update = (patch) => {
    if (!resume || !stored) return;
    preserveResumeBackup(localStorage, stored, resume);
    update(patch);
  };

  const save = () => {
    if (!draft) return;
    store.upsert({ ...draft, updatedAt: Date.now() });
    setDraft(null); // fall back to the freshly-stored copy
    say("Saved");
  };
  const discard = () => setDraft(null);

  const exportPdf = () => {
    if (!resume) return;
    const prev = document.title;
    document.title = resume.title.replace(/[^\w\s-]/g, "").trim() || "resume";
    window.print();
    document.title = prev;
  };

  const copyText = async () => {
    if (!resume) return;
    await navigator.clipboard.writeText(resumeToText(resume));
    say("Copied as plain text");
  };

  const exportDocx = async () => {
    if (!resume) return;
    await downloadDocx(resume);
    say("Word file downloaded");
  };

  const moveSection = (s: SectionId, dir: -1 | 1) =>
    update((r) => {
      const order = [...r.sectionOrder];
      const i = order.indexOf(s);
      const j = i + dir;
      if (j < 0 || j >= order.length) return r;
      [order[i], order[j]] = [order[j], order[i]];
      return { ...r, sectionOrder: order };
    });

  if (missing) {
    return (
      <main id="main" className="flex min-h-dvh flex-col items-center justify-center gap-4 px-5 text-center">
        <p className="font-display text-3xl">No resume with that id in this browser.</p>
        <Link href="/resumes" className={buttonClass("primary", "md")}>
          Open my resumes
        </Link>
      </main>
    );
  }

  if (!resume || !fit) {
    return <div className="min-h-dvh" aria-busy="true" />;
  }

  const counts: Partial<Record<SectionId, number>> = {
    achievements: resume.achievements.filter((a) => a.trim()).length,
    experience: resume.experience.length,
    education: resume.education.length,
    projects: resume.projects.length,
    skills: resume.skills.reduce((n, g) => n + g.items.length, 0),
    certifications: resume.certifications.length,
  };

  const rail = (
    <nav aria-label="Sections" className="flex flex-col gap-0.5">
      <RailItem label="Details" Icon={SECTION_ICON.basics} active={active === "basics"} dirty={dirtyInfo.tabs.has("basics")} onClick={() => setActive("basics")} />
      {resume.sectionOrder.map((s, i) => (
        <RailItem
          key={s}
          label={SECTION_LABELS[s]}
          Icon={SECTION_ICON[s]}
          count={counts[s]}
          active={active === s}
          dirty={dirtyInfo.tabs.has(s)}
          onClick={() => setActive(s)}
          onUp={i > 0 ? () => moveSection(s, -1) : undefined}
          onDown={i < resume.sectionOrder.length - 1 ? () => moveSection(s, 1) : undefined}
        />
      ))}
    </nav>
  );

  return (
    <div className="no-print flex h-dvh flex-col">
      <header className="relative flex h-14 shrink-0 items-center gap-2 px-3 hairline-b md:px-4">
        <HeaderAiBar />
        <Link href="/resumes" className={buttonClass("ghost", "sm")} aria-label="Back to my resumes">
          <ArrowLeft className="size-4" strokeWidth={1.5} />
          <span className="hidden sm:inline">Resumes</span>
        </Link>
        <input
          value={resume.title}
          onChange={(e) => update({ title: e.target.value })}
          aria-label="Resume title"
          className="min-w-0 flex-1 truncate rounded-md bg-transparent px-2 py-1 font-display text-lg outline-none transition-colors hover:bg-raised focus:bg-raised md:text-xl"
        />
        <Segmented
          label="View"
          size="sm"
          className="lg:hidden"
          value={mobileView}
          onChange={setMobileView}
          options={[
            { value: "edit", label: "Edit" },
            { value: "preview", label: "Sheet" },
          ]}
        />
        <button
          type="button"
          onClick={() => setDrawer("fit")}
          className="hidden h-8 items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-[13px] transition-colors hover:bg-raised sm:flex"
          aria-label={`Fit score ${fit.score} of 100, ${fitLabel(fit.score)}`}
        >
          <span className="font-mono tabular text-accent">{fit.score}</span>
          <span className="text-ink-dim">{fitLabel(fit.score)}</span>
        </button>
        <Button size="sm" variant="secondary" className="hidden md:inline-flex" onClick={() => setDrawer("tailor")}>
          <Scissors className="size-4" strokeWidth={1.5} /> Tailor
        </Button>
        <Button size="sm" variant="ghost" className="hidden md:inline-flex" onClick={() => setDrawer("cover")}>
          Cover letter
        </Button>
        {srcFile && (
          <Button size="sm" variant="ghost" className="hidden lg:inline-flex" onClick={openSourceFile} title={srcFile.name}>
            <FileText className="size-4" strokeWidth={1.5} /> Original
          </Button>
        )}
        <Link href={`/scan?id=${resume.id}`} className={cn(buttonClass("ghost", "sm"), "hidden lg:inline-flex")}>
          <ScanSearch className="size-4" strokeWidth={1.5} /> Scan
        </Link>
        <Button size="sm" variant="ghost" className="hidden lg:inline-flex" onClick={() => setDrawer("linkedin")}>
          LinkedIn
        </Button>
        <AiProviderMenu />
        <ThemeToggle className="hidden sm:inline-flex" />
        <details className="relative">
          <summary className={cn(buttonClass("primary", "sm"), "list-none [&::-webkit-details-marker]:hidden")}>
            <Download className="size-4" strokeWidth={1.5} /> Export <Caret className="size-3.5" strokeWidth={1.5} />
          </summary>
          <div className="absolute right-0 top-10 z-30 w-56 rounded-lg border border-border bg-surface p-1 shadow-float">
            <MenuItem onClick={exportPdf} title="PDF" line="Print dialog, save as PDF. Real text." />
            <MenuItem onClick={exportDocx} title="Word (.docx)" line="For portals that insist on .doc." />
            <MenuItem onClick={copyText} title="Copy as plain text" line="For application forms." />
          </div>
        </details>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden shrink-0 flex-col gap-3 overflow-y-auto p-3 lg:flex lg:w-64">
          <div className="sticky top-0 rounded-xl border border-border bg-surface p-2 shadow-float">{rail}</div>
          <AiSidebarStatus />
        </aside>

        <main
          id="main"
          className={cn("min-w-0 flex-1 overflow-y-auto", mobileView === "preview" && "hidden lg:block")}
        >
          <div className="sticky top-0 z-10 flex gap-1 overflow-x-auto border-b border-line bg-bg/90 px-3 py-2 backdrop-blur lg:hidden">
            <Chip label="Details" active={active === "basics"} dirty={dirtyInfo.tabs.has("basics")} onClick={() => setActive("basics")} />
            {resume.sectionOrder.map((s) => (
              <Chip key={s} label={SECTION_LABELS[s]} active={active === s} dirty={dirtyInfo.tabs.has(s)} onClick={() => setActive(s)} />
            ))}
          </div>
          <div className="mx-auto max-w-2xl px-5 py-8 md:px-8 md:py-10">
            {resume.masterProfile && <MasterProfilePanel profile={resume.masterProfile} onRepair={repair} onExport={exportOriginal} message={repairMessage} />}
            {active === "basics" && <DetailsSection resume={resume} update={update} />}
            {active === "summary" && <SummarySection resume={resume} update={update} />}
            {active === "achievements" && <AchievementsSection resume={resume} update={update} />}
            {active === "experience" && <ExperienceSection resume={resume} update={update} />}
            {active === "education" && <EducationSection resume={resume} update={update} />}
            {active === "projects" && <ProjectsSection resume={resume} update={update} />}
            {active === "skills" && <SkillsSection resume={resume} update={update} />}
            {active === "certifications" && <CertificationsSection resume={resume} update={update} />}
            <div className="mt-12 flex flex-wrap gap-2 md:hidden">
              <Button size="sm" variant="secondary" onClick={() => setDrawer("fit")}>
                Fit {fit.score}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setDrawer("tailor")}>
                Tailor to a posting
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDrawer("cover")}>
                Cover letter
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDrawer("linkedin")}>
                LinkedIn
              </Button>
            </div>
          </div>
        </main>

        <section
          aria-label="Live preview"
          className={cn(
            "min-w-0 flex-col overflow-y-auto bg-raised lg:flex lg:w-[46%] lg:border-l lg:border-line xl:w-[48%]",
            mobileView === "preview" ? "flex flex-1" : "hidden",
          )}
        >
          <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-line bg-raised/90 px-4 py-2 backdrop-blur">
            <Segmented
              label="Template"
              size="sm"
              value={resume.template}
              onChange={(template) => update({ template })}
              options={TEMPLATES.map((t) => ({ value: t.id, label: t.name }))}
            />
            <Segmented
              label="Paper"
              size="sm"
              value={resume.paper}
              onChange={(paper) => update({ paper })}
              options={[
                { value: "letter", label: "Letter" },
                { value: "a4", label: "A4" },
              ]}
            />
            <PagesMenu resume={resume} update={update} />
            <span className="ml-auto font-mono text-[11px] tabular text-sub">
              {fit.words} words
            </span>
          </div>
          <div className="p-4 md:p-8">
            <ScaledSheet resume={resume} />
          </div>
        </section>
      </div>

      {flash && (
        <div
          role="status"
          className={cn(
            "fade fixed left-1/2 z-50 -translate-x-1/2 rounded-md border border-border bg-surface px-3 py-2 text-sm shadow-float",
            dirtyInfo.dirty ? "bottom-20" : "bottom-5",
          )}
        >
          {flash}
        </div>
      )}

      {dirtyInfo.dirty && (
        <div
          role="region"
          aria-label="Unsaved changes"
          className="fade fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border border-border bg-surface/95 py-2 pl-4 pr-2 shadow-float backdrop-blur"
        >
          <span className="text-sm text-ink-dim">
            <span className="font-mono tabular text-ink">{dirtyInfo.count}</span> unsaved change{dirtyInfo.count === 1 ? "" : "s"}
          </span>
          <Button size="sm" variant="ghost" onClick={discard}>
            Discard
          </Button>
          <Button size="sm" variant="primary" onClick={save}>
            Save
          </Button>
        </div>
      )}

      <FitDrawer
        open={drawer === "fit"}
        onClose={() => setDrawer(null)}
        fit={fit}
        onGo={(s) => {
          setActive(s);
          setMobileView("edit");
          setDrawer(null);
          requestAnimationFrame(() => document.getElementById("main")?.scrollTo({ top: 0, behavior: "smooth" }));
        }}
      />
      <TailorDrawer open={drawer === "tailor"} onClose={() => setDrawer(null)} resume={resume} update={updateTailor} />
      <CoverLetterDrawer open={drawer === "cover"} onClose={() => setDrawer(null)} resume={resume} />
      <LinkedInDrawer open={drawer === "linkedin"} onClose={() => setDrawer(null)} resume={resume} />

      {/* The printed document. Everything above is .no-print. */}
      <div className="print-only">
        <style>{`@page { size: ${resume.paper === "a4" ? "A4" : "letter"}; margin: 0; }`}</style>
        <Sheet resume={resume} />
      </div>
    </div>
  );
}

function RailItem({
  label,
  Icon,
  count,
  active,
  dirty,
  onClick,
  onUp,
  onDown,
}: {
  label: string;
  Icon: typeof User;
  count?: number;
  active: boolean;
  dirty?: boolean;
  onClick: () => void;
  onUp?: () => void;
  onDown?: () => void;
}) {
  return (
    <div className={cn("group relative flex items-center rounded-lg pr-1", active ? "bg-raised" : "hover:bg-raised/60")}>
      <span className={cn("absolute left-0 top-2 h-[calc(100%-1rem)] w-0.5 rounded-full bg-accent transition-opacity", active ? "opacity-100" : "opacity-0")} aria-hidden="true" />
      <button type="button" onClick={onClick} aria-current={active ? "true" : undefined} className="flex h-9 flex-1 items-center gap-2.5 pl-2.5 pr-2 text-left text-sm">
        <Icon className={cn("size-4 shrink-0", active ? "text-accent" : "text-sub")} strokeWidth={1.75} aria-hidden="true" />
        <span className={cn("flex-1 truncate", active ? "text-ink" : "text-ink-dim")}>{label}</span>
        {dirty && <span className="size-1.5 shrink-0 rounded-full bg-accent" title="Unsaved changes" aria-label="Unsaved changes" />}
        {typeof count === "number" && count > 0 && <span className="font-mono text-[11px] tabular text-sub">{count}</span>}
      </button>
      {(onUp || onDown) && (
        <span className="flex flex-col opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <button type="button" onClick={onUp} disabled={!onUp} aria-label={`Move ${label} up`} className="flex h-4 w-5 items-center justify-center text-sub hover:text-ink disabled:opacity-20">
            <ChevronUp className="size-3" strokeWidth={2} />
          </button>
          <button type="button" onClick={onDown} disabled={!onDown} aria-label={`Move ${label} down`} className="flex h-4 w-5 items-center justify-center text-sub hover:text-ink disabled:opacity-20">
            <ChevronDown className="size-3" strokeWidth={2} />
          </button>
        </span>
      )}
    </div>
  );
}

/** Per-section page-break control. Purely a print/PDF concern, so it lives by
    the paper controls; on screen the sheet just shows a marker where a break falls. */
function PagesMenu({ resume, update }: { resume: Resume; update: Update }) {
  const breaks = resume.pageBreaks ?? [];
  const toggle = (s: SectionId) =>
    update((r) => ({
      ...r,
      pageBreaks: (r.pageBreaks ?? []).includes(s) ? (r.pageBreaks ?? []).filter((x) => x !== s) : [...(r.pageBreaks ?? []), s],
    }));

  return (
    <details className="relative">
      <summary className={cn(buttonClass("ghost", "sm"), "list-none [&::-webkit-details-marker]:hidden")}>
        <Files className="size-4" strokeWidth={1.5} /> Pages
        {breaks.length > 0 && <span className="font-mono text-[11px] tabular text-accent">{breaks.length}</span>}
      </summary>
      <div className="absolute right-0 top-9 z-30 w-64 rounded-lg border border-border bg-surface p-2 shadow-float">
        <p className="px-1 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-sub">Start on a new page</p>
        <p className="px-1 pb-2 text-[12px] leading-relaxed text-sub">Only affects the printed PDF. The preview marks where a break falls.</p>
        {resume.sectionOrder.map((s) => {
          const on = breaks.includes(s);
          return (
            <label key={s} className="flex cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1.5 text-sm transition-colors hover:bg-raised">
              <input
                type="checkbox"
                checked={on}
                onChange={() => toggle(s)}
                className="size-4 shrink-0 accent-[var(--accent)]"
              />
              <span className="flex-1 text-ink-dim">{SECTION_LABELS[s]}</span>
            </label>
          );
        })}
      </div>
    </details>
  );
}

function Chip({ label, active, dirty, onClick }: { label: string; active: boolean; dirty?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={cn("flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-[13px] transition-colors", active ? "bg-ink text-bg" : "text-ink-dim hover:bg-raised")}
    >
      {label}
      {dirty && <span className={cn("size-1.5 rounded-full", active ? "bg-bg" : "bg-accent")} aria-label="Unsaved changes" />}
    </button>
  );
}

function MenuItem({ onClick, title, line }: { onClick: () => void; title: string; line: string }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        onClick();
        (e.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute("open");
      }}
      className="flex w-full flex-col items-start rounded-md px-3 py-2 text-left hover:bg-raised"
    >
      <span className="text-sm text-ink">{title}</span>
      <span className="text-xs text-sub">{line}</span>
    </button>
  );
}
