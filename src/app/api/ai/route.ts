import { NextResponse } from "next/server";
import { z } from "zod";
import { TASKS, type TaskName } from "@/lib/prompts";
import { buildPrompt } from "@/lib/promptText";
import { openAiRequest } from "@/lib/openAiRequest";
import { jsonCandidates } from "@/lib/extractJson";

export const runtime = "nodejs";
export const maxDuration = 120;

const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const OPENAI_BASE = "https://api.openai.com/v1";
const OLLAMA_DEFAULT_BASE = "http://localhost:11434/v1";
const NIM_BASE = "https://integrate.api.nvidia.com/v1";
const NIM_DEFAULT_MODEL = "meta/llama-3.1-8b-instruct";

export type ProviderChoice = "auto" | "ollama" | "openrouter" | "openai" | "nim";
const OR_HEADERS = { "HTTP-Referer": "https://bespoke.app", "X-Title": "Bespoke" };
const OPENROUTER_FALLBACKS = [
  "google/gemma-4-31b-it:free",
  "google/gemma-4-26b-a4b-it:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
];


function orModels(): string[] {
  const preferred = process.env.OPENROUTER_MODEL?.trim();
  return [...new Set([preferred, ...OPENROUTER_FALLBACKS].filter(Boolean) as string[])].slice(0, 3);
}

function openAiPool(): { key: string; model: string }[] {
  const raw = process.env.OPENAI_KEY_POOL;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((e): e is { key: string; model: string } => !!e && typeof e.key === "string" && typeof e.model === "string")
          .map((e) => ({ key: e.key.trim(), model: e.model.trim() }))
          .filter((e) => e.key && e.model);
      }
    } catch {
      /* fall through */
    }
  }
  const single = process.env.OPENAI_API_KEY?.trim();
  return single ? [{ key: single, model: process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL }] : [];
}

type Provider = { url: string; apiKey: string; headers: Record<string, string>; body: Record<string, unknown>; label: string; timeoutMs: number };

class CallError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** qwen3 (Ollama) skips its reasoning when the prompt carries "/no_think". */
function noThink(base: Record<string, unknown>) {
  return (base.messages as { role: string; content: string }[]).map((m) => (m.role === "system" ? { ...m, content: `${m.content}\n\n/no_think` } : m));
}

/** Per-provider overrides supplied by the client (from the provider config UI). */
type Overrides = { model?: string; baseUrl?: string };

const ollamaProvider = (base: Record<string, unknown>, ovr?: Overrides): Provider => {
  const url = ovr?.baseUrl?.trim() || process.env.OLLAMA_BASE_URL?.trim() || OLLAMA_DEFAULT_BASE;
  return {
    url: `${url.replace(/\/$/, "")}/chat/completions`,
    apiKey: "ollama",
    headers: {},
    // No response_format: some Ollama builds reject it. "/no_think" + extractJson handle JSON.
    body: { messages: noThink(base), temperature: (base as { temperature?: number }).temperature, model: ovr?.model?.trim() || process.env.OLLAMA_MODEL?.trim() || "qwen3:8b", max_tokens: 4000 },
    label: "Local model",
    timeoutMs: 180_000, // local models can be slow, especially cold
  };
};

/** One provider by name, or null when its key is not available. */
function providerByName(name: ProviderChoice, headerKey: string | null, base: Record<string, unknown>, ovr?: Overrides): Provider | null {
  const orModelList = () => (ovr?.model?.trim() ? [ovr.model.trim()] : orModels());
  const orBody = () => ({ ...base, model: orModelList()[0], models: orModelList(), reasoning: { exclude: true }, max_tokens: 8000 });
  switch (name) {
    case "ollama":
      return ollamaProvider(base, ovr);
    case "openrouter": {
      const key = (headerKey?.startsWith("sk-or-") ? headerKey : null) || process.env.OPENROUTER_API_KEY?.trim();
      return key ? { url: `${OPENROUTER_BASE}/chat/completions`, apiKey: key, headers: OR_HEADERS, body: orBody(), label: "OpenRouter", timeoutMs: 45_000 } : null;
    }
    case "openai": {
      const pool = openAiPool();
      const key = (headerKey && !headerKey.startsWith("sk-or-") && !headerKey.startsWith("nvapi-") ? headerKey : null) || pool[0]?.key;
      const model = ovr?.model?.trim() || pool[0]?.model || process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
      return key ? { url: `${OPENAI_BASE}/chat/completions`, apiKey: key, headers: {}, body: openAiRequest(base, model), label: "OpenAI", timeoutMs: 60_000 } : null;
    }
    case "nim": {
      const key = (headerKey?.startsWith("nvapi-") ? headerKey : null) || process.env.NIM_API_KEY?.trim();
      const model = ovr?.model?.trim() || process.env.NIM_MODEL?.trim() || NIM_DEFAULT_MODEL;
      return key ? { url: `${NIM_BASE}/chat/completions`, apiKey: key, headers: {}, body: { ...base, model, max_tokens: 4000 }, label: "NIM", timeoutMs: 60_000 } : null;
    }
    default:
      return null;
  }
}

