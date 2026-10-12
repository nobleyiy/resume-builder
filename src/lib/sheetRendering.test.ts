import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { emptyResume } from "./schema.ts";
import { repairResume } from "./resumeRepair.ts";

// Execute the actual TSX renderer under Node's test runner without adding a
// second test framework or changing the application's dependency declarations.
const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../components/resume/Sheet.tsx", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
const rendererModule = { exports: {} as { Sheet: import("react").ComponentType<{ resume: import("./schema.ts").Resume }> } };
new Function("require", "module", "exports", js)((name: string) => require(name === "@/lib/schema" ? "./schema.ts" : name === "@/lib/cn" ? "./cn.ts" : name), rendererModule, rendererModule.exports);

test("the sheet renders every stored entry once, and repair changes data rather than hiding entries", () => {
  const r = emptyResume();
  r.basics.name = "Alex";
  r.experience = [{ id: "a", company: "Geidea", role: "Service Delivery Senior Manager", location: "", start: "2022", end: "2025", current: false, bullets: ["Designed networks"] }, { id: "b", company: "Geidea", role: "Service Delivery Sr. Manager", location: "", start: "2022", end: "2025", current: false, bullets: ["Network design"] }];
  const raw = renderToStaticMarkup(createElement(rendererModule.exports.Sheet, { resume: r }));
  assert.equal((raw.match(/class="entry"/g) || []).length, r.experience.length);
  const repaired = repairResume(r);
  const html = renderToStaticMarkup(createElement(rendererModule.exports.Sheet, { resume: repaired }));
  assert.equal(repaired.experience.length, 1);
  assert.equal((html.match(/class="entry"/g) || []).length, 1);
  assert.equal((html.match(/<li>/g) || []).length, repaired.experience[0].bullets.length);
});
