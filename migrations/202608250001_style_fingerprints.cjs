/**
 * @param {import("knex").Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable("style_fingerprints", (table) => {
    table.text("id").primary();
    table.text("name").notNullable();
    table.text("config").notNullable();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
    table.index("updated_at");
  });

  await knex.schema.alterTable("projects", (table) => {
    table.text("style_fingerprint_id").references("style_fingerprints.id").onDelete("SET NULL");
  });
  await knex.schema.alterTable("project_revisions", (table) => {
    table.text("source_type").notNullable().defaultTo("custom");
    table.text("style_fingerprint_id");
    table.text("style_fingerprint_name").notNullable().defaultTo("");
    table.text("style_fingerprint_config").notNullable().defaultTo("");
  });
};

/**
 * @param {import("knex").Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.alterTable("project_revisions", (table) => {
    table.dropColumn("style_fingerprint_config");
    table.dropColumn("style_fingerprint_name");
    table.dropColumn("style_fingerprint_id");
    table.dropColumn("source_type");
  });
  await knex.schema.alterTable("projects", (table) => {
    table.dropColumn("style_fingerprint_id");
  });
  await knex.schema.dropTableIfExists("style_fingerprints");
};