/** Providers to try. An explicit choice pins one; "auto" tries local, then a
    pasted key, then the server keys. */
function buildProviders(headerKey: string | null, base: Record<string, unknown>, choice: ProviderChoice, ovr?: Overrides): Provider[] {
  if (choice !== "auto") {
    const p = providerByName(choice, headerKey, base, ovr);
    return p ? [p] : [];
  }
  const orBody = () => ({ ...base, model: orModels()[0], models: orModels(), reasoning: { exclude: true }, max_tokens: 8000 });
  const oaBody = (model: string) => openAiRequest(base, model);
  const list: Provider[] = [];
  if (process.env.OLLAMA_MODEL?.trim()) list.push(ollamaProvider(base));
  if (headerKey?.startsWith("sk-or-")) list.push({ url: `${OPENROUTER_BASE}/chat/completions`, apiKey: headerKey, headers: OR_HEADERS, body: orBody(), label: "OpenRouter", timeoutMs: 45_000 });
  else if (headerKey?.startsWith("nvapi-")) list.push({ url: `${NIM_BASE}/chat/completions`, apiKey: headerKey, headers: {}, body: { ...base, model: process.env.NIM_MODEL?.trim() || NIM_DEFAULT_MODEL, max_tokens: 4000 }, label: "NIM", timeoutMs: 60_000 });
  else if (headerKey) list.push({ url: `${OPENAI_BASE}/chat/completions`, apiKey: headerKey, headers: {}, body: oaBody(process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL), label: "OpenAI", timeoutMs: 60_000 });
  const orKey = process.env.OPENROUTER_API_KEY?.trim();
  const pool = openAiPool();
  if (orKey) list.push({ url: `${OPENROUTER_BASE}/chat/completions`, apiKey: orKey, headers: OR_HEADERS, body: orBody(), label: "OpenRouter", timeoutMs: 45_000 });
  else if (pool.length) list.push({ url: `${OPENAI_BASE}/chat/completions`, apiKey: pool[0].key, headers: {}, body: oaBody(pool[0].model), label: "OpenAI", timeoutMs: 60_000 });
  return list;
}


/** One streaming attempt against a provider. Forwards content deltas via onDelta.
    Throws if the stream carries an error chunk or yields no content at all. */
async function streamOnce(prov: Provider, onDelta: (chars: number, full: string) => void): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), prov.timeoutMs);
  try {
    const res = await fetch(prov.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${prov.apiKey}`, "Content-Type": "application/json", ...prov.headers },
      body: JSON.stringify({ ...prov.body, stream: true }),
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body) {
      const data = (await res.json().catch(() => null)) as { error?: { message?: string; code?: number } } | null;
      throw new CallError(data?.error?.message || `Provider error (${res.status}).`, Number(data?.error?.code) || res.status);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const payload = t.slice(5).trim();
        if (payload === "[DONE]") continue;
        let j: { choices?: { delta?: { content?: string } }[]; error?: { message?: string; code?: number } };
        try {
          j = JSON.parse(payload);
        } catch {
          continue; // keepalive / partial line
        }
        if (j.error) throw new CallError(j.error.message || "Provider error mid-stream.", Number(j.error.code) || 502);
        const delta = j.choices?.[0]?.delta?.content ?? "";
        if (delta) {
          full += delta;
          onDelta(full.length, full);
        }
      }
    }
    if (!full.trim()) throw new CallError("The model returned an empty reply.", 502);
    return full;
  } finally {
    clearTimeout(timer);
  }
}

/** One non-streaming attempt (bounded), the reliable fallback when streaming fails. */
async function textOnce(prov: Provider): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), prov.timeoutMs);
  try {
    const res = await fetch(prov.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${prov.apiKey}`, "Content-Type": "application/json", ...prov.headers },
      body: JSON.stringify(prov.body),
      signal: ctrl.signal,
    });
    const data = (await res.json().catch(() => null)) as
      | { choices?: { message?: { content?: string; reasoning?: string } }[]; error?: { message?: string; code?: number } }
      | null;
    if (!res.ok || data?.error) throw new CallError(data?.error?.message || `Provider error (${res.status}).`, Number(data?.error?.code) || res.status);
    const msg = data?.choices?.[0]?.message;
    const content = msg?.content?.trim() || msg?.reasoning?.trim() || "";
    if (!content) throw new CallError("The model returned an empty reply.", 502);
    return content;
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new CallError(`${prov.label} was too slow. Try again.`, 504);
    throw e instanceof CallError ? e : new CallError((e as Error).message || "Network error.", 502);
  } finally {
    clearTimeout(timer);
  }
}

