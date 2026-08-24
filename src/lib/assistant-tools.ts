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
  | "list_characters"
  | "get_character"
  | "search_characters"
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
    name: "list_characters",
    description:
      "List all existing characters in the current project with IDs, names, and descriptions.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_character",
    description: "Read one existing character by its exact character ID.",
    parameters: {
      type: "object",
      properties: { characterId: { type: "string" } },
      required: ["characterId"],
      additionalProperties: false,
    },
  },
  {
    name: "search_characters",
    description: "Search existing character names and descriptions in the current project.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
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

    if (toolName === "list_characters") {
      const rows = (await conn("characters")
        .where({ project_id: projectId })
        .orderBy("created_at", "asc")) as Row[];
      return {
        toolName,
        label: t("characterList", { count: rows.length }),
        result: rows.map((row) => ({ id: row.id, name: row.name, description: row.description })),
      };
    }

    if (toolName === "get_character") {
      const characterId = idSchema.parse(args.characterId);
      const row = (await conn("characters")
        .where({ id: characterId, project_id: projectId })
        .first()) as Row | undefined;
      if (!row) throw new ApiError("characterNotFound", 404);
      return {
        toolName,
        label: t("character", { name: String(row.name) }),
        result: { id: row.id, name: row.name, description: row.description },
      };
    }

    if (toolName === "search_characters") {
      const query = z.string().trim().min(1).max(200).parse(args.query);
      const rows = (await conn("characters")
        .where({ project_id: projectId })
        .andWhere((builder) =>
          builder.where("name", "like", `%${query}%`).orWhere("description", "like", `%${query}%`),
        )
        .orderBy("created_at", "asc")
        .limit(20)) as Row[];
      return {
        toolName,
        label: t("searchCharacters", { query, count: rows.length }),
        result: rows.map((row) => ({ id: row.id, name: row.name, description: row.description })),
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
  const normalized = query.trim().toLocaleLowerCase();
  const matches = (value: unknown) =>
    !normalized ||
    String(value ?? "")
      .toLocaleLowerCase()
      .includes(normalized);
  const [chapters, blocks, characters, conversation] = await Promise.all([
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
    conn("characters").where({ project_id: projectId }).orderBy("created_at", "asc") as Promise<
      Row[]
    >,
    ensureToolConversation(projectId, scope, contextId),
  ]);
  const attachments = (await conn("assistant_attachments")
    .where({ conversation_id: conversation.id })
    .orderBy("created_at", "asc")) as Row[];
  return [
    ...chapters
      .filter((row) => matches(row.title) || matches(row.synopsis))
      .map((row) => ({
        type: "chapter" as const,
        id: String(row.id),
        label: String(row.title),
        description: t("chapter"),
      })),
    ...characters
      .filter((row) => matches(row.name) || matches(row.description))
      .map((row) => ({
        type: "character" as const,
        id: String(row.id),
        label: String(row.name),
        description: t("character"),
      })),
    ...attachments
      .filter((row) => matches(row.name))
      .map((row) => ({
        type: "attachment" as const,
        id: String(row.id),
        label: String(row.name),
        description: t("attachment"),
      })),
    ...blocks
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
      .filter((row) => matches(row.label) || matches(row.description)),
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
    } else if (reference.type === "character") {
      const result = await executeAssistantTool(
        projectId,
        scope,
        "get_character",
        { characterId: reference.id },
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
