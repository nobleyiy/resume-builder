"use client";

import { useState } from "react";
import { Scissors } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { Field, Textarea } from "@/components/ui/Field";
import { type Resume, type TailorResult } from "@/lib/schema";
import { applyTailorRevision, repairResume, tailoringFacts } from "@/lib/resumeRepair";
import type { Update } from "./Editor";
import { KeywordChips } from "./bits";
import { useAi } from "./useAi";

export function TailorDrawer({ open, onClose, resume, update }: { open: boolean; onClose: () => void; resume: Resume; update: Update }) {
  const { run, busy, error } = useAi();
  const [applyError, setApplyError] = useState<string | null>(null);
  const [result, setResult] = useState<TailorResult | null>(null);
  const [parts, setParts] = useState({ head: true, bullets: true, skills: true });
  const jd = resume.jobDescription;
  const [analyzedSource, setAnalyzedSource] = useState<import("@/lib/masterProfile").ProfileFacts | null>(null);

  const analyze = async () => {
    setResult(null);
    setApplyError(null);
    const facts = tailoringFacts(resume);
    const evidence = repairResume(resume).masterProfile;
    setAnalyzedSource(facts);
    const out = await run<TailorResult>("tailor", {
      jobDescription: jd,
      customInstructions: resume.customInstructions,
      resume: {
        headline: facts.basics.headline,
        summary: facts.summary,
        experience: facts.experience.map((e, index) => ({ index, role: e.role, company: e.company, bullets: e.bullets.filter(Boolean) })),
        skills: facts.skills.map((g) => ({ name: g.name, items: g.items })),
        other: [
          ...facts.achievements.filter((a) => a.trim()),
          ...facts.projects.map((p) => `${p.name}: ${p.description} ${p.bullets.join(" ")}`),
          ...facts.education.map((e) => `${e.degree} ${e.field} ${e.school}`),
          ...facts.certifications.map((c) => c.name),
          ...(resume.masterProfile ? [`Master Profile (all source facts): ${JSON.stringify(evidence?.facts)}`, `Values requiring review: ${JSON.stringify(evidence?.conflicts)}. Do not choose or combine disputed values; omit them from new wording.`] : []),
        ].join("\n"),
      },
    });
    if (out) setResult(out);
  };

  const apply = () => {
    if (!result || !analyzedSource) return;
    try {
      applyTailorRevision(resume, analyzedSource, result, parts); // Validate before scheduling the state update.
      update((r) => applyTailorRevision(r, analyzedSource, result, parts));
    } catch (e) {
      setApplyError((e as Error).message);
      return;
    }
    setResult(null);
    onClose();
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Tailor to a posting"
      width="max-w-2xl"
      footer={
        result ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-4 text-sm">
              {(
                [
                  ["head", "Headline and summary"],
                  ["bullets", "Bullets"],
                  ["skills", "Skills"],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="flex items-center gap-2">
                  <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={parts[k]} onChange={(e) => setParts({ ...parts, [k]: e.target.checked })} />
                  {label}
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setResult(null)}>
                Keep mine
              </Button>
              <Button variant="primary" onClick={apply} disabled={!parts.head && !parts.bullets && !parts.skills}>
                Apply changes
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-end">
            <Button variant="primary" onClick={analyze} loading={busy} disabled={jd.trim().length < 80}>
              <Scissors className="size-4" strokeWidth={1.5} /> {busy ? "Reading the posting" : "Analyze and tailor"}
            </Button>
          </div>
        )
      }
    >
      {applyError && <p role="alert" className="mb-3 text-sm text-danger">{applyError}</p>}
      {resume.masterProfile && <p className="mb-4 text-sm text-ink-dim">Tailoring uses your Master Profile from {resume.masterProfile.sources.length} CVs. Review flagged values in the editor before applying changes.</p>}
      {!result && (
        <>
          <Field
            label="Job posting"
            hint="Paste the whole thing, requirements included. Nothing is invented: bullets are reworded and reordered, keywords you lack are listed, not added."
            error={error ?? undefined}
          >
            {(id, by) => <Textarea id={id} aria-describedby={by} minRows={14} value={jd} onChange={(e) => update({ jobDescription: e.target.value })} placeholder="Senior Frontend Engineer, Payments. We are looking for..." />}
          </Field>
        </>
      )}

      {result && (
        <div className="fade flex flex-col gap-8">
          <KeywordChips matched={result.keywords.matched} missing={result.keywords.missing} />

          <div>
            <h3 className="text-[13px] font-medium text-ink-dim">What changes</h3>
            <ul className="mt-2 flex flex-col gap-1.5 text-sm leading-relaxed text-ink-dim">
              {result.notes.map((n, i) => (
                <li key={i} className="flex gap-2">
                  <span className="mt-[9px] h-px w-3 shrink-0 bg-border" aria-hidden="true" />
                  {n}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-[13px] font-medium text-ink-dim">Headline</h3>
            <p className="mt-1 text-sm">
              {result.headline !== resume.basics.headline && <span className="text-sub line-through">{resume.basics.headline || "none"} </span>}
              {result.headline}
            </p>
            <h3 className="mt-4 text-[13px] font-medium text-ink-dim">Summary</h3>
            <p className="mt-1 text-sm leading-relaxed">{result.summary}</p>
          </div>

          {result.experience.map((t) => {
            const e = analyzedSource?.experience[t.index];
            if (!e) return null;
            return (
              <div key={t.index}>
                <h3 className="text-[13px] font-medium text-ink-dim">
                  {e.role}
                  {e.company ? ` at ${e.company}` : ""}
                </h3>
                <ul className="mt-1.5 flex flex-col gap-1.5 text-sm leading-relaxed">
                  {t.bullets.map((b, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="mt-[9px] h-px w-3 shrink-0 bg-accent" aria-hidden="true" />
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}

          <div>
            <h3 className="text-[13px] font-medium text-ink-dim">Skills, regrouped</h3>
            <ul className="mt-1.5 flex flex-col gap-1 text-sm">
              {result.skills.map((g, i) => (
                <li key={i}>
                  <span className="font-medium">{g.name}: </span>
                  <span className="text-ink-dim">{g.items.join(", ")}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Drawer>
  );
}
