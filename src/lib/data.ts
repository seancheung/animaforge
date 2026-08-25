import type { Knex } from "knex";
import { isUiLocale } from "@/i18n/config";
import { getDb, parseJson } from "@/lib/db";
import type {
  AppSettings,
  Block,
  Chapter,
  Entity,
  EntityRelation,
  EntityType,
  LlmService,
  Project,
  ReviewerPrompt,
  StyleFingerprint,
  Swipe,
  TaskType,
} from "@/lib/types";

type Row = Record<string, unknown>;

const timestamp = (value: unknown) => String(value ?? "");

export const defaultReviewerPrompts: ReviewerPrompt[] = [
  {
    id: "default-reader",
    name: "Reader",
    prompt:
      "Evaluate the work from the perspective of an attentive reader. Focus on engagement, emotional impact, clarity, pacing, memorable moments, confusing passages, and the expectations the story creates. Be candid, specific, and constructive.",
  },
  {
    id: "default-tutor",
    name: "Tutor",
    prompt:
      "Evaluate the work as an experienced writing tutor. Analyze structure, characterization, point of view, prose, pacing, dialogue, theme, and narrative coherence. Identify the highest-impact improvements and give concrete, actionable guidance while respecting the author's intent.",
  },
];

function normalizeReviewerPrompts(value: unknown): ReviewerPrompt[] {
  if (!Array.isArray(value)) return defaultReviewerPrompts.map((reviewer) => ({ ...reviewer }));
  const seen = new Set<string>();
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const input = item as Partial<ReviewerPrompt>;
    const id = typeof input.id === "string" ? input.id.trim() : "";
    const name = typeof input.name === "string" ? input.name.trim() : "";
    const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
    if (!id || !name || !prompt || seen.has(id)) return [];
    seen.add(id);
    return [{ id, name, prompt }];
  });
}

export function mapProject(row: Row): Project {
  return {
    id: String(row.id),
    name: String(row.name),
    synopsis: String(row.synopsis ?? ""),
    proseStyle: String(row.prose_style ?? ""),
    styleFingerprintId: row.style_fingerprint_id ? String(row.style_fingerprint_id) : null,
    language: String(row.language ?? ""),
    modelOverrides: parseJson<Partial<Record<TaskType, string | null>>>(
      String(row.model_overrides ?? "{}"),
      {},
    ),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
    chapterCount: row.chapter_count === undefined ? undefined : Number(row.chapter_count),
    entityCount: row.entity_count === undefined ? undefined : Number(row.entity_count),
  };
}

export function mapStyleFingerprint(row: Row): StyleFingerprint {
  return {
    id: String(row.id),
    name: String(row.name),
    config: String(row.config ?? ""),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  };
}

export async function loadStyleFingerprints(): Promise<StyleFingerprint[]> {
  const conn = await getDb();
  const rows = (await conn("style_fingerprints").orderBy("updated_at", "desc")) as Row[];
  return rows.map(mapStyleFingerprint);
}

export async function loadStyleFingerprint(
  id: string | null | undefined,
): Promise<StyleFingerprint | null> {
  if (!id) return null;
  const conn = await getDb();
  const row = (await conn("style_fingerprints").where({ id }).first()) as Row | undefined;
  return row ? mapStyleFingerprint(row) : null;
}

export function mapEntityType(row: Row, prefix = ""): EntityType {
  const value = (key: string) => row[`${prefix}${key}`];
  const systemKey = value("system_key");
  return {
    id: String(value("id")),
    projectId: value("project_id") ? String(value("project_id")) : null,
    systemKey:
      systemKey === "character" ||
      systemKey === "location" ||
      systemKey === "item" ||
      systemKey === "organization" ||
      systemKey === "rule" ||
      systemKey === "other"
        ? systemKey
        : null,
    name: String(value("name") ?? ""),
    description: String(value("description") ?? ""),
    sortOrder: Number(value("sort_order") ?? 0),
    createdAt: timestamp(value("created_at")),
    updatedAt: timestamp(value("updated_at")),
  };
}

export function mapEntity(row: Row): Entity {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    typeId: String(row.type_id),
    type: mapEntityType(row, "type_"),
    name: String(row.name),
    description: String(row.description ?? ""),
    alwaysInclude: Boolean(row.always_include),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  };
}

