/** Direct OpenAI Chat Completions parameters. Compatible providers keep their
 * own request bodies; their token and sampling parameters can differ. */
export function openAiRequest(base: Record<string, unknown>, model: string, schema?: Record<string, unknown>): Record<string, unknown> {
  const body = { ...base, model, max_completion_tokens: 8192 };
  delete (body as Record<string, unknown>).max_tokens;
  if (schema) {
    (body as Record<string, unknown>).response_format = {
      type: "json_schema",
      json_schema: { name: "cv_facts", strict: true, schema },
    };
  }
  // Reasoning models reject custom temperature values. Use model defaults.
  if (/^(?:o[134](?:-|$)|gpt-5(?:[.-]|$))/i.test(model)) {
    delete (body as Record<string, unknown>).temperature;
  }
  return body;
}
