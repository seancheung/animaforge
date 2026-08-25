import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { ApiError, localizeApiError } from "@/lib/api";
import { getDb, newId } from "@/lib/db";
import type { AssistantResourceRef, AssistantScope } from "@/lib/types";

type Row = Record<string, unknown>;

export type AssistantToolName =
  | "list_chapters"
  | "get_chapter_synopsis"
  | "list_chapter_blocks"
  | "get_block_content"
  | "get_chapter_content"
  | "search_chapter_content"
  | "list_entity_types"
  | "list_entities"
  | "get_entity"
  | "search_entities"
  | "list_relations"
  | "get_relation"
  | "list_attachments"
  | "read_attachment";

export interface AssistantToolActivityResult {
  toolName: AssistantToolName;
  label: string;
  result: unknown;
}

interface ToolDefinition {
  name: AssistantToolName;
  description: string;
  parameters: Record<string, unknown>;
}

export const assistantToolDefinitions: ToolDefinition[] = [
  {
    name: "list_chapters",
    description: "List all chapters in the current project with IDs, titles, order, and synopsis.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_chapter_synopsis",
    description: "Read one chapter's title and synopsis by its exact chapter ID.",
    parameters: {
      type: "object",
      properties: { chapterId: { type: "string" } },
      required: ["chapterId"],
      additionalProperties: false,
    },
  },
  {
    name: "list_chapter_blocks",
    description:
      "List all blocks in one chapter. Text blocks and checkpoint blocks have separate one-based blockNumber sequences matching the editor labels.",
    parameters: {
      type: "object",
      properties: { chapterId: { type: "string" } },
      required: ["chapterId"],
      additionalProperties: false,
    },
  },
  {
    name: "get_block_content",
    description:
      "Read one exact block by chapter ID, block type, and that type's one-based block number. blockType defaults to text, so an unqualified phrase such as 'block 3' means Text 03.",
    parameters: {
      type: "object",
      properties: {
        chapterId: { type: "string" },
        blockType: { type: "string", enum: ["text", "checkpoint"], default: "text" },
        blockNumber: { type: "integer", minimum: 1 },
      },
      required: ["chapterId", "blockNumber"],
      additionalProperties: false,
    },
  },
  {
    name: "get_chapter_content",
    description:
      "Read current chapter content. fromBlock and toBlock are an inclusive range using Text block numbers, matching Text 01, Text 02, and so on. Checkpoints inside the selected text range are excluded unless includeCheckpoints is true.",
    parameters: {
      type: "object",
      properties: {
        chapterId: { type: "string" },
        fromBlock: { type: "integer", minimum: 1 },
        toBlock: { type: "integer", minimum: 1 },
        includeCheckpoints: { type: "boolean" },
        maxCharacters: { type: "integer", minimum: 1000, maximum: 50000 },
      },
      required: ["chapterId"],
      additionalProperties: false,
    },
  },
  {
    name: "search_chapter_content",
    description:
      "Search current chapter prose across the project and return matching excerpts. Optionally restrict to one chapter ID.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        chapterId: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 20 },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "list_entity_types",
    description: "List available system and custom entity types with exact IDs.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_entities",
    description: "List all entities in the current project with type, ID, name, and description.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_entity",
    description: "Read one existing entity by its exact entity ID.",
    parameters: {
      type: "object",
      properties: { entityId: { type: "string" } },
      required: ["entityId"],
      additionalProperties: false,
    },
  },
  {
    name: "search_entities",
    description: "Search entity names, descriptions, and type names in the current project.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "list_relations",
    description: "List entity relations with exact IDs and endpoint entity IDs.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_relation",
    description: "Read one entity relation by its exact relation ID.",
    parameters: {
      type: "object",
      properties: { relationId: { type: "string" } },
      required: ["relationId"],
      additionalProperties: false,
    },
  },
  {
    name: "list_attachments",
    description: "List text attachments available in the current assistant conversation.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "read_attachment",
    description: "Read one text attachment by its exact attachment ID.",
    parameters: {
      type: "object",
      properties: {
        attachmentId: { type: "string" },
        maxCharacters: { type: "integer", minimum: 1000, maximum: 50000 },
      },
      required: ["attachmentId"],
      additionalProperties: false,
    },
  },
];

export const openAiAssistantTools = assistantToolDefinitions.map((tool) => ({
  type: "function" as const,
  function: { name: tool.name, description: tool.description, parameters: tool.parameters },
}));

