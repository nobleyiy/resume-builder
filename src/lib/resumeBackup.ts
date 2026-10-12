import type { Resume } from "./schema.ts";

export type ResumeBackup = { version: 1; createdAt: number; saved: Resume; working: Resume; snapshots?: Resume[] };
export const backupKey = (id: string) => `bespoke:repair-backup:v1:${id}`;

/** Do not replace the first recoverable original on repeated repair attempts. */
export function preserveResumeBackup(storage: Pick<Storage, "getItem" | "setItem">, saved: Resume, working: Resume): ResumeBackup {
  const key = backupKey(saved.id);
  const existing = storage.getItem(key);
  const backup: ResumeBackup = existing ? JSON.parse(existing) as ResumeBackup : { version: 1, createdAt: Date.now(), saved: structuredClone(saved), working: structuredClone(working) };
  if (existing) {
    const current = JSON.stringify(working);
    if ([backup.working, ...(backup.snapshots || [])].some((snapshot) => JSON.stringify(snapshot) === current)) return backup;
    backup.snapshots = [...(backup.snapshots || []), structuredClone(working)];
  }
  const raw = JSON.stringify(backup);
  storage.setItem(key, raw);
  if (storage.getItem(key) !== raw) throw new Error("The backup could not be verified. Export the original before repairing.");
  return backup;
}

export function downloadResumeBackup(backup: ResumeBackup) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `resume-${backup.saved.id}-original.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