/** Get the model text: stream the first provider for a live char count, and on
    any failure fall back to non-streaming attempts across all providers. */
async function getText(providers: Provider[], onDelta: (chars: number, full: string) => void): Promise<string> {
  try {
    return await streamOnce(providers[0], onDelta);
  } catch {
    let last = new CallError("The model call failed.", 500);
    for (const prov of providers) {
      try {
        return await textOnce(prov);
      } catch (e) {
        last = e instanceof CallError ? e : new CallError((e as Error).message, 502);
        if (![401, 403, 429, 500, 502, 503, 504].includes(last.status)) break;
      }
    }
    throw last;
  }
}

const Body = z.object({ task: z.string(), input: z.unknown() });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Malformed request." }, { status: 400 });

  const task = TASKS[parsed.data.task as TaskName];
  if (!task) return NextResponse.json({ error: `Unknown task "${parsed.data.task}".` }, { status: 400 });

  const input = task.input.safeParse(parsed.data.input);
  if (!input.success) return NextResponse.json({ error: `Invalid input: ${input.error.issues[0]?.message ?? "check the fields"}.` }, { status: 400 });

  const { system, user: userText } = buildPrompt(parsed.data.task as TaskName, input.data);

  const base = {
    messages: [
      { role: "system", content: system },
      { role: "user", content: userText },
    ],
    temperature: task.temperature,
    response_format: { type: "json_object" },
  };

  const rawChoice = req.headers.get("x-ai-provider")?.trim();
  const choice: ProviderChoice = (["auto", "ollama", "openrouter", "openai", "nim"] as const).includes(rawChoice as ProviderChoice) ? (rawChoice as ProviderChoice) : "auto";
  const headerKey = req.headers.get("x-ai-key")?.trim() || req.headers.get("x-openai-key")?.trim() || null;
  const ovr: Overrides = { model: req.headers.get("x-ai-model")?.trim() || undefined, baseUrl: req.headers.get("x-ai-base")?.trim() || undefined };
  const providers = buildProviders(headerKey, base, choice, ovr);
  if (providers.length === 0) {
    const hint =
      choice === "ollama"
        ? "Local Ollama is not configured. Set OLLAMA_MODEL, or start Ollama."
        : choice === "nim"
          ? "No NIM key. Paste an nvapi- key in Settings, or set NIM_API_KEY."
          : choice === "openrouter"
            ? "No OpenRouter key. Paste an sk-or- key in Settings, or set OPENROUTER_API_KEY."
            : choice === "openai"
              ? "No OpenAI key. Paste one in Settings, or set OPENAI_API_KEY."
              : "No API key. Add your own under Settings, or set a provider key on the server.";
    return NextResponse.json({ error: hint }, { status: 401 });
  }

  const encoder = new TextEncoder();
  const send = (ctrl: ReadableStreamDefaultController, obj: unknown) => ctrl.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

  const stream = new ReadableStream({
    async start(ctrl) {
      // Heartbeat keeps the connection and the client's progress bar alive even
      // during the non-streaming fallback (which emits no deltas).
      const beat = setInterval(() => send(ctrl, { t: "b" }), 2000);
      let lastEmit = 0;
      try {
        const full = await getText(providers, (n, text) => {
          const now = Date.now();
          if (now - lastEmit > 120) {
            send(ctrl, { t: "p", n, x: text.slice(-500) });
            lastEmit = now;
          }
        });
        let emitted = false;
        for (const cand of jsonCandidates(full)) {
          try {
            const result = task.output.safeParse(JSON.parse(cand));
            if (result.success) {
              send(ctrl, { t: "r", result: result.data });
              emitted = true;
              break;
            }
          } catch {
            /* try the next candidate */
          }
        }
        if (!emitted) send(ctrl, { t: "e", error: "The model returned an unexpected shape. Try again." });
      } catch (e) {
        const err = e as { status?: number; message?: string };
        const status = err.status ?? 500;
        const message =
          status === 401 || status === 403
            ? "The API key was rejected."
            : status === 429
              ? "The free models are busy right now. Wait a moment and try again."
              : err.message || "The model call failed.";
        send(ctrl, { t: "e", error: message });
      } finally {
        clearInterval(beat);
        ctrl.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