export function mapEntityRelation(row: Row): EntityRelation {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    sourceEntityId: String(row.source_entity_id),
    targetEntityId: String(row.target_entity_id),
    name: String(row.name),
    description: String(row.description ?? ""),
    alwaysInclude: Boolean(row.always_include),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  };
}

export const entitySelectColumns = [
  "entities.*",
  "entity_types.project_id as type_project_id",
  "entity_types.system_key as type_system_key",
  "entity_types.name as type_name",
  "entity_types.description as type_description",
  "entity_types.sort_order as type_sort_order",
  "entity_types.created_at as type_created_at",
  "entity_types.updated_at as type_updated_at",
];

export async function loadEntityTypes(projectId: string): Promise<EntityType[]> {
  const conn = await getDb();
  const rows = (await conn("entity_types")
    .whereNull("project_id")
    .orWhere({ project_id: projectId })
    .orderByRaw("case when system_key is null then 1 else 0 end")
    .orderBy("sort_order", "asc")
    .orderBy("name", "asc")) as Row[];
  return rows.map((row) => mapEntityType(row));
}

export async function loadEntities(
  projectId: string,
  ids?: string[],
  trx?: Knex.Transaction,
): Promise<Entity[]> {
  const conn = trx ?? (await getDb());
  let query = conn("entities")
    .join("entity_types", "entities.type_id", "entity_types.id")
    .where("entities.project_id", projectId)
    .select(entitySelectColumns)
    .orderBy("entity_types.sort_order", "asc")
    .orderBy("entities.created_at", "asc");
  if (ids) {
    if (!ids.length) return [];
    query = query.whereIn("entities.id", ids);
  }
  return ((await query) as Row[]).map(mapEntity);
}

export async function loadEntity(
  projectId: string,
  entityId: string,
  trx?: Knex.Transaction,
): Promise<Entity | null> {
  return (await loadEntities(projectId, [entityId], trx))[0] ?? null;
}

export async function loadEntityRelations(
  projectId: string,
  entityIds?: string[],
  trx?: Knex.Transaction,
): Promise<EntityRelation[]> {
  const conn = trx ?? (await getDb());
  let query = conn("entity_relations").where({ project_id: projectId });
  if (entityIds) {
    if (!entityIds.length) return [];
    query = query.andWhere((builder) =>
      builder.whereIn("source_entity_id", entityIds).orWhereIn("target_entity_id", entityIds),
    );
  }
  return ((await query.orderBy("created_at", "asc")) as Row[]).map(mapEntityRelation);
}

export function mapChapter(row: Row, entityIds: string[] = []): Chapter {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    title: String(row.title),
    synopsis: String(row.synopsis ?? ""),
    sortOrder: Number(row.sort_order),
    entityMode: row.entity_mode === "all" ? "all" : "selected",
    entityIds,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  };
}

export async function loadBlocks(chapterId: string, trx?: Knex.Transaction): Promise<Block[]> {
  const conn = trx ?? (await getDb());
  const blockRows = (await conn("blocks")
    .where({ chapter_id: chapterId })
    .orderBy("sort_order", "asc")) as Row[];
  if (!blockRows.length) return [];
  const swipeRows = (await conn("block_swipes")
    .whereIn(
      "block_id",
      blockRows.map((row) => String(row.id)),
    )
    .orderBy("created_at", "asc")) as Row[];
  const swipes = new Map<string, Swipe[]>();
  swipeRows.forEach((row) => {
    const item: Swipe = {
      id: String(row.id),
      blockId: String(row.block_id),
      content: String(row.content ?? ""),
      createdAt: timestamp(row.created_at),
    };
    swipes.set(item.blockId, [...(swipes.get(item.blockId) ?? []), item]);
  });
  return blockRows.map((row) => ({
    id: String(row.id),
    chapterId: String(row.chapter_id),
    type: row.type === "checkpoint" ? "checkpoint" : "text",
    synopsis: String(row.synopsis ?? ""),
    sortOrder: Number(row.sort_order),
    currentSwipeId: String(row.current_swipe_id ?? ""),
    stale: Boolean(row.stale),
    swipes: swipes.get(String(row.id)) ?? [],
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  }));
}

