exports.up = async function up(knex) {
  await knex.schema.alterTable("character_chat_messages", (table) => {
    table.text("swipe_data").nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("character_chat_messages", (table) => {
    table.dropColumn("swipe_data");
  });
};
