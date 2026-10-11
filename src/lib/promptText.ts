import { z } from "zod";
import { PROSE_SYSTEM, SYSTEM, TASKS, type TaskName } from "./prompts";

/** Trim the JSON schema down to what a model needs: drop $schema and numeric
    range/length hints that only add noise. */
export function compactSchema(schema: z.ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(schema) as Record<string, unknown>;
  delete js.$schema;
  const strip = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(strip);
    if (node && typeof node === "object") {
      const o = node as Record<string, unknown>;
      for (const k of ["minimum", "maximum", "maxLength", "minLength"]) delete o[k];
      Object.values(o).forEach(strip);
    }
  };
  strip(js);
  return js;
}

/** The system + user messages for a task, identical whether sent to the API or
    copied for a manual paste into any chat model. `data` must already be valid
    task input (run through TASKS[name].input first). */
export function buildPrompt(name: TaskName, data: unknown): { system: string; user: string } {
  const task = TASKS[name];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const user = (task.user as (i: any) => string)(data);
  const schema = compactSchema(task.output);
  const system = `${name === "parseProfile" ? "You extract structured CV facts verbatim. Preserve source wording and conflicting facts. Never write or improve a resume." : task.prose ? PROSE_SYSTEM : SYSTEM}\n\n${task.system}\n\nReturn ONLY a single JSON object with the actual data, no prose and no code fences. Do not repeat or output the schema itself. The object must match this JSON schema exactly:\n${JSON.stringify(schema)}`;
  return { system, user };
}