export const anthropicAssistantTools = assistantToolDefinitions.map((tool) => ({
  name: tool.name,
  description: tool.description,
  input_schema: tool.parameters,
}));

const idSchema = z.string().min(1);

async function ensureToolConversation(
  projectId: string,
  scope: AssistantScope,
  contextId?: string | null,
) {
  const conn = await getDb();
  const context = scope === "chapter" ? (contextId?.trim() ?? "") : "";
  if (
    scope === "chapter" &&
    (!context || !(await conn("chapters").where({ id: context, project_id: projectId }).first()))
  )
    throw new ApiError("chapterNotFound", 404);
  let row = (await conn("assistant_conversations")
    .where({ project_id: projectId, scope, context_id: context })
    .first()) as Row | undefined;
  if (!row) {
    await conn("assistant_conversations")
      .insert({ id: newId(), project_id: projectId, scope, context_id: context })
      .onConflict(["project_id", "scope", "context_id"])
      .ignore();
    row = (await conn("assistant_conversations")
      .where({ project_id: projectId, scope, context_id: context })
      .first()) as Row | undefined;
  }
  if (!row) throw new ApiError("assistantConversationFailed", 500);
  return row;
}

async function chapter(projectId: string, chapterId: string) {
  const conn = await getDb();
  const row = (await conn("chapters").where({ id: chapterId, project_id: projectId }).first()) as
    | Row
    | undefined;
  if (!row) throw new ApiError("chapterNotFound", 404);
  return row;
}

async function chapterBlocks(projectId: string, chapterId: string) {
  await chapter(projectId, chapterId);
  const conn = await getDb();
  return (await conn("blocks")
    .leftJoin("block_swipes", "blocks.current_swipe_id", "block_swipes.id")
    .where({ "blocks.chapter_id": chapterId })
    .orderBy("blocks.sort_order", "asc")
    .select(
      "blocks.id",
      "blocks.type",
      "blocks.synopsis",
      "blocks.sort_order",
      "block_swipes.content",
    )) as Row[];
}

function clampMax(value: unknown, fallback = 30000) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1000, Math.min(50000, Math.floor(parsed))) : fallback;
}

function excerpt(content: string, query: string) {
  const index = content.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (index < 0) return content.slice(0, 260);
  const start = Math.max(0, index - 100);
  return `${start ? "..." : ""}${content.slice(start, index + query.length + 160)}${index + query.length + 160 < content.length ? "..." : ""}`;
}

function blockTypeNumber(blocks: Row[], row: Row) {
  return (
    blocks
      .filter((candidate) => candidate.type === row.type)
      .findIndex((candidate) => candidate.id === row.id) + 1
  );
}

function blockReferenceLabel(chapterTitle: unknown, type: unknown, blockNumber: number) {
  return type === "checkpoint"
    ? `${String(chapterTitle)}#Checkpoint ${blockNumber}`
    : `${String(chapterTitle)}#${blockNumber}`;
}

