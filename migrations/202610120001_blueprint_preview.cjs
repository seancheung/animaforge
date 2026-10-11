exports.up = async function up(knex) {
  await knex.schema.alterTable("translation_blueprints", (table) => {
    table.text("partial_content").notNullable().defaultTo("");
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("translation_blueprints", (table) => {
    table.dropColumn("partial_content");
  });
};
