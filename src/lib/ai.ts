"use client";

import { aiActivity } from "./aiActivity";
import { aiProvider, getProviderConfig } from "./aiProvider";
import { jsonCandidates } from "./extractJson";
import { manualBridge } from "./manualBridge";
import { TASKS, type TaskName } from "./prompts";
import { buildPrompt } from "./promptText";
import { getSettings } from "./store";

/** Turn a slice of streaming JSON into readable text for a live "cooking"
    preview: drop the structural scaffolding, keep the words. */
function humanize(s: string): string {
  return s
    .replace(/\\n/g, " ")
    .replace(/\\"/g, "'")
    .replace(/"\s*:\s*/g, ": ")
    .replace(/[{}[\]"]/g, " ")
    .replace(/,\s*/g, "  ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(-320);
}

export type AiTask =
  | "questions"
  | "draft"
  | "import"
  | "parseProfile"
  | "summary"
  | "bullet"
  | "suggestBullets"
  | "skills"
  | "tailor"
  | "cover"
  | "linkedin"
  | "objective"
  | "achievements";

export class AiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * Call the model through our streaming route. `onChars` fires as tokens arrive
 * so the UI can show live progress. Resolves with the parsed, validated result.
 */
export async function ai<T>(task: AiTask, input: unknown, opts?: { signal?: AbortSignal; onChars?: (n: number) => void }): Promise<T> {
  // Manual "bring your own AI": no network. Build the prompt, hand it to the UI
  // to copy into any chat model, and resolve when the user pastes the reply back.
  if (aiProvider.get() === "manual") return manualCall<T>(task, input);

  aiActivity.start();
  try {
    return await aiCall<T>(task, input, opts);
  } finally {
    aiActivity.end();
  }
}

/** The no-API path: park in the manual bridge until the user pastes a valid reply. */
async function manualCall<T>(task: AiTask, input: unknown): Promise<T> {
  const t = TASKS[task as TaskName];
  const parsed = t.input.safeParse(input);
  if (!parsed.success) throw new AiError(`Invalid input: ${parsed.error.issues[0]?.message ?? "check the fields"}.`, 400);

  const { system, user } = buildPrompt(task as TaskName, parsed.data);
  const prompt = `${system}\n\n===== INPUT =====\n${user}`;

  return manualBridge.request<T>({
    title: "Generate with your own AI",
    prompt,
    parse: (reply) => {
      for (const cand of jsonCandidates(reply)) {
        try {
          const r = t.output.safeParse(JSON.parse(cand));
          if (r.success) return { ok: true, value: r.data };
        } catch {
          /* try the next candidate */
        }
      }
      return { ok: false, error: "Could not read a valid result from that reply. Paste the model's whole answer, including the JSON." };
    },
  });
}

async function aiCall<T>(task: AiTask, input: unknown, opts?: { signal?: AbortSignal; onChars?: (n: number) => void }): Promise<T> {
  const provider = aiProvider.get();
  const cfg = getProviderConfig(provider);
  const key = cfg.apiKey.trim() || getSettings().openaiKey.trim();
  const res = await fetch("/api/ai", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ai-provider": provider,
      ...(key ? { "x-ai-key": key, "x-openai-key": key } : {}),
      ...(cfg.model.trim() ? { "x-ai-model": cfg.model.trim() } : {}),
      ...(cfg.baseUrl.trim() ? { "x-ai-base": cfg.baseUrl.trim() } : {}),
    },
    body: JSON.stringify({ task, input }),
    signal: opts?.signal,
  });

  // Non-stream error (provider setup failed): a JSON body with an error.
  const ctype = res.headers.get("content-type") ?? "";
  if (!ctype.includes("text/event-stream")) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new AiError(data.error || `Request failed (${res.status})`, res.status);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: T | undefined;
  let error: string | undefined;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      try {
        const j = JSON.parse(t.slice(5).trim());
        if (j.t === "p") {
          opts?.onChars?.(j.n as number);
          aiActivity.progress(j.n as number, typeof j.x === "string" ? humanize(j.x) : "");
        } else if (j.t === "r") result = j.result as T;
        else if (j.t === "e") error = j.error as string;
      } catch {
        /* partial */
      }
    }
  }

  if (result !== undefined) return result;
  throw new AiError(error || "The model returned nothing. Try again.", 502);
}