export async function executeAssistantTool(
  projectId: string,
  scope: AssistantScope,
  name: string,
  input: unknown,
  contextId?: string | null,
): Promise<AssistantToolActivityResult> {
  const t = await getTranslations("ToolActivity");
  const toolName = name as AssistantToolName;
  const args = typeof input === "object" && input ? (input as Record<string, unknown>) : {};
  const conn = await getDb();

  try {
    if (toolName === "list_chapters") {
      const rows = (await conn("chapters")
        .where({ project_id: projectId })
        .orderBy("sort_order", "asc")) as Row[];
      return {
        toolName,
        label: t("chapterList", { count: rows.length }),
        result: rows.map((row) => ({
          id: row.id,
          title: row.title,
          synopsis: row.synopsis,
          sortOrder: row.sort_order,
        })),
      };
    }

    if (toolName === "get_chapter_synopsis") {
      const chapterId = idSchema.parse(args.chapterId);
      const row = await chapter(projectId, chapterId);
      return {
        toolName,
        label: t("chapterSynopsis", { title: String(row.title) }),
        result: { id: row.id, title: row.title, synopsis: row.synopsis, sortOrder: row.sort_order },
      };
    }

    if (toolName === "list_chapter_blocks") {
      const chapterId = idSchema.parse(args.chapterId);
      const chapterRow = await chapter(projectId, chapterId);
      const blocks = await chapterBlocks(projectId, chapterId);
      return {
        toolName,
        label: t("blockList", { title: String(chapterRow.title), count: blocks.length }),
        result: blocks.map((row) => {
          const blockNumber = blockTypeNumber(blocks, row);
          return {
            id: row.id,
            blockNumber,
            label:
              row.type === "checkpoint"
                ? `Checkpoint ${String(blockNumber).padStart(2, "0")}`
                : `Text ${String(blockNumber).padStart(2, "0")}`,
            type: row.type,
            synopsis: row.synopsis,
            preview: String(row.content ?? "").slice(0, 180),
          };
        }),
      };
    }

    if (toolName === "get_block_content") {
      const chapterId = idSchema.parse(args.chapterId);
      const blockType = args.blockType === "checkpoint" ? "checkpoint" : "text";
      const blockNumber = z.number().int().min(1).parse(Number(args.blockNumber));
      const chapterRow = await chapter(projectId, chapterId);
      const blocks = await chapterBlocks(projectId, chapterId);
      const row = blocks.filter((candidate) => candidate.type === blockType)[blockNumber - 1];
      if (!row)
        throw new ApiError("blockLabelNotFound", 404, {
          label: `${blockType === "checkpoint" ? "Checkpoint" : "Text"} ${String(blockNumber).padStart(2, "0")}`,
        });
      const referenceLabel = blockReferenceLabel(chapterRow.title, blockType, blockNumber);
      return {
        toolName,
        label: t("block", { label: referenceLabel }),
        result: {
          chapterId,
          chapterTitle: chapterRow.title,
          blockId: row.id,
          blockNumber,
          label:
            blockType === "checkpoint"
              ? `Checkpoint ${String(blockNumber).padStart(2, "0")}`
              : `Text ${String(blockNumber).padStart(2, "0")}`,
          type: blockType,
          synopsis: row.synopsis,
          content: row.content ?? "",
        },
      };
    }

    if (toolName === "get_chapter_content") {
      const chapterId = idSchema.parse(args.chapterId);
      const chapterRow = await chapter(projectId, chapterId);
      const allBlocks = await chapterBlocks(projectId, chapterId);
      const textBlocks = allBlocks.filter((row) => row.type === "text");
      const fromBlock = Math.max(1, Number(args.fromBlock) || 1);
      const toBlock = Math.min(textBlocks.length, Number(args.toBlock) || textBlocks.length);
      const selectedTextBlocks = textBlocks.slice(fromBlock - 1, toBlock);
      const firstSort = Number(selectedTextBlocks.at(0)?.sort_order ?? 0);
      const lastSort = Number(selectedTextBlocks.at(-1)?.sort_order ?? -1);
      const selectedRows =
        args.includeCheckpoints === true
          ? allBlocks.filter(
              (row) => Number(row.sort_order) >= firstSort && Number(row.sort_order) <= lastSort,
            )
          : selectedTextBlocks;
      const selected = selectedRows.map((row) => ({
        row,
        blockNumber: blockTypeNumber(allBlocks, row),
      }));
      const content = selected
        .map(
          ({ row, blockNumber }) =>
            `<block id="${String(row.id)}" number="${blockNumber}" type="${String(row.type)}">${String(row.content ?? "")}</block>`,
        )
        .join("\n")
        .slice(0, clampMax(args.maxCharacters));
      const rangeLabel =
        fromBlock > 1 || toBlock < textBlocks.length
          ? `#${fromBlock}–#${toBlock}`
          : t("textBlocks", { count: selectedTextBlocks.length });
      return {
        toolName,
        label: t("chapterContent", { title: String(chapterRow.title), range: rangeLabel }),
        result: {
          chapterId,
          title: chapterRow.title,
          fromBlock,
          toBlock,
          blockCount: selected.length,
          content,
        },
      };
    }

    if (toolName === "search_chapter_content") {
      const query = z.string().trim().min(1).max(200).parse(args.query);
      const limit = Math.max(1, Math.min(20, Number(args.limit) || 8));
      let builder = conn("blocks")
        .join("chapters", "blocks.chapter_id", "chapters.id")
        .leftJoin("block_swipes", "blocks.current_swipe_id", "block_swipes.id")
        .where({ "chapters.project_id": projectId, "blocks.type": "text" })
        .andWhere("block_swipes.content", "like", `%${query}%`);
      if (args.chapterId) builder = builder.andWhere("chapters.id", idSchema.parse(args.chapterId));
      const rows = (await builder
        .orderBy("chapters.sort_order", "asc")
        .orderBy("blocks.sort_order", "asc")
        .limit(limit)
        .select(
          "chapters.id as chapter_id",
          "chapters.title",
          "blocks.id as block_id",
          "block_swipes.content",
        )) as Row[];
      const chapterIds = [...new Set(rows.map((row) => String(row.chapter_id)))];
      const numberedRows = chapterIds.length
        ? ((await conn("blocks")
            .whereIn("chapter_id", chapterIds)
            .andWhere({ type: "text" })
            .orderBy("sort_order", "asc")
            .select("id", "chapter_id")) as Row[])
        : [];
      return {
        toolName,
        label: t("searchContent", { query, count: rows.length }),
        result: rows.map((row) => {
          const chapterTextBlocks = numberedRows.filter(
            (candidate) => candidate.chapter_id === row.chapter_id,
          );
          const blockNumber =
            chapterTextBlocks.findIndex((candidate) => candidate.id === row.block_id) + 1;
          return {
            chapterId: row.chapter_id,
            chapterTitle: row.title,
            blockId: row.block_id,
            blockNumber,
            label: `Text ${String(blockNumber).padStart(2, "0")}`,
            reference: blockReferenceLabel(row.title, "text", blockNumber),
            excerpt: excerpt(String(row.content ?? ""), query),
          };
        }),
      };
    }

    if (toolName === "list_entity_types") {
      const rows = (await conn("entity_types")
        .whereNull("project_id")
        .orWhere({ project_id: projectId })
        .orderBy("sort_order", "asc")) as Row[];
      return {
        toolName,
        label: t("entityTypeList", { count: rows.length }),
        result: rows.map((row) => ({
          id: row.id,
          systemKey: row.system_key,
          name: row.name,
          description: row.description,
        })),
      };
    }

    if (toolName === "list_entities" || toolName === "search_entities") {
      const query =
        toolName === "search_entities" ? z.string().trim().min(1).max(200).parse(args.query) : "";
      let builder = conn("entities")
        .join("entity_types", "entities.type_id", "entity_types.id")
        .where("entities.project_id", projectId);
      if (query)
        builder = builder.andWhere((nested) =>
          nested
            .where("entities.name", "like", `%${query}%`)
            .orWhere("entities.description", "like", `%${query}%`)
            .orWhere("entity_types.name", "like", `%${query}%`),
        );
      const rows = (await builder
        .select(
          "entities.*",
          "entity_types.system_key as type_system_key",
          "entity_types.name as type_name",
        )
        .orderBy("entities.created_at", "asc")
        .limit(100)) as Row[];
      return {
        toolName,
        label: query
          ? t("searchEntities", { query, count: rows.length })
          : t("entityList", { count: rows.length }),
        result: rows.map((row) => ({
          id: row.id,
          typeId: row.type_id,
          type: row.type_system_key ?? row.type_name,
          name: row.name,
          description: row.description,
          alwaysInclude: Boolean(row.always_include),
        })),
      };
    }

    if (toolName === "get_entity") {
      const entityId = idSchema.parse(args.entityId);
      const row = (await conn("entities")
        .join("entity_types", "entities.type_id", "entity_types.id")
        .where({ "entities.id": entityId, "entities.project_id": projectId })
        .select(
          "entities.*",
          "entity_types.system_key as type_system_key",
          "entity_types.name as type_name",
        )
        .first()) as Row | undefined;
      if (!row) throw new ApiError("entityNotFound", 404);
      return {
        toolName,
        label: t("entity", { name: String(row.name) }),
        result: {
          id: row.id,
          typeId: row.type_id,
          type: row.type_system_key ?? row.type_name,
          name: row.name,
          description: row.description,
          alwaysInclude: Boolean(row.always_include),
        },
      };
    }

    if (toolName === "list_relations" || toolName === "get_relation") {
      const relationId = toolName === "get_relation" ? idSchema.parse(args.relationId) : null;
      let builder = conn("entity_relations").where({ project_id: projectId });
      if (relationId) builder = builder.andWhere({ id: relationId });
      const rows = (await builder.orderBy("created_at", "asc")) as Row[];
      if (relationId && !rows.length) throw new ApiError("entityRelationNotFound", 404);
      return {
        toolName,
        label: relationId
          ? t("relation", { name: String(rows[0].name) })
          : t("relationList", { count: rows.length }),
        result: relationId ? rows[0] : rows,
      };
    }

    const conversation = await ensureToolConversation(projectId, scope, contextId);
    if (toolName === "list_attachments") {
      const rows = (await conn("assistant_attachments")
        .where({ conversation_id: conversation.id })
        .orderBy("created_at", "asc")) as Row[];
      return {
        toolName,
        label: t("attachmentList", { count: rows.length }),
        result: rows.map((row) => ({
          id: row.id,
          name: row.name,
          mimeType: row.mime_type,
          sizeBytes: row.size_bytes,
        })),
      };
    }

    if (toolName === "read_attachment") {
      const attachmentId = idSchema.parse(args.attachmentId);
      const row = (await conn("assistant_attachments")
        .where({ id: attachmentId, conversation_id: conversation.id })
        .first()) as Row | undefined;
      if (!row) throw new ApiError("attachmentNotFound", 404);
      return {
        toolName,
        label: t("attachment", { name: String(row.name) }),
        result: {
          id: row.id,
          name: row.name,
          content: String(row.content ?? "").slice(0, clampMax(args.maxCharacters)),
        },
      };
    }

    throw new ApiError("unsupportedAssistantTool");
  } catch (error) {
    const message = await localizeApiError(error);
    return { toolName, label: t("failed", { message }), result: { error: message } };
  }
}

