exports.up = async function up(knex) {
  // NULL represents the author and must also participate in uniqueness.
  await knex.raw(`
    CREATE UNIQUE INDEX character_chats_members_identity_unique
    ON character_chats (project_id, member_key, COALESCE(user_entity_id, ''))
  `);
  await knex.raw("DROP INDEX character_chats_project_id_member_key_unique");
};

exports.down = async function down(knex) {
  // Refuse rollback if distinct identities now share members; never discard chats.
  await knex.raw(`
    CREATE UNIQUE INDEX character_chats_project_id_member_key_unique
    ON character_chats (project_id, member_key)
  `);
  await knex.raw("DROP INDEX character_chats_members_identity_unique");
};
