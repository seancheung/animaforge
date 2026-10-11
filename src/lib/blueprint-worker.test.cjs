const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { randomUUID } = require("node:crypto");
const { test } = require("node:test");
const ts = require("typescript");
const knex = require("knex");

function load(name, deps = {}, extra = "") {
  const code = ts.transpileModule(fs.readFileSync(`${__dirname}/${name}.ts`, "utf8") + extra, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const scope = {
    exports: {},
    require: (key) => {
      if (!(key in deps)) throw new Error(`Unexpected import: ${key}`);
      return deps[key];
    },
  };
  vm.runInNewContext(code, scope);
  return scope.exports;
}

async function fixture(t, contextK = 1000, source = "文".repeat(165004), generate) {
  const db = knex({
    client: "better-sqlite3",
    connection: { filename: ":memory:" },
    useNullAsDefault: true,
  });
  t.after(() => db.destroy());
  await db.schema.createTable("translation_projects", (table) => {
    table.string("id").primary();
    table.text("source_content");
  });
  await db.schema.createTable("translation_blueprints", (table) => {
    for (const key of [
      "id",
      "project_id",
      "generation_model_id",
      "source_language",
      "target_language",
      "status",
      "instructions",
      "content",
      "updated_at",
    ])
      table.text(key);
  });
  await db.schema.createTable("background_jobs", (table) => {
    for (const key of ["id", "message", "updated_at"]) table.text(key);
    table.integer("progress_current");
    table.integer("progress_total");
  });
  await db.schema.createTable("translation_blueprint_nodes", (table) => {
    for (const key of [
      "id",
      "blueprint_id",
      "input_content",
      "output_content",
      "status",
      "updated_at",
    ])
      table.text(key);
    for (const key of ["level", "node_index", "node_count"]) table.integer(key);
  });
  await require("../../migrations/202610120001_blueprint_preview.cjs").up(db);
  await db("translation_projects").insert({ id: "p", source_content: source });
  await db("translation_blueprints").insert({
    id: "b",
    project_id: "p",
    generation_model_id: "m",
    target_language: "Chinese",
    instructions: "",
  });
  await db("background_jobs").insert({ id: "j" });
  const requests = [];
  const worker = load(
    "translation-worker",
    {
      "@/lib/api": { ApiError: class extends Error {} },
      "@/lib/background-registry": {},
      "@/lib/blueprint-reduction": load("blueprint-reduction"),
      "@/lib/token-windows": load("token-windows"),
      "@/lib/translation": {},
      "@/lib/translation-budget": load("translation-budget"),
      "@/lib/db": {
        getDb: async () => db,
        newId: randomUUID,
        parseJson: (text) => JSON.parse(text),
      },
      "@/lib/data": {
        loadSettings: async () => ({ replyCaps: { translationBlueprint: 8192 }, taskModels: {} }),
        loadServices: async () => [{ models: [{ id: "m", contextWindowK: contextK }] }],
      },
      "@/lib/model-generation": {
        generateModelText: async (request) => {
          requests.push(request);
          if (generate) return generate(request, db);
          await request.onDelta?.("Concise blueprint");
          return "Concise blueprint";
        },
      },
    },
    "\nexport { processBlueprintQuantum };",
  );
  return {
    db,
    requests,
    run: () =>
      worker.processBlueprintQuantum(
        { id: "j", translation_blueprint_id: "b" },
        new AbortController().signal,
      ),
  };
}

test("large context generates directly without segment nodes", async (t) => {
  const f = await fixture(t);
  assert.equal(await f.run(), "complete");
  assert.equal(f.requests.length, 1);
  assert.match(f.requests[0].prompt, /<source_document>/);
  assert.equal((await f.db("translation_blueprint_nodes")).length, 0);
  assert.equal((await f.db("background_jobs").first()).progress_total, 1);
});

test("resumed legacy task reuses complete analysis and skips pending reductions", async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 14; i++)
    await f.db("translation_blueprint_nodes").insert({
      id: randomUUID(),
      blueprint_id: "b",
      level: 0,
      node_index: i,
      node_count: 14,
      status: "completed",
      input_content: "source",
      output_content: "文".repeat(6000),
    });
  await f.db("translation_blueprint_nodes").insert({
    id: "pending",
    blueprint_id: "b",
    level: 1,
    node_index: 0,
    node_count: 1,
    status: "pending",
    input_content: "unused",
  });
  assert.equal(await f.run(), "complete");
  assert.equal(f.requests.length, 1);
  assert.match(f.requests[0].prompt, /<consolidated_analyses>/);
  assert.equal(
    (await f.db("translation_blueprint_nodes").where({ id: "pending" }).first()).status,
    "pending",
  );
});

test("small context splits without losing source and reports stage progress", async (t) => {
  const source = "<&文>".repeat(10000);
  const f = await fixture(t, 32, source);
  assert.equal(await f.run(), "continue");
  const nodes = await f.db("translation_blueprint_nodes").orderBy("node_index");
  assert.ok(nodes.length > 1);
  assert.equal(nodes.map((node) => node.input_content).join(""), source);
  const job = await f.db("background_jobs").first();
  assert.equal(job.message, "Blueprint:analysis");
  assert.equal(job.progress_current, 1);
  assert.equal(job.progress_total, nodes.length);
});

test("nonshrinking reduction stops before another model call or layer", async (t) => {
  const f = await fixture(t, 32);
  await f.db("translation_blueprint_nodes").insert({
    id: "n",
    blueprint_id: "b",
    level: 1,
    node_index: 0,
    node_count: 1,
    status: "completed",
    input_content: "文".repeat(20000),
    output_content: "文".repeat(30000),
  });
  await assert.rejects(f.run(), /translationBlueprintReductionStalled/);
  assert.equal(f.requests.length, 0);
  assert.equal((await f.db("translation_blueprint_nodes")).length, 1);
});

test("streaming preview is separate from final content and cleared on success", async (t) => {
  const f = await fixture(t, 1000, "source", async (request, db) => {
    await request.onDelta("First");
    const row = await db("translation_blueprints").first();
    assert.equal(row.partial_content, "First");
    assert.equal(row.content, null);
    assert.equal(row.status, "generating");
    await request.onDelta(" second");
    return "First second";
  });
  assert.equal(await f.run(), "complete");
  const row = await f.db("translation_blueprints").first();
  assert.equal(row.content, "First second");
  assert.equal(row.partial_content, "");
  assert.equal(row.status, "ready");
});

test("interrupted streams flush the last draft and restart without duplicate text", async (t) => {
  let attempt = 0;
  const f = await fixture(t, 1000, "source", async (request) => {
    if (attempt++ === 0) {
      await request.onDelta("First");
      await request.onDelta(" tail");
      throw new Error("interrupted");
    }
    await request.onDelta("Replacement");
    return "Replacement";
  });
  await assert.rejects(f.run(), /interrupted/);
  const row = await f.db("translation_blueprints").first();
  assert.equal(row.partial_content, "First tail");
  assert.equal(row.content, null);
  assert.equal(await f.run(), "complete");
  assert.equal((await f.db("translation_blueprints").first()).content, "Replacement");
});
