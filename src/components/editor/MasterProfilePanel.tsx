"use client";

import { Button } from "@/components/ui/Button";
import type { MasterProfile } from "@/lib/masterProfile";

export function MasterProfilePanel({ profile, onRepair, onExport, message }: { profile: MasterProfile; onRepair: () => void; onExport: () => void; message: string | null }) {
  return (
    <details className="mb-8 rounded-xl border border-border bg-raised/50 p-4">
      <summary className="cursor-pointer text-sm font-medium">Master Profile · {profile.sources.length} CVs · {profile.conflicts.length} items to review</summary>
      <p className="mt-3 text-sm text-ink-dim">These imported facts are the source for tailoring. Editing or tailoring this resume leaves the Master Profile intact. Source wording remains in the evidence library below. Conflicting dates are left blank for review; duplicate source variants are not extra resume entries.</p>
      <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="secondary" onClick={onRepair}>Repair duplicates</Button><Button size="sm" variant="ghost" onClick={onExport}>Export original backup</Button></div>
      {message && <p role="status" className="mt-3 text-sm text-ink-dim">{message}</p>}
      {profile.conflicts.length > 0 && <div className="mt-4">
        <h2 className="text-sm font-medium">Review conflicting values</h2>
        <p className="mt-1 text-xs text-sub">Different values may reflect updates, separate roles, or conflicts. Check the original CVs before using them. Tailoring must not choose or combine disputed values.</p>
        <ul className="mt-3 flex flex-col gap-3">{profile.conflicts.map((conflict, i) => <li key={i} className="text-sm">
          <p className="font-medium">{conflict.field}</p>
          <ul className="mt-1 flex flex-col gap-1">{conflict.values.map((v, j) => <li key={j} className="whitespace-pre-wrap break-words text-ink-dim">{v.value} <span className="text-xs text-sub">({v.source})</span></li>)}</ul>
        </li>)}</ul>
      </div>}
      <details className="mt-4"><summary className="cursor-pointer text-sm text-sub">Structured profile</summary><pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(profile.facts, null, 2)}</pre></details>
      {profile.sources.map((source) => <details key={source.id} className="mt-3"><summary className="cursor-pointer break-words text-sm text-sub">Source: {source.name}</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs text-ink-dim">{source.text}</pre></details>)}
    </details>
  );
}