export async function loadServices(): Promise<LlmService[]> {
  const conn = await getDb();
  const serviceRows = (await conn("llm_services").orderBy("created_at", "asc")) as Row[];
  const modelRows = (await conn("llm_models").orderBy("display_name", "asc")) as Row[];
  return serviceRows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    type: row.type === "anthropic" ? "anthropic" : "openai",
    baseUrl: String(row.base_url),
    apiKey: String(row.api_key ?? ""),
    models: modelRows
      .filter((model) => model.service_id === row.id)
      .map((model) => ({
        id: String(model.id),
        serviceId: String(model.service_id),
        modelId: String(model.model_id),
        displayName: String(model.display_name),
        contextWindowK: Math.max(1, Number(model.context_window_k ?? 128)),
        customBody: String(model.custom_body ?? "{}"),
        inputPrice: model.input_price == null ? null : Number(model.input_price),
        cacheReadPrice: model.cache_read_price == null ? null : Number(model.cache_read_price),
        cacheWritePrice: model.cache_write_price == null ? null : Number(model.cache_write_price),
        outputPrice: model.output_price == null ? null : Number(model.output_price),
      })),
  }));
}

export async function loadSettings(): Promise<AppSettings> {
  const conn = await getDb();
  const rows = (await conn("app_settings")) as Row[];
  const values = new Map(rows.map((row) => [String(row.key), String(row.value)]));
  const uiLanguage = parseJson<unknown>(values.get("uiLanguage"), null);
  const language = parseJson<unknown>(values.get("language"), "");
  const globalDefaultModel = parseJson<unknown>(values.get("globalDefaultModel"), null);
  const characterChatMaxConsecutiveReplies = parseJson<unknown>(
    values.get("characterChatMaxConsecutiveReplies"),
    5,
  );
  const translationConcurrency = parseJson<unknown>(values.get("translationConcurrency"), 2);
  const translationWindowTokenLimit = parseJson<unknown>(
    values.get("translationWindowTokenLimit"),
    null,
  );
  const revisionWindowTokenLimit = parseJson<unknown>(values.get("revisionWindowTokenLimit"), null);
  const reviewerPrompts = values.has("reviewerPrompts")
    ? normalizeReviewerPrompts(parseJson<unknown>(values.get("reviewerPrompts"), []))
    : defaultReviewerPrompts.map((reviewer) => ({ ...reviewer }));
  return {
    uiLanguage: isUiLocale(uiLanguage) ? uiLanguage : null,
    language: typeof language === "string" ? language : "",
    globalDefaultModel:
      typeof globalDefaultModel === "string" && globalDefaultModel ? globalDefaultModel : null,
    taskModels: parseJson(values.get("taskModels"), {}),
    replyCaps: parseJson(values.get("replyCaps"), {}),
    characterChatMaxConsecutiveReplies:
      typeof characterChatMaxConsecutiveReplies === "number" &&
      Number.isFinite(characterChatMaxConsecutiveReplies)
        ? Math.max(1, Math.floor(characterChatMaxConsecutiveReplies))
        : 5,
    translationConcurrency:
      typeof translationConcurrency === "number" && Number.isFinite(translationConcurrency)
        ? Math.min(4, Math.max(1, Math.floor(translationConcurrency)))
        : 2,
    translationWindowTokenLimit: normalizeGlobalWindowTokenLimit(translationWindowTokenLimit),
    revisionWindowTokenLimit: normalizeGlobalWindowTokenLimit(revisionWindowTokenLimit),
    reviewerPrompts,
  };
}

function normalizeGlobalWindowTokenLimit(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(64_000, Math.max(1_000, Math.round(value)))
    : null;
}

export async function saveSettings(settings: Partial<AppSettings>): Promise<void> {
  const entries = Object.entries(settings);
  if (!entries.length) return;

  const conn = await getDb();
  await conn("app_settings")
    .insert(entries.map(([key, value]) => ({ key, value: JSON.stringify(value) })))
    .onConflict("key")
    .merge(["value"]);
}

export async function markFollowingCheckpointsStale(
  chapterId: string,
  afterSort: number,
  trx?: Knex.Transaction,
) {
  const conn = trx ?? (await getDb());
  await conn("blocks")
    .where({ chapter_id: chapterId, type: "checkpoint" })
    .andWhere("sort_order", ">", afterSort)
    .update({ stale: 1, updated_at: conn.fn.now() });
}
