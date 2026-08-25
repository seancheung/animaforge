const SYSTEM_ENTITY_TYPES = [
  ["system-character", "character", "Character", 0],
  ["system-location", "location", "Location", 1],
  ["system-item", "item", "Item", 2],
  ["system-organization", "organization", "Organization", 3],
  ["system-rule", "rule", "Rule", 4],
  ["system-other", "other", "Other", 5],
];

/**
 * Create the complete application schema at its latest state.
 *
 * @param {import("knex").Knex} knex
 */
exports.up = async function up(knex) {
  const timestamps = (table) => {
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
  };

  await knex.schema.createTable("style_fingerprints", (table) => {
    table.text("id").primary();
    table.text("name").notNullable();
    table.text("config").notNullable();
    timestamps(table);
    table.index("updated_at");
  });

  await knex.schema.createTable("projects", (table) => {
    table.text("id").primary();
    table.text("name").notNullable();
    table.text("synopsis").notNullable().defaultTo("");
    table.text("prose_style").notNullable().defaultTo("");
    table.text("language").notNullable().defaultTo("");
    table.text("model_overrides").notNullable().defaultTo("{}");
    table.text("style_fingerprint_id").references("style_fingerprints.id").onDelete("SET NULL");
    timestamps(table);
  });

  await knex.schema.createTable("entity_types", (table) => {
    table.text("id").primary();
    table.text("project_id").references("projects.id").onDelete("CASCADE");
    table.text("system_key").unique();
    table.text("name").notNullable();
    table.text("description").notNullable().defaultTo("");
    table.integer("sort_order").notNullable().defaultTo(0);
    timestamps(table);
    table.index(["project_id", "sort_order"]);
    table.unique(["project_id", "name"]);
  });

  await knex("entity_types").insert(
    SYSTEM_ENTITY_TYPES.map(([id, systemKey, name, sortOrder]) => ({
      id,
      project_id: null,
      system_key: systemKey,
      name,
      sort_order: sortOrder,
    })),
  );

  await knex.schema.createTable("entities", (table) => {
    table.text("id").primary();
    table.text("project_id").notNullable().references("projects.id").onDelete("CASCADE");
    table.text("type_id").notNullable().references("entity_types.id");
    table.text("name").notNullable();
    table.text("description").notNullable().defaultTo("");
    table.integer("always_include").notNullable().defaultTo(0);
    timestamps(table);
    table.index(["project_id", "type_id"]);
    table.index(["project_id", "updated_at"]);
  });

  await knex.schema.createTable("entity_relations", (table) => {
    table.text("id").primary();
    table.text("project_id").notNullable().references("projects.id").onDelete("CASCADE");
    table.text("source_entity_id").notNullable().references("entities.id").onDelete("CASCADE");
    table.text("target_entity_id").notNullable().references("entities.id").onDelete("CASCADE");
    table.text("name").notNullable();
    table.text("description").notNullable().defaultTo("");
    table.integer("always_include").notNullable().defaultTo(0);
    timestamps(table);
    table.index(["project_id", "source_entity_id"]);
    table.index(["project_id", "target_entity_id"]);
  });

  await knex.schema.createTable("chapters", (table) => {
    table.text("id").primary();
    table.text("project_id").notNullable().references("projects.id").onDelete("CASCADE");
    table.text("title").notNullable();
    table.text("synopsis").notNullable().defaultTo("");
    table.integer("sort_order").notNullable().defaultTo(0);
    table.text("entity_mode").notNullable().defaultTo("selected");
    timestamps(table);
    table.index(["project_id", "sort_order"]);
  });

  await knex.schema.createTable("chapter_entities", (table) => {
    table.text("chapter_id").notNullable().references("chapters.id").onDelete("CASCADE");
    table.text("entity_id").notNullable().references("entities.id").onDelete("CASCADE");
    table.primary(["chapter_id", "entity_id"]);
    table.index("entity_id");
  });

  await knex.schema.createTable("blocks", (table) => {
    table.text("id").primary();
    table.text("chapter_id").notNullable().references("chapters.id").onDelete("CASCADE");
    table.text("type").notNullable().defaultTo("text");
    table.text("synopsis").notNullable().defaultTo("");
    table.integer("sort_order").notNullable().defaultTo(0);
    table.text("current_swipe_id");
    table.integer("stale").notNullable().defaultTo(0);
    timestamps(table);
    table.index(["chapter_id", "sort_order"]);
  });

  await knex.schema.createTable("block_swipes", (table) => {
    table.text("id").primary();
    table.text("block_id").notNullable().references("blocks.id").onDelete("CASCADE");
    table.text("content").notNullable().defaultTo("");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.index(["block_id", "created_at"]);
  });

  await knex.schema.createTable("character_chats", (table) => {
    table.text("id").primary();
    table.text("project_id").notNullable().references("projects.id").onDelete("CASCADE");
    table.text("user_entity_id").references("entities.id");
    table.text("member_key").notNullable();
    table.json("context_settings").notNullable().defaultTo("{}");
    timestamps(table);
    table.unique(["project_id", "member_key"]);
    table.index(["project_id", "updated_at"]);
  });

  await knex.schema.createTable("character_chat_members", (table) => {
    table.text("chat_id").notNullable().references("character_chats.id").onDelete("CASCADE");
    table.text("entity_id").notNullable().references("entities.id");
    table.integer("sort_order").notNullable().defaultTo(0);
    table.primary(["chat_id", "entity_id"]);
    table.index("entity_id");
  });

  await knex.schema.createTable("character_chat_sessions", (table) => {
    table.text("id").primary();
    table.text("chat_id").notNullable().references("character_chats.id").onDelete("CASCADE");
    table.integer("sort_order").notNullable();
    timestamps(table);
    table.unique(["chat_id", "sort_order"]);
    table.index(["chat_id", "updated_at"]);
  });

  await knex.schema.createTable("character_chat_messages", (table) => {
    table.text("id").primary();
    table
      .text("session_id")
      .notNullable()
      .references("character_chat_sessions.id")
      .onDelete("CASCADE");
    table.text("role").notNullable();
    table.text("speaker_entity_id").references("entities.id");
    table.text("content").notNullable();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.index(["session_id", "created_at"]);
    table.index("speaker_entity_id");
  });

  await knex.schema.createTable("llm_services", (table) => {
    table.text("id").primary();
    table.text("name").notNullable();
    table.text("type").notNullable();
    table.text("base_url").notNullable();
    table.text("api_key").notNullable().defaultTo("");
    timestamps(table);
  });

  await knex.schema.createTable("llm_models", (table) => {
    table.text("id").primary();
    table.text("service_id").notNullable().references("llm_services.id").onDelete("CASCADE");
    table.text("model_id").notNullable();
    table.text("display_name").notNullable();
    table.text("custom_body").notNullable().defaultTo("{}");
    table.float("input_price");
    table.float("cache_read_price");
    table.float("cache_write_price");
    table.float("output_price");
    table.integer("context_window_k").notNullable().defaultTo(128);
    table.index("service_id");
  });

  await knex.schema.createTable("app_settings", (table) => {
    table.text("key").primary();
    table.json("value").notNullable();
  });

  await knex.schema.createTable("assistant_conversations", (table) => {
    table.text("id").primary();
    table.text("project_id").notNullable().references("projects.id").onDelete("CASCADE");
    table.text("scope").notNullable();
    table.text("context_id").notNullable().defaultTo("");
    timestamps(table);
    table.unique(["project_id", "scope", "context_id"]);
    table.index(["project_id", "context_id"]);
  });

  await knex.schema.createTable("assistant_messages", (table) => {
    table.text("id").primary();
    table
      .text("conversation_id")
      .notNullable()
      .references("assistant_conversations.id")
      .onDelete("CASCADE");
    table.text("role").notNullable();
    table.text("content").notNullable().defaultTo("");
    table.text("scope").notNullable().defaultTo("project");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.index(["conversation_id", "created_at"]);
  });

  await knex.schema.createTable("assistant_proposals", (table) => {
    table.text("id").primary();
    table.text("message_id").notNullable().references("assistant_messages.id").onDelete("CASCADE");
    table.text("title").notNullable();
    table.text("description").notNullable().defaultTo("");
    table.text("supersedes_proposal_id").references("assistant_proposals.id").onDelete("SET NULL");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.index("message_id");
    table.index("supersedes_proposal_id");
  });

  await knex.schema.createTable("assistant_proposal_items", (table) => {
    table.text("id").primary();
    table
      .text("proposal_id")
      .notNullable()
      .references("assistant_proposals.id")
      .onDelete("CASCADE");
    table.text("action").notNullable();
    table.text("label").notNullable();
    table.text("payload").notNullable().defaultTo("{}");
    table.text("decision").notNullable().defaultTo("pending");
    table.text("applied_entity_id");
    table.text("supersedes_item_id").references("assistant_proposal_items.id").onDelete("SET NULL");
    table.integer("sort_order").notNullable().defaultTo(0);
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
    table.index(["proposal_id", "sort_order"]);
    table.index("supersedes_item_id");
  });

  await knex.schema.createTable("assistant_attachments", (table) => {
    table.text("id").primary();
    table
      .text("conversation_id")
      .notNullable()
      .references("assistant_conversations.id")
      .onDelete("CASCADE");
    table.text("name").notNullable();
    table.text("mime_type").notNullable().defaultTo("");
    table.integer("size_bytes").notNullable().defaultTo(0);
    table.text("content").notNullable().defaultTo("");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.index(["conversation_id", "created_at"]);
  });

  await knex.schema.createTable("assistant_message_refs", (table) => {
    table.text("id").primary();
    table.text("message_id").notNullable().references("assistant_messages.id").onDelete("CASCADE");
    table.text("resource_type").notNullable();
    table.text("resource_id").notNullable();
    table.text("label").notNullable();
    table.integer("sort_order").notNullable().defaultTo(0);
    table.index(["message_id", "sort_order"]);
  });

  await knex.schema.createTable("assistant_tool_activities", (table) => {
    table.text("id").primary();
    table.text("message_id").notNullable().references("assistant_messages.id").onDelete("CASCADE");
    table.text("tool_name").notNullable();
    table.text("label").notNullable();
    table.integer("sort_order").notNullable().defaultTo(0);
    table.index(["message_id", "sort_order"]);
  });

  await knex.schema.createTable("project_reviews", (table) => {
    table.text("id").primary();
    table.text("project_id").notNullable().references("projects.id").onDelete("CASCADE");
    table.text("reviewer_id").notNullable();
    table.text("reviewer_name").notNullable();
    table.text("reviewer_prompt").notNullable();
    table.text("content").notNullable().defaultTo("");
    table.text("status").notNullable().defaultTo("pending");
    table.text("model_id");
    table.text("chapter_id");
    table.text("chapter_title");
    timestamps(table);
    table.index(["project_id", "created_at"]);
  });

  await knex.schema.createTable("project_revisions", (table) => {
    table.text("id").primary();
    table.text("project_id").notNullable().references("projects.id").onDelete("CASCADE");
    table.text("source_type").notNullable().defaultTo("custom");
    table.text("style_fingerprint_id");
    table.text("style_fingerprint_name").notNullable().defaultTo("");
    table.text("style_fingerprint_config").notNullable().defaultTo("");
    table.text("review_id").references("project_reviews.id").onDelete("SET NULL");
    table.text("name").notNullable();
    table.text("source_project_name").notNullable();
    table.text("reviewer_name").notNullable();
    table.text("scope_chapter_id");
    table.text("scope_chapter_title");
    table.text("review_content").notNullable();
    table.text("requirements").notNullable().defaultTo("");
    table.text("plan_model_id");
    table.text("execution_model_id");
    table.text("active_blueprint_id");
    table.text("result_markdown").notNullable().defaultTo("");
    table.text("status").notNullable().defaultTo("draft");
    table.integer("window_token_limit");
    table.integer("execution_window_tokens");
    timestamps(table);
    table.index(["project_id", "created_at"]);
  });

  await knex.schema.createTable("project_revision_source_chapters", (table) => {
    table.text("id").primary();
    table.text("revision_id").notNullable().references("project_revisions.id").onDelete("CASCADE");
    table.text("source_chapter_id").notNullable();
    table.text("title").notNullable();
    table.integer("sort_order").notNullable();
    table.text("source_content").notNullable().defaultTo("");
    table.index(["revision_id", "sort_order"]);
  });

  await knex.schema.createTable("project_revision_blueprints", (table) => {
    table.text("id").primary();
    table.text("revision_id").notNullable().references("project_revisions.id").onDelete("CASCADE");
    table.integer("version").notNullable();
    table.text("model_id").notNullable();
    table.text("requirements").notNullable().defaultTo("");
    table.text("content").notNullable().defaultTo("");
    table.text("status").notNullable().defaultTo("generating");
    timestamps(table);
    table.unique(["revision_id", "version"]);
    table.unique(["revision_id"], {
      indexName: "project_revision_blueprints_revision_id_unique",
    });
    table.index(["revision_id", "created_at"]);
  });

  await knex.schema.createTable("project_revision_windows", (table) => {
    table.text("id").primary();
    table.text("revision_id").notNullable().references("project_revisions.id").onDelete("CASCADE");
    table
      .text("blueprint_id")
      .notNullable()
      .references("project_revision_blueprints.id")
      .onDelete("CASCADE");
    table
      .text("source_chapter_snapshot_id")
      .notNullable()
      .references("project_revision_source_chapters.id")
      .onDelete("CASCADE");
    table.integer("source_chapter_number").notNullable();
    table.text("source_chapter_title").notNullable();
    table.integer("chapter_window_index").notNullable();
    table.integer("chapter_window_count").notNullable();
    table.integer("document_window_index").notNullable();
    table.integer("document_window_count").notNullable();
    table.text("mode").notNullable().defaultTo("generate");
    table.text("source_content").notNullable().defaultTo("");
    table.text("output_content").notNullable().defaultTo("");
    table.text("status").notNullable().defaultTo("pending");
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
    table.unique(["blueprint_id", "document_window_index"]);
    table.index(["revision_id", "blueprint_id", "document_window_index"]);
  });

  await knex.schema.createTable("translation_projects", (table) => {
    table.text("id").primary();
    table.text("name").notNullable();
    table.text("source_file_name").notNullable();
    table.text("source_format").notNullable();
    table.text("source_language").notNullable().defaultTo("");
    table.text("source_content").notNullable();
    table.integer("source_has_bom").notNullable().defaultTo(0);
    table.text("source_line_ending").notNullable().defaultTo("lf");
    table.timestamp("source_locked_at");
    timestamps(table);
    table.index("updated_at");
  });

  await knex.schema.createTable("translation_blueprints", (table) => {
    table.text("id").primary();
    table
      .text("project_id")
      .notNullable()
      .references("translation_projects.id")
      .onDelete("CASCADE");
    table.integer("ordinal").notNullable();
    table.text("name").notNullable();
    table.text("target_language").notNullable();
    table.text("source_language").notNullable().defaultTo("");
    table.text("instructions").notNullable().defaultTo("");
    table.text("content").notNullable().defaultTo("");
    table.text("generation_model_id");
    table.text("stage_config").notNullable().defaultTo("[]");
    table.text("status").notNullable().defaultTo("queued");
    table.integer("window_token_limit");
    table.integer("execution_window_tokens");
    table
      .text("cloned_from_blueprint_id")
      .references("translation_blueprints.id")
      .onDelete("SET NULL");
    table.timestamp("locked_at");
    timestamps(table);
    table.unique(["project_id", "ordinal"]);
    table.index(["project_id", "created_at"]);
  });

  await knex.schema.createTable("translation_blueprint_nodes", (table) => {
    table.text("id").primary();
    table
      .text("blueprint_id")
      .notNullable()
      .references("translation_blueprints.id")
      .onDelete("CASCADE");
    table.integer("level").notNullable();
    table.integer("node_index").notNullable();
    table.integer("node_count").notNullable();
    table.text("input_content").notNullable();
    table.text("output_content").notNullable().defaultTo("");
    table.text("status").notNullable().defaultTo("pending");
    timestamps(table);
    table.unique(["blueprint_id", "level", "node_index"]);
    table.index(["blueprint_id", "level", "status"]);
  });

  await knex.schema.createTable("translation_source_windows", (table) => {
    table.text("id").primary();
    table
      .text("blueprint_id")
      .notNullable()
      .references("translation_blueprints.id")
      .onDelete("CASCADE");
    table.integer("window_index").notNullable();
    table.integer("window_count").notNullable();
    table.text("source_content").notNullable();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.unique(["blueprint_id", "window_index"]);
    table.index(["blueprint_id", "window_index"]);
  });

  await knex.schema.createTable("translation_window_outputs", (table) => {
    table.text("id").primary();
    table
      .text("blueprint_id")
      .notNullable()
      .references("translation_blueprints.id")
      .onDelete("CASCADE");
    table
      .text("source_window_id")
      .notNullable()
      .references("translation_source_windows.id")
      .onDelete("CASCADE");
    table.text("stage").notNullable();
    table.integer("window_index").notNullable();
    table.text("content").notNullable().defaultTo("");
    table.text("partial_content").notNullable().defaultTo("");
    table.text("status").notNullable().defaultTo("pending");
    timestamps(table);
    table.unique(["blueprint_id", "stage", "window_index"]);
    table.index(["blueprint_id", "stage", "status", "window_index"]);
  });

  await knex.schema.createTable("background_jobs", (table) => {
    table.text("id").primary();
    table.text("kind").notNullable();
    table
      .text("translation_project_id")
      .notNullable()
      .references("translation_projects.id")
      .onDelete("CASCADE");
    table
      .text("translation_blueprint_id")
      .notNullable()
      .references("translation_blueprints.id")
      .onDelete("CASCADE");
    table.text("status").notNullable().defaultTo("queued");
    table.integer("progress_current").notNullable().defaultTo(0);
    table.integer("progress_total").notNullable().defaultTo(0);
    table.text("message").notNullable().defaultTo("");
    table.text("error").notNullable().defaultTo("");
    table.integer("pause_requested").notNullable().defaultTo(0);
    table.integer("cancel_requested").notNullable().defaultTo(0);
    table.integer("retry_count").notNullable().defaultTo(0);
    table.timestamp("available_at").notNullable().defaultTo(knex.fn.now());
    table.text("lease_owner");
    table.timestamp("lease_expires_at");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("started_at");
    table.timestamp("finished_at");
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
    table.index(["status", "available_at", "updated_at"]);
    table.index(["translation_blueprint_id", "created_at"]);
  });

  await knex.schema.createTable("token_usage", (table) => {
    table.increments("id").primary();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.text("service_name").notNullable();
    table.text("model_id").notNullable();
    table.text("feature").notNullable();
    table.integer("input_tokens").notNullable().defaultTo(0);
    table.integer("cache_read_tokens").notNullable().defaultTo(0);
    table.integer("cache_write_tokens").notNullable().defaultTo(0);
    table.integer("output_tokens").notNullable().defaultTo(0);
    // Deliberately not foreign keys: deleting a project must not alter usage history.
    table.text("project_kind");
    table.text("project_id");
    table.index("created_at");
    table.index("feature");
    table.index(
      ["project_kind", "project_id", "created_at"],
      "token_usage_project_created_at_index",
    );
  });

  await knex("app_settings").insert([
    { key: "uiLanguage", value: JSON.stringify(null) },
    { key: "language", value: JSON.stringify("") },
    { key: "taskModels", value: JSON.stringify({}) },
    { key: "replyCaps", value: JSON.stringify({}) },
    { key: "characterChatMaxConsecutiveReplies", value: JSON.stringify(5) },
    { key: "translationConcurrency", value: JSON.stringify(2) },
    { key: "translationWindowTokenLimit", value: JSON.stringify(null) },
    { key: "revisionWindowTokenLimit", value: JSON.stringify(null) },
  ]);
};

