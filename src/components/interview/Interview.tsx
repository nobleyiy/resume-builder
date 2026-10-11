"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, FileText, Lightbulb, MessageSquareText, RotateCcw, ShieldCheck, Sparkles, Upload } from "lucide-react";
import { useAi } from "@/components/editor/useAi";
import { AiProgress } from "@/components/ui/AiProgress";
import { Button, buttonClass } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { Segmented } from "@/components/ui/Segmented";
import { Spinner } from "@/components/ui/Spinner";
import { AiProviderMenu } from "@/components/ui/AiProviderMenu";
import { ManualInline } from "@/components/ui/ManualExchange";
import { ProviderPicker } from "@/components/ui/ProviderPicker";
import { HeaderAiBar } from "@/components/ui/HeaderAiBar";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { Wordmark } from "@/components/ui/Wordmark";
import { useAiProvider } from "@/lib/aiProvider";
import { manualInline } from "@/lib/manualBridge";
import { ACCEPT, extractFile, type FileKind } from "@/lib/ats/extract";
import { cn } from "@/lib/cn";
import { emptyBasics, emptyResume, hydrateDraft, type Basics, type DraftResume, type ProfileDraft, type Question, uid } from "@/lib/schema";
import { mergeProfiles, validateProfileDraft, type ProfileSource } from "@/lib/masterProfile";
import { store } from "@/lib/store";
import { Card, QuestionList, SheetPreview, STEP_LABELS, Stepper } from "./Parts";

type Stage = "setup" | "contact" | "questions" | "drafting" | "import";
const STAGE_INDEX: Record<Exclude<Stage, "import">, number> = { setup: 0, contact: 1, questions: 2, drafting: 3 };
const INDEX_STAGE: Stage[] = ["setup", "contact", "questions", "drafting"];

const LEVELS = ["Student", "0-2 years", "3-5 years", "6-10 years", "10+ years"] as const;
// The active pill deepens with seniority: neutral for a student, green as it rises, gold at the top.
const LEVEL_RAMP = ["#94a3b8", "#7dd3a1", "#34d399", "#159f77", "#e0a458"];

const DEFAULT_QUESTIONS: Question[] = [
  { topic: "experience", question: "What is your most recent job title, who was the employer, and what were the dates?", hint: "Title, company, city, and month-year to month-year or present." },
  { topic: "achievements", question: "What are the two or three results from that role you would put at the top of the page?", hint: "Name what you did, the scale it ran at, and one number that moved: users, revenue, time, cost, team size." },
  { topic: "skills", question: "Which tools, languages or systems did you use day to day in that role?", hint: "List them plainly; grouping comes later." },
  { topic: "experience", question: "Which roles came before it? For each, give the title, employer, dates and one result.", hint: "One line per role is enough; the resume will expand the recent ones." },
  { topic: "projects", question: "Have you built or led something outside your job description that you are proud of?", hint: "What it did, who used it, how big it got. Open source, side projects, internal tools all count." },
  { topic: "education", question: "What is your education?", hint: "Institution, degree, field, years, and anything notable such as a thesis, rank, or scholarship." },
  { topic: "achievements", question: "Any certifications, awards, publications or talks worth listing?", hint: "Name, issuer or venue, and year." },
  { topic: "summary", question: "What role are you going after next, and what should a recruiter remember about you in one line?", hint: "The line usually becomes the opening of your summary." },
];

const words = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

