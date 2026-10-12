import test from "node:test";
import assert from "node:assert/strict";
import { openAiRequest } from "./openAiRequest.ts";

const base = { messages: [{ role: "user", content: "Extract CV facts" }], temperature: 0, response_format: { type: "json_object" } };

test("OpenAI uses completion-token limits without mutating shared provider parameters", () => {
  const input = { ...base, max_tokens: 2000 };
  const body = openAiRequest(input, "gpt-4.1-mini");
  assert.equal(body.max_completion_tokens, 8192);
  assert.equal(body.max_tokens, undefined);
  assert.equal(body.temperature, 0);
  assert.deepEqual(body.messages, base.messages);
  assert.deepEqual(body.response_format, base.response_format);
  assert.equal(input.max_tokens, 2000);
});

test("reasoning models omit unsupported sampling parameters", () => {
  for (const model of ["gpt-5", "gpt-5-mini", "gpt-5.1", "gpt-5.2", "o1", "o3-mini", "o4-mini"]) {
    const body = openAiRequest(base, model);
    assert.equal(body.temperature, undefined, model);
    assert.equal(body.max_tokens, undefined, model);
    assert.equal(body.model, model);
    assert.equal(body.max_completion_tokens, 8192);
  }
  assert.equal(base.temperature, 0);
});

test("CV parsing requests enforce the exact schema through OpenAI structured outputs", async () => {
  const { ProfileDraft } = await import("./schema.ts");
  const { z } = await import("zod");
  const schema = z.toJSONSchema(ProfileDraft);
  delete schema.$schema;
  const body = openAiRequest(base, "gpt-4.1-mini", schema);
  assert.deepEqual(body.response_format, { type: "json_schema", json_schema: { name: "cv_facts", strict: true, schema } });
  assert.equal(schema.additionalProperties, false);
  assert.ok(schema.required?.includes("achievements"));
  assert.ok(schema.required?.includes("experience"));
  assert.deepEqual(base.response_format, { type: "json_object" });
});