export async function listAssistantResources(
  projectId: string,
  scope: AssistantScope,
  query = "",
  contextId?: string | null,
): Promise<AssistantResourceRef[]> {
  const t = await getTranslations("Resources");
  const conn = await getDb();
  const project = (await conn("projects").where({ id: projectId }).first()) as Row | undefined;
  if (!project) throw new ApiError("projectNotFound", 404);
  const trimmedQuery = query.trim();
  const normalized = trimmedQuery.toLocaleLowerCase();
  const matches = (value: unknown) =>
    !normalized ||
    String(value ?? "")
      .toLocaleLowerCase()
      .includes(normalized);
  const [chapters, blocks, entities, relations, conversation] = await Promise.all([
    conn("chapters").where({ project_id: projectId }).orderBy("sort_order", "asc") as Promise<
      Row[]
    >,
    conn("blocks")
      .join("chapters", "blocks.chapter_id", "chapters.id")
      .where("chapters.project_id", projectId)
      .orderBy("chapters.sort_order", "asc")
      .orderBy("blocks.sort_order", "asc")
      .select(
        "blocks.id",
        "blocks.chapter_id",
        "blocks.type",
        "blocks.synopsis",
        "blocks.sort_order",
        "chapters.title as chapter_title",
      ) as Promise<Row[]>,
    conn("entities").where({ project_id: projectId }).orderBy("created_at", "asc") as Promise<
      Row[]
    >,
    conn("entity_relations")
      .where({ project_id: projectId })
      .orderBy("created_at", "asc") as Promise<Row[]>,
    ensureToolConversation(projectId, scope, contextId),
  ]);
  const attachments = (await conn("assistant_attachments")
    .where({ conversation_id: conversation.id })
    .orderBy("created_at", "asc")) as Row[];

  const blockChapter = [...chapters]
    .filter((row) => String(row.title).trim())
    .sort((left, right) => String(right.title).length - String(left.title).length)
    .find((row) => normalized.startsWith(`${String(row.title).trim().toLocaleLowerCase()}#`));
  if (blockChapter) {
    const chapterTitle = String(blockChapter.title).trim();
    const blockFilter = trimmedQuery
      .slice(chapterTitle.length + 1)
      .trim()
      .toLocaleLowerCase();
    return blocks
      .filter((row) => row.chapter_id === blockChapter.id)
      .map((row) => {
        const siblings = blocks.filter(
          (candidate) => candidate.chapter_id === row.chapter_id && candidate.type === row.type,
        );
        const blockNumber = siblings.findIndex((candidate) => candidate.id === row.id) + 1;
        return {
          type: "block" as const,
          id: String(row.id),
          label: blockReferenceLabel(row.chapter_title, row.type, blockNumber),
          description:
            row.type === "checkpoint"
              ? `Checkpoint ${String(blockNumber).padStart(2, "0")}`
              : `Text ${String(blockNumber).padStart(2, "0")}`,
        };
      })
      .filter(
        (row) =>
          !blockFilter ||
          row.label.toLocaleLowerCase().includes(blockFilter) ||
          row.description.toLocaleLowerCase().includes(blockFilter),
      )
      .slice(0, 24);
  }

  return [
    ...chapters
      .filter((row) => matches(row.title) || matches(row.synopsis))
      .map((row) => ({
        type: "chapter" as const,
        id: String(row.id),
        label: String(row.title),
        description: t("chapter"),
      })),
    ...entities
      .filter((row) => matches(row.name) || matches(row.description))
      .map((row) => ({
        type: "entity" as const,
        id: String(row.id),
        label: String(row.name),
        description: t("entityResource"),
      })),
    ...relations
      .filter((row) => matches(row.name) || matches(row.description))
      .map((row) => ({
        type: "relation" as const,
        id: String(row.id),
        label: String(row.name),
        description: t("relationResource"),
      })),
    ...attachments
      .filter((row) => matches(row.name))
      .map((row) => ({
        type: "attachment" as const,
        id: String(row.id),
        label: String(row.name),
        description: t("attachment"),
      })),
  ].slice(0, 24);
}