export function Interview() {
  const router = useRouter();
  const params = useSearchParams();
  const { run, busy, error, chars, reset } = useAi();
  const provider = useAiProvider();
  const manual = provider === "manual";

  // In Manual mode the builder hosts the exchange itself (the Draft step), so the
  // global dialog never appears here. Layout effect: claimed before first paint.
  useLayoutEffect(() => (manual ? manualInline.mount() : undefined), [manual]);

  const [stage, setStage] = useState<Stage>(params.get("mode") === "import" ? "import" : "setup");
  const [reached, setReached] = useState(0);
  const [role, setRole] = useState("");
  const [seededJd, setSeededJd] = useState("");
  const [level, setLevel] = useState<(typeof LEVELS)[number]>("3-5 years");
  const [industry, setIndustry] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [aimOpen, setAimOpen] = useState(false);
  const [basics, setBasics] = useState<Basics>(emptyBasics());
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [qNote, setQNote] = useState<string | null>(null);
  const [answers, setAnswers] = useState<string[]>([]);
  const [i, setI] = useState(0);
  const [dir, setDir] = useState<"next" | "back">("next");
  const [importText, setImportText] = useState("");
  const [importMode, setImportMode] = useState<"paste" | "upload">("paste");
  const [importFiles, setImportFiles] = useState<{ id: string; file: File; name: string; kind: FileKind; text: string; chars: number; error?: string; reading: boolean }[]>([]);
  const [processing, setProcessing] = useState(false);
  const [importProgress, setImportProgress] = useState({ index: 0, total: 0, name: "" });
  const [importError, setImportError] = useState<string | null>(null);
  const readyToImport = importMode === "paste" ? importText.trim().length > 40 && importText.length <= 100000 : importFiles.length > 0 && importFiles.every((f) => !f.reading && !f.error);
  const [importBusy, setImportBusy] = useState(false);
  const [importDrag, setImportDrag] = useState(false);
  const fetching = useRef(false);
  const importLock = useRef(false);

  // A cancelled manual exchange is not an error worth shouting about.
  const err = error && error !== "Cancelled." ? error : null;

  const go = (next: Stage) => {
    setStage(next);
    if (next !== "import") setReached((r) => Math.max(r, STAGE_INDEX[next]));
  };

  const takeImportFiles = async (files: File[]) => {
    if (importLock.current) return;
    setImportError(null);
    const queued = files.map((file) => ({ id: uid(), file, name: file.name, kind: "txt" as FileKind, text: "", chars: 0, reading: true }));
    setImportFiles((current) => [...current, ...queued]);
    setImportBusy(true);
    for (const item of queued) {
      const ex = await extractFile(item.file);
      const error = ex.error || (ex.text.trim().length <= 40 ? "Almost no text came out. Use a text-based CV or paste its text." : ex.text.length > 100000 ? "This CV exceeds 100,000 characters. Use a shorter file." : undefined);
      // Removed files stay removed even when extraction finishes later.
      setImportFiles((current) => current.map((f) => f.id === item.id ? { ...f, ...ex, error, reading: false } : f));
    }
    setImportBusy(false);
  };

  const applyStandard = useCallback((note: string) => {
    setQuestions(DEFAULT_QUESTIONS);
    setAnswers(new Array(DEFAULT_QUESTIONS.length).fill(""));
    setQNote(note);
  }, []);

  // Questions are fetched while the person fills in contact details. In Manual mode
  // we use the standard set, so the whole flow costs exactly one copy-paste (the draft).
  const fetchQuestions = useCallback(async () => {
    if (fetching.current || questions) return;
    if (manual) {
      applyStandard("Standard questions, so Manual mode needs just one copy-paste at the end.");
      return;
    }
    fetching.current = true;
    const out = await run<{ questions: Question[] }>("questions", { role, level, industry, count: 8, jobDescription, customInstructions });
    if (out?.questions?.length) {
      setQuestions(out.questions);
      setAnswers(new Array(out.questions.length).fill(""));
      setQNote(null);
    } else {
      applyStandard("Standard questions this time.");
    }
    fetching.current = false;
  }, [run, role, level, industry, questions, manual, applyStandard, jobDescription, customInstructions]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stage === "contact") void fetchQuestions();
  }, [stage, fetchQuestions]);

  // Arriving from the scanner's "rebuild" button: seed the import box with the file text and posting.
  useEffect(() => {
    if (params.get("from") !== "scan") return;
    try {
      const raw = sessionStorage.getItem("bespoke:scan-seed");
      if (!raw) return;
      const seed = JSON.parse(raw) as { text?: string; jd?: string };
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (seed.text) setImportText(seed.text);
      if (seed.jd) {
        setSeededJd(seed.jd);
        setJobDescription(seed.jd);
      }
      sessionStorage.removeItem("bespoke:scan-seed");
    } catch {}
  }, [params]);

  const startDraft = async () => {
    if (!questions) return;
    go("drafting");
    reset();
    const out = await run<DraftResume>("draft", {
      role,
      level,
      basics,
      answers: questions.map((q, k) => ({ question: q.question, answer: answers[k] ?? "" })),
      jobDescription,
      customInstructions,
    });
    if (!out) return;
    const base = { ...emptyResume(`${basics.name || "My"} resume`), basics, targetRole: role, jobDescription, customInstructions };
    const resume = hydrateDraft(out, base);
    resume.basics = { ...resume.basics, ...basics, headline: resume.basics.headline || role };
    resume.title = `${resume.basics.name || "My"} resume, ${role}`;
    const saved = store.create(resume);
    router.replace(`/editor/${saved.id}`);
  };

  const startBlank = () => {
    const r = store.create({ ...emptyResume(`${basics.name || "My"} resume`), basics: { ...basics, headline: role }, targetRole: role, jobDescription, customInstructions });
    router.replace(`/editor/${r.id}`);
  };

  const runImport = async () => {
    if (importLock.current || !readyToImport) return;
    importLock.current = true;
    setProcessing(true);
    setImportError(null);
    reset();
    try {
      const inputs = importMode === "upload" ? importFiles.map((f) => ({ id: f.id, name: f.name, text: f.text })) : [{ id: uid(), name: "Pasted CV", text: importText }];
      const sources: ProfileSource[] = [];
      for (const [index, input] of inputs.entries()) {
        setImportProgress({ index: index + 1, total: inputs.length, name: input.name });
        const draft = await run<ProfileDraft>("parseProfile", { text: input.text });
        if (!draft) return; // Never save a partial profile after failure or cancellation.
        validateProfileDraft(draft, input.text);
        sources.push({ ...input, draft });
      }
      const masterProfile = mergeProfiles(sources);
      const resume = { ...emptyResume(), ...structuredClone(masterProfile.facts), masterProfile, targetRole: role, jobDescription, customInstructions };
      resume.title = `${resume.basics.name || "Imported"} resume${role ? `, ${role}` : ""}`;
      const saved = store.create(resume);
      // Preserve the existing original-file link for single-file imports.
      if (importMode === "upload" && importFiles.length === 1) {
        try {
          const file = importFiles[0].file;
          const url = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });
          sessionStorage.setItem(`bespoke:srcfile:${saved.id}`, JSON.stringify({ name: file.name, url }));
        } catch { /* Source text remains in the profile if session storage is full. */ }
      }
      router.replace(`/editor/${saved.id}`);
    } catch (e) {
      setImportError((e as Error).message || "Could not build the Master Profile.");
    } finally {
      importLock.current = false;
      setProcessing(false);
    }
  };

  const answered = answers.filter((a) => a.trim()).length;
  const total = questions?.length ?? 8;
  const q = questions?.[i];

  const jump = (k: number) => {
    if (!questions || k === i || k < 0 || k >= questions.length) return;
    setDir(k > i ? "next" : "back");
    setI(k);
  };
  const next = () => {
    if (!questions) return;
    if (i < questions.length - 1) jump(i + 1);
    else void startDraft();
  };
  const back = () => (i === 0 ? go("contact") : jump(i - 1));

  // The sheet as it stands, for the live preview rail.
  const preview = useMemo(
    () => ({ ...emptyResume(`${basics.name || "My"} resume`), basics: { ...basics, headline: basics.headline || role }, targetRole: role }),
    [basics, role],
  );

  // Optional posting + standing instructions. Folded by default so the first
  // step stays one question; they are saved onto the resume either way.
  const aimCount = [jobDescription, customInstructions].filter((s) => s.trim()).length;
  const aimFields = (
    <details open={aimOpen} onToggle={(e) => setAimOpen(e.currentTarget.open)} className="group rounded-xl border border-line bg-raised/40 px-4 py-3">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[14px] font-medium text-ink [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2">
          <Sparkles className="size-4 text-accent" strokeWidth={1.75} aria-hidden="true" />
          Aim it at a posting, add instructions
          <span className="font-normal text-sub">(optional)</span>
        </span>
        <span className="text-[12px] font-normal text-sub">{aimCount ? `${aimCount} added` : ""}</span>
      </summary>
      <div className="mt-4 flex flex-col gap-5 pb-1">
        <Field
          label="Job description"
          hint={seededJd && jobDescription === seededJd ? "Loaded from your scan." : "Paste the whole posting. Questions, wording and skills lean toward it; nothing you have not done is added."}
        >
          {(id, by) => <Textarea id={id} aria-describedby={by} minRows={5} value={jobDescription} onChange={(e) => setJobDescription(e.target.value)} placeholder="Senior Frontend Engineer, Payments. We are looking for..." />}
        </Field>
        <Field label="Custom instructions" hint="Tone, what to emphasize, what to avoid. Kept with the resume and used by every AI action later.">
          {(id, by) => <Textarea id={id} aria-describedby={by} minRows={3} value={customInstructions} onChange={(e) => setCustomInstructions(e.target.value)} placeholder="Lead with leadership. Keep it plain, no buzzwords. Mention the payments rebuild." />}
        </Field>
      </div>
    </details>
  );

  const stepIdx = stage === "import" ? -1 : STAGE_INDEX[stage];
  const railCaption = stage === "setup" ? "Starts with the role" : stage === "contact" ? "Filling in as you type" : stage === "questions" ? `${answered} of ${total} answered` : "Writing now";

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur-md">
        <div className="relative mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 md:px-6">
          <HeaderAiBar />
          <Wordmark />
          <div className="flex items-center gap-1">
            <AiProviderMenu />
            <ThemeToggle />
            <Link href="/resumes" className={buttonClass("ghost", "sm")}>
              Exit
            </Link>
          </div>
        </div>
      </header>

      {/* Announce step changes to screen readers. */}
      <p className="sr-only" aria-live="polite">
        {stepIdx >= 0 ? `Step ${stepIdx + 1} of 4: ${STEP_LABELS[stepIdx]}` : "Import an existing resume"}
      </p>

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-6 md:py-10">
        {stage !== "import" && (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <Stepper current={stepIdx} reached={reached} onGo={(k) => go(INDEX_STAGE[k])} />
            {manual && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-raised px-3 py-1 text-[12px] font-medium text-ink-dim">
                <MessageSquareText className="size-3.5" strokeWidth={2} /> Manual mode: one copy-paste at the end
              </span>
            )}
          </div>
        )}

        {stage !== "import" ? (
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="min-w-0">
              {stage === "setup" && (
                <Card key="setup" className="stage-in">
                  <form
                    className="flex flex-col gap-7"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (role.trim()) go("contact");
                    }}
                  >
                    <div>
                      <h1 className="font-display text-[clamp(1.9rem,4vw,2.6rem)] leading-tight">What job are you going for?</h1>
                      <p className="mt-2 text-[15px] leading-relaxed text-ink-dim">The questions, the wording and the skills all follow from this.</p>
                    </div>

                    <Field label="Target role" hint="Word for word from a posting if you have one.">
                      {(id, by) => (
                        <Input id={id} aria-describedby={by} value={role} onChange={(e) => setRole(e.target.value)} placeholder="Senior Frontend Engineer" autoFocus required autoComplete="organization-title" className="h-12 text-base" />
                      )}
                    </Field>

                    <fieldset className="flex flex-col gap-2">
                      <legend className="mb-2 text-[13px] font-medium text-ink-dim">Experience</legend>
                      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Experience level">
                        {LEVELS.map((l, idx) => {
                          const on = level === l;
                          const c = LEVEL_RAMP[idx];
                          return (
                            <button
                              key={l}
                              type="button"
                              role="radio"
                              aria-checked={on}
                              onClick={() => setLevel(l)}
                              className={cn(
                                "min-h-10 rounded-full border px-4 text-[13.5px] font-medium transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.97]",
                                !on && "border-border bg-surface text-ink-dim hover:bg-raised hover:text-ink",
                              )}
                              style={on ? { background: `${c}24`, borderColor: c, color: c } : undefined}
                            >
                              {l}
                            </button>
                          );
                        })}
                      </div>
                    </fieldset>

                    <Field label="Industry (optional)">
                      {(id) => <Input id={id} value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="Fintech, healthcare, agency work" />}
                    </Field>

                    {aimFields}

                    <div className="border-t border-line pt-6">
                      <ProviderPicker />
                    </div>

                    <div className="flex flex-col gap-3 border-t border-line pt-6 sm:flex-row sm:items-center">
                      <Button type="submit" variant="primary" size="lg" disabled={!role.trim()}>
                        Start the questions <ArrowRight className="size-4" strokeWidth={2} />
                      </Button>
                      <Button variant="secondary" size="lg" onClick={() => go("import")}>
                        <Upload className="size-4" strokeWidth={1.75} /> I already have a resume
                      </Button>
                    </div>
                  </form>
                </Card>
              )}

              {stage === "contact" && (
                <Card key="contact" className="stage-in">
                  <form
                    className="flex flex-col gap-7"
                    onSubmit={(e) => {
                      e.preventDefault();
                      go("questions");
                    }}
                  >
                    <div>
                      <h1 className="font-display text-[clamp(1.9rem,4vw,2.6rem)] leading-tight">Who is this resume for?</h1>
                      <p className="mt-2 text-[15px] leading-relaxed text-ink-dim">These go on the sheet exactly as you type them. The AI is told to copy them, never to rewrite them.</p>
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <Field label="Full name" className="sm:col-span-2">
                        {(id) => <Input id={id} value={basics.name} onChange={(e) => setBasics({ ...basics, name: e.target.value })} autoFocus required autoComplete="name" className="h-12 text-base" />}
                      </Field>
                      <Field label="Email">{(id) => <Input id={id} type="email" value={basics.email} onChange={(e) => setBasics({ ...basics, email: e.target.value })} required autoComplete="email" />}</Field>
                      <Field label="Phone">{(id) => <Input id={id} type="tel" value={basics.phone} onChange={(e) => setBasics({ ...basics, phone: e.target.value })} autoComplete="tel" />}</Field>
                      <Field label="Location" hint="City and country is enough.">
                        {(id, by) => <Input id={id} aria-describedby={by} value={basics.location} onChange={(e) => setBasics({ ...basics, location: e.target.value })} autoComplete="address-level2" />}
                      </Field>
                      <Field label="LinkedIn">{(id) => <Input id={id} value={basics.linkedin} onChange={(e) => setBasics({ ...basics, linkedin: e.target.value })} placeholder="linkedin.com/in/you" />}</Field>
                      <Field label="GitHub or portfolio">{(id) => <Input id={id} value={basics.github} onChange={(e) => setBasics({ ...basics, github: e.target.value })} placeholder="github.com/you" />}</Field>
                      <Field label="Website">{(id) => <Input id={id} value={basics.website} onChange={(e) => setBasics({ ...basics, website: e.target.value })} placeholder="you.dev" />}</Field>
                    </div>
                    <p className="flex items-start gap-2 rounded-xl bg-raised px-3.5 py-3 text-[13px] leading-relaxed text-ink-dim">
                      <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ok" strokeWidth={1.75} />
                      {manual
                        ? "In Manual mode these details are part of the prompt you paste into your chat app, so the reply can put them on the sheet."
                        : "Saved in this browser only. They are sent once, with your answers, when the draft is written."}
                    </p>
                    <div className="flex flex-col-reverse gap-3 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
                      <Button variant="ghost" size="lg" onClick={() => go("setup")}>
                        <ArrowLeft className="size-4" strokeWidth={1.75} /> Back
                      </Button>
                      <div className="flex items-center gap-3">
                        {busy && !questions && (
                          <span className="flex items-center gap-2 text-[13px] text-sub">
                            <Spinner className="size-3.5" /> Writing your questions
                          </span>
                        )}
                        <Button type="submit" variant="primary" size="lg">
                          Continue <ArrowRight className="size-4" strokeWidth={2} />
                        </Button>
                      </div>
                    </div>
                  </form>
                </Card>
              )}

              {stage === "questions" && (
                <Card key="questions" className="stage-in">
                  {!questions ? (
                    err ? (
                      <div className="py-6 text-center">
                        <p className="font-display text-2xl">We could not get your questions.</p>
                        <p className="mx-auto mt-2 max-w-md text-[14px] text-danger">{err}</p>
                        <div className="mt-6 flex flex-wrap justify-center gap-2">
                          <Button variant="primary" onClick={() => void fetchQuestions()}>
                            <RotateCcw className="size-4" strokeWidth={1.75} /> Try again
                          </Button>
                          <Button variant="secondary" onClick={() => applyStandard("Standard questions this time.")}>
                            Use the standard questions
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <AiProgress
                        title={`Writing questions for a ${role}`}
                        live={chars}
                        steps={["Reading the role", "Drafting questions", "Adding hints", "Finishing"]}
                        note="The text streams in as it is written. Free models can take up to a minute."
                      />
                    )
                  ) : (
                    q && (
                      <div className="flex flex-col">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <span className="rounded-full bg-accent-soft px-3 py-1 text-[12.5px] font-semibold text-accent">
                            Question {i + 1} of {total}
                          </span>
                          <Button variant="secondary" size="sm" onClick={() => void startDraft()} disabled={answered === 0}>
                            <Sparkles className="size-3.5" strokeWidth={1.75} /> Write it with {answered} {answered === 1 ? "answer" : "answers"}
                          </Button>
                        </div>

                        {/* Progress you can click: green answered, accent current, grey open. */}
                        <div className="mt-4 flex gap-1" role="group" aria-label="Jump to a question">
                          {questions.map((_, k) => {
                            const done = !!answers[k]?.trim();
                            return (
                              <button
                                key={k}
                                type="button"
                                onClick={() => jump(k)}
                                aria-label={`Question ${k + 1}${done ? ", answered" : ""}`}
                                aria-current={k === i ? "step" : undefined}
                                className="group flex-1 py-2"
                              >
                                <span
                                  className={cn(
                                    "block h-1.5 rounded-full transition-colors duration-200",
                                    k === i ? "bg-accent" : done ? "bg-ok" : "bg-border group-hover:bg-dim",
                                  )}
                                />
                              </button>
                            );
                          })}
                        </div>

                        <div key={i} className={cn("mt-6", dir === "next" ? "q-next" : "q-back")}>
                          {qNote && i === 0 && <p className="mb-3 text-[12.5px] text-sub">{qNote}</p>}
                          <h1 className="font-display text-[clamp(1.5rem,3vw,2.1rem)] leading-[1.2]">{q.question}</h1>
                          {q.hint && (
                            <p className="mt-4 flex items-start gap-2.5 rounded-xl bg-raised px-3.5 py-3 text-[14px] leading-relaxed text-ink-dim">
                              <Lightbulb className="mt-0.5 size-4 shrink-0 text-accent" strokeWidth={1.75} />
                              {q.hint}
                            </p>
                          )}
                          <Textarea
                            key={`a-${i}`}
                            className="mt-4 text-base"
                            minRows={5}
                            autoFocus
                            value={answers[i] ?? ""}
                            onChange={(e) => setAnswers((a) => a.map((x, k) => (k === i ? e.target.value : x)))}
                            onKeyDown={(e) => {
                              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                                e.preventDefault();
                                next();
                              }
                            }}
                            placeholder="Plain sentences are fine. Numbers are gold."
                            aria-label={`Your answer to question ${i + 1}`}
                          />
                          <p className="mt-2 flex justify-between text-[12px] text-sub">
                            <span>{words(answers[i] ?? "")} words</span>
                            <span className="hidden sm:inline">Ctrl + Enter for the next question</span>
                          </p>
                        </div>

                        <div className="mt-6 flex flex-col-reverse gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="md" onClick={back}>
                              <ArrowLeft className="size-4" strokeWidth={1.75} /> Back
                            </Button>
                            <Button variant="ghost" size="md" onClick={next}>
                              Skip
                            </Button>
                          </div>
                          <Button variant="primary" size="lg" onClick={next}>
                            {i < total - 1 ? (
                              <>
                                Next question <ArrowRight className="size-4" strokeWidth={2} />
                              </>
                            ) : (
                              <>
                                <Sparkles className="size-4" strokeWidth={1.75} /> Write my resume
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    )
                  )}
                </Card>
              )}

              {stage === "drafting" && (
                <Card key="drafting" className="stage-in">
                  {manual && busy ? (
                    <div className="flex flex-col gap-5">
                      <div>
                        <h1 className="font-display text-[clamp(1.7rem,3.4vw,2.3rem)] leading-tight">Write it with your own AI</h1>
                        <p className="mt-2 text-[15px] leading-relaxed text-ink-dim">
                          Your {answered} {answered === 1 ? "answer is" : "answers are"} packed into one prompt. Run it in any chat app and paste the reply back.
                        </p>
                      </div>
                      <ManualInline onCancel={() => go("questions")} />
                    </div>
                  ) : busy ? (
                    <AiProgress
                      title="Writing your first draft"
                      live={chars}
                      steps={["Reading your answers", "Structuring your roles", "Writing bullets with numbers", "Grouping your skills", "Finishing"]}
                      note={`From ${answered} ${answered === 1 ? "answer" : "answers"}. It streams in as it is written; free models can take up to a minute.`}
                    />
                  ) : err ? (
                    <div className="py-4 text-center">
                      <p className="font-display text-2xl">The draft did not come back.</p>
                      <p className="mx-auto mt-2 max-w-md text-[14px] text-danger">{err}</p>
                      <div className="mt-6 flex flex-wrap justify-center gap-2">
                        <Button variant="primary" onClick={() => void startDraft()}>
                          <RotateCcw className="size-4" strokeWidth={1.75} /> Try again
                        </Button>
                        <Button variant="secondary" onClick={() => go("questions")}>
                          Back to the questions
                        </Button>
                        <Button variant="ghost" onClick={startBlank}>
                          Open a blank sheet with my details
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 py-6 text-[15px] text-ink-dim">
                      <Spinner className="size-4" /> Opening the editor
                    </div>
                  )}
                </Card>
              )}
            </div>

            <aside className="hidden flex-col gap-4 lg:sticky lg:top-20 lg:flex" aria-label="Preview">
              {stage === "questions" && questions && <QuestionList questions={questions} answers={answers} current={i} onJump={jump} />}
              <SheetPreview resume={preview} caption={railCaption} />
            </aside>
          </div>
        ) : (
          /* ── Import ── */
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <Card key="import" className="stage-in min-w-0">
              {busy && manual ? (
                <div className="flex flex-col gap-5">
                  <div>
                    <h1 className="font-display text-[clamp(1.7rem,3.4vw,2.3rem)] leading-tight">Extract CV facts with your own AI</h1>
                    <p className="mt-2 text-[15px] leading-relaxed text-ink-dim">Each CV gets its own extraction prompt. Run it in any chat app and paste the reply back; the next CV follows automatically.</p>
                  </div>
                  <p role="status" className="text-sm text-sub">CV {importProgress.index} of {importProgress.total}: {importProgress.name}</p>
                  <ManualInline key={importProgress.index} />
                </div>
              ) : processing ? (
                <AiProgress
                  title="Building your Master Profile"
                  live={chars}
                  steps={["Parsing the text", "Finding your roles and dates", "Structuring the sections", "Grouping skills", "Finishing"]}
                  note={`CV ${importProgress.index} of ${importProgress.total}: ${importProgress.name}. Each CV is parsed separately.`}
                />
              ) : (
                <form
                  className="flex flex-col gap-6"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (readyToImport) void runImport();
                  }}
                >
                  <Button variant="ghost" size="sm" className="w-fit" onClick={() => go("setup")}>
                    <ArrowLeft className="size-4" strokeWidth={1.75} /> Answer questions instead
                  </Button>

                  {seededJd && (
                    <p className="flex items-center gap-2 rounded-xl bg-accent-soft px-4 py-3 text-[14px] text-ink-dim">
                      <FileText className="size-4 shrink-0 text-accent" strokeWidth={1.75} /> Rebuilding from your scanned resume. Its text is loaded below and the posting is saved for tailoring.
                    </p>
                  )}

                  <div>
                    <h1 className="font-display text-[clamp(1.9rem,4vw,2.6rem)] leading-tight">Bring your existing resume</h1>
                    <p className="mt-2 max-w-[52ch] text-[15px] leading-relaxed text-ink-dim">Upload one or more CVs, or paste the text. Their facts become one Master Profile for future tailoring. Conflicting values are kept for review.</p>
                  </div>

                  <Field label="Target role" hint="Optional. Used later for tailoring; imported facts stay unchanged.">
                    {(id, by) => <Input id={id} aria-describedby={by} value={role} onChange={(e) => setRole(e.target.value)} placeholder="Senior Frontend Engineer" />}
                  </Field>

                  {aimFields}

                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-medium text-ink-dim">Your resume</span>
                      <Segmented
                        label="Import source"
                        size="sm"
                        value={importMode}
                        onChange={setImportMode}
                        options={[
                          { value: "upload", label: "Upload" },
                          { value: "paste", label: "Paste" },
                        ]}
                      />
                    </div>

                    {importMode === "upload" ? (
                      <div>
                        <button
                          type="button"
                          aria-label="Upload CV files"
                          onClick={() => document.getElementById("import-file")?.click()}
                          onDragOver={(e) => {
                            e.preventDefault();
                            setImportDrag(true);
                          }}
                          onDragLeave={() => setImportDrag(false)}
                          onDrop={(e) => {
                            e.preventDefault();
                            setImportDrag(false);
                            void takeImportFiles(Array.from(e.dataTransfer.files));
                          }}
                          className={cn(
                            "flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-10 text-center transition-colors duration-150",
                            importDrag ? "border-accent bg-accent-soft" : "border-border bg-raised/50 hover:border-accent hover:bg-accent-soft",
                          )}
                        >
                          {importBusy ? (
                            <Spinner className="size-6 text-accent" />
                          ) : (
                            <>
                              <span className="grid size-12 place-items-center rounded-xl bg-surface text-sub shadow-card">
                                <Upload className="size-6" strokeWidth={1.5} />
                              </span>
                              <span className="text-[15px] font-medium text-ink">Drop PDF, DOCX, TXT or MD files, or click to choose</span>
                              <span className="text-xs text-sub">Read in your browser. The file is never uploaded.</span>
                            </>
                          )}
                        </button>
                        <input id="import-file" type="file" multiple accept={ACCEPT} className="sr-only" onChange={(e) => { void takeImportFiles(Array.from(e.target.files || [])); e.target.value = ""; }} />
                        <ul className="mt-3 flex flex-col gap-2" aria-label="Uploaded CVs" aria-live="polite">
                          {importFiles.map((file) => (
                            <li key={file.id} className="rounded-xl border border-border bg-raised/50 p-3">
                              <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="break-words text-sm font-medium">{file.name}</p>
                                  <p className="text-xs text-sub">{file.reading ? "Reading…" : `${file.kind.toUpperCase()} · ${file.chars.toLocaleString()} characters`}</p>
                                </div>
                                <Button variant="ghost" size="sm" aria-label={`Remove ${file.name}`} onClick={() => setImportFiles((files) => files.filter((f) => f.id !== file.id))}>Remove</Button>
                              </div>
                              {file.error && <p role="alert" className="mt-2 text-[13px] text-danger">{file.error}</p>}
                              {!file.error && !file.reading && <details className="mt-2"><summary className="cursor-pointer text-xs text-sub">Preview extracted text</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-sub">{file.text}</pre></details>}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <Textarea
                        aria-label="Resume text"
                        minRows={12}
                        value={importText}
                        onChange={(e) => setImportText(e.target.value)}
                        autoFocus
                        placeholder="Paste your whole resume here. Formatting does not matter; the text does."
                        className="font-mono text-[13px]"
                      />
                    )}
                    <p className="text-xs text-sub">{importMode === "upload" ? `${importFiles.length} CVs selected · up to 8 MB each` : importText.trim() ? `${words(importText)} words ready · maximum 100,000 characters` : "Add at least a few lines."}</p>
                  </div>

                  {(importError || err) && (
                    <p role="alert" className="rounded-xl bg-danger-soft px-3.5 py-3 text-sm text-danger">
                      {importError || err}
                    </p>
                  )}

                  <div className="border-t border-line pt-6">
                    <Button type="submit" variant="primary" size="lg" disabled={!readyToImport || processing}>
                      {manual ? "Make the prompt" : "Build Master Profile"} <ArrowRight className="size-4" strokeWidth={2} />
                    </Button>
                  </div>
                </form>
              )}
            </Card>

            <Card className="p-5 text-[14px] leading-relaxed text-ink-dim md:p-6">
              <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
                <ShieldCheck className="size-4 text-ok" strokeWidth={1.75} /> What happens next
              </h2>
              <ol className="mt-4 flex flex-col gap-3">
                {[
                  "Your text is split into roles, education, projects and skills.",
                  "Every employer, title, date and number is kept exactly.",
                  "Duplicate facts are merged; conflicting values stay available for review.",
                  "You land in the editor with a live, editable sheet.",
                ].map((t, k) => (
                  <li key={t} className="flex gap-3">
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent">{k + 1}</span>
                    <span>{t}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-5 rounded-xl bg-raised px-3.5 py-3 text-[13px] text-sub">Files are read in your browser. Only the text is sent{manual ? ", and only to the chat app you paste it into" : " to the AI"}.</p>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
