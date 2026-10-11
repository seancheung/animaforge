const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const { test } = require("node:test");
const compiled = ts.transpileModule(
  fs.readFileSync(`${__dirname}/blueprint-reduction.ts`, "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } },
);
const context = { exports: {} };
vm.runInNewContext(compiled.outputText, context);
const { blueprintReductionError: check, MAX_BLUEPRINT_REDUCTION_LEVELS: limit } = context.exports;

test("initial analysis may expand; subsequent summaries must shrink", () => {
  assert.equal(check(0, 20000, 40000), null);
  assert.equal(check(1, 40000, 25000), null);
  assert.equal(check(2, 25000, 25000), "translationBlueprintReductionStalled");
  assert.equal(check(2, 25000, 30000), "translationBlueprintReductionStalled");
});

test("slowly shrinking summaries cannot loop forever", () => {
  for (let level = 1; level <= limit; level++) {
    assert.equal(
      check(level, 100000 - level, 99999 - level),
      level === limit ? "translationBlueprintReductionLimit" : null,
    );
  }
  assert.equal(check(limit + 10, 40000, 20000), "translationBlueprintReductionLimit");
});

test("budget reserves output, requirements, prompts and safety margin", () => {
  const budget = context.exports.blueprintInputBudget;
  assert.equal(budget(1000000, 128000, 1000), 766904);
  assert.ok(budget(1000000, 128000, 1000) > 165004);
  assert.ok(budget(32000, 8192, 1000) < 165004);
  assert.ok(budget(8000, 8192, 1000) < 512);
  assert.equal(budget(NaN, 8192, 0), 0);
});