export async function resolveAssistantReferences(
  projectId: string,
  scope: AssistantScope,
  references: AssistantResourceRef[],
  contextId?: string | null,
) {
  const unique = references
    .filter(
      (reference, index, all) =>
        all.findIndex(
          (candidate) => candidate.type === reference.type && candidate.id === reference.id,
        ) === index,
    )
    .slice(0, 12);
  const resolved: { type: string; id: string; label: string; data: unknown }[] = [];
  for (const reference of unique) {
    if (reference.type === "chapter") {
      const chapterRow = await chapter(projectId, reference.id);
      const result = await executeAssistantTool(
        projectId,
        scope,
        "get_chapter_content",
        { chapterId: reference.id, maxCharacters: 30000 },
        contextId,
      );
      resolved.push({
        type: reference.type,
        id: reference.id,
        label: String(chapterRow.title),
        data: { synopsis: chapterRow.synopsis, content: result.result },
      });
    } else if (reference.type === "block") {
      const conn = await getDb();
      const row = (await conn("blocks")
        .join("chapters", "blocks.chapter_id", "chapters.id")
        .leftJoin("block_swipes", "blocks.current_swipe_id", "block_swipes.id")
        .where({ "blocks.id": reference.id, "chapters.project_id": projectId })
        .select(
          "blocks.id",
          "blocks.type",
          "blocks.synopsis",
          "blocks.sort_order",
          "chapters.id as chapter_id",
          "chapters.title as chapter_title",
          "block_swipes.content",
        )
        .first()) as Row | undefined;
      if (row) {
        const siblings = (await conn("blocks")
          .where({ chapter_id: row.chapter_id, type: row.type })
          .orderBy("sort_order", "asc")
          .select("id")) as Row[];
        const blockNumber = siblings.findIndex((candidate) => candidate.id === row.id) + 1;
        resolved.push({
          type: reference.type,
          id: reference.id,
          label: blockReferenceLabel(row.chapter_title, row.type, blockNumber),
          data: {
            chapterId: row.chapter_id,
            chapterTitle: row.chapter_title,
            blockNumber,
            label:
              row.type === "checkpoint"
                ? `Checkpoint ${String(blockNumber).padStart(2, "0")}`
                : `Text ${String(blockNumber).padStart(2, "0")}`,
            type: row.type,
            synopsis: row.synopsis,
            content: row.content ?? "",
          },
        });
      }
    } else if (reference.type === "entity") {
      const result = await executeAssistantTool(
        projectId,
        scope,
        "get_entity",
        { entityId: reference.id },
        contextId,
      );
      if (!(typeof result.result === "object" && result.result && "error" in result.result))
        resolved.push({
          type: reference.type,
          id: reference.id,
          label: String((result.result as { name?: unknown }).name ?? reference.label),
          data: result.result,
        });
    } else if (reference.type === "relation") {
      const result = await executeAssistantTool(
        projectId,
        scope,
        "get_relation",
        { relationId: reference.id },
        contextId,
      );
      if (!(typeof result.result === "object" && result.result && "error" in result.result))
        resolved.push({
          type: reference.type,
          id: reference.id,
          label: String((result.result as { name?: unknown }).name ?? reference.label),
          data: result.result,
        });
    } else if (reference.type === "attachment") {
      const result = await executeAssistantTool(
        projectId,
        scope,
        "read_attachment",
        { attachmentId: reference.id, maxCharacters: 30000 },
        contextId,
      );
      if (!(typeof result.result === "object" && result.result && "error" in result.result))
        resolved.push({
          type: reference.type,
          id: reference.id,
          label: String((result.result as { name?: unknown }).name ?? reference.label),
          data: result.result,
        });
    }
  }
  return resolved;
}
