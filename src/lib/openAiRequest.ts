/** Direct OpenAI Chat Completions parameters. Compatible providers keep their
 * own request bodies; their token and sampling parameters can differ. */
export function openAiRequest(base: Record<string, unknown>, model: string): Record<string, unknown> {
  const body = { ...base, model, max_completion_tokens: 8192 };
  delete (body as Record<string, unknown>).max_tokens;
  // Reasoning models reject custom temperature values. Use model defaults.
  if (/^(?:o[134](?:-|$)|gpt-5(?:[.-]|$))/i.test(model)) {
    delete (body as Record<string, unknown>).temperature;
  }
  return body;
}