/**
 * @param {import("knex").Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("token_usage");
  await knex.schema.dropTableIfExists("background_jobs");
  await knex.schema.dropTableIfExists("translation_window_outputs");
  await knex.schema.dropTableIfExists("translation_source_windows");
  await knex.schema.dropTableIfExists("translation_blueprint_nodes");
  await knex.schema.dropTableIfExists("translation_blueprints");
  await knex.schema.dropTableIfExists("translation_projects");
  await knex.schema.dropTableIfExists("project_revision_windows");
  await knex.schema.dropTableIfExists("project_revision_blueprints");
  await knex.schema.dropTableIfExists("project_revision_source_chapters");
  await knex.schema.dropTableIfExists("project_revisions");
  await knex.schema.dropTableIfExists("project_reviews");
  await knex.schema.dropTableIfExists("assistant_tool_activities");
  await knex.schema.dropTableIfExists("assistant_message_refs");
  await knex.schema.dropTableIfExists("assistant_attachments");
  await knex.schema.dropTableIfExists("assistant_proposal_items");
  await knex.schema.dropTableIfExists("assistant_proposals");
  await knex.schema.dropTableIfExists("assistant_messages");
  await knex.schema.dropTableIfExists("assistant_conversations");
  await knex.schema.dropTableIfExists("app_settings");
  await knex.schema.dropTableIfExists("llm_models");
  await knex.schema.dropTableIfExists("llm_services");
  await knex.schema.dropTableIfExists("character_chat_messages");
  await knex.schema.dropTableIfExists("character_chat_sessions");
  await knex.schema.dropTableIfExists("character_chat_members");
  await knex.schema.dropTableIfExists("character_chats");
  await knex.schema.dropTableIfExists("block_swipes");
  await knex.schema.dropTableIfExists("blocks");
  await knex.schema.dropTableIfExists("chapter_entities");
  await knex.schema.dropTableIfExists("chapters");
  await knex.schema.dropTableIfExists("entity_relations");
  await knex.schema.dropTableIfExists("entities");
  await knex.schema.dropTableIfExists("entity_types");
  await knex.schema.dropTableIfExists("projects");
  await knex.schema.dropTableIfExists("style_fingerprints");
};
