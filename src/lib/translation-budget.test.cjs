const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");
function load(name) {
  const scope = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(`${__dirname}/${name}.ts`, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText,
    scope,
  );
  return scope.exports;
}
const { translationOutputBudget: budget } = load("translation-budget");
const { calculateSourceWindowTokens: windowSize } = load("token-windows");
test("disabled thinking with automatic output leaves only formatting reserve", () => {
  const result = budget(null, '{"thinking":{"type":"disabled"}}');
  assert.equal(result.cap, undefined);
  assert.equal(result.reserve, 256);
});
test("task setting overrides custom output but automatic uses custom output", () => {
  assert.equal(budget(16000, '{"max_tokens":128000}').cap, 16000);
  assert.equal(budget(null, '{"max_tokens":128000}').cap, 128000);
  assert.equal(budget(null, '{"max_completion_tokens":64000}').cap, 64000);
  assert.equal(budget(null, "null").cap, undefined);
});
test("window planning reserves explicit reasoning before estimating translated output", () => {
  const result = budget(16000, '{"thinking":{"budget_tokens":8000}}');
  const size = windowSize({
    contextWindowTokens: 1000000,
    fixedContent: "",
    fixedPromptOverhead: 4500,
    outputExpansion: 3,
    replyTokenLimit: result.cap,
    outputTokenReserve: result.reserve,
  });
  assert.ok(size * 3 + result.reserve <= result.cap);
  assert.equal(size, 2581);
});
