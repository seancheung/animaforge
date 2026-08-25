import type { Knex } from "knex";
import { z } from "zod";
import { ApiError } from "@/lib/api";
import { mapProject } from "@/lib/data";
import { getDb, newId, parseJson } from "@/lib/db";
import {
  allProjectTransferSections,
  hasProjectTransferSelection,
  normalizeProjectTransferSelection,
  type ProjectTransferSelection,
} from "@/lib/project-transfer-selection";
import type { Project, TaskType } from "@/lib/types";

const idSchema = z.string().min(1).max(160);
const systemKeySchema = z.enum(["character", "location", "item", "organization", "rule", "other"]);
const systemKeys = systemKeySchema.options;

const styleFingerprintSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(500),
  config: z.string().min(1).max(500_000),
});

const customEntityTypeSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(500),
  description: z.string().max(100_000),
  sortOrder: z.number().int().min(0),
});

const entityTypeReferenceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("system"), systemKey: systemKeySchema }),
  z.object({ kind: z.literal("custom"), customTypeId: idSchema }),
]);

const entitySchema = z.object({
  id: idSchema,
  type: entityTypeReferenceSchema,
  name: z.string().min(1).max(500),
  description: z.string().max(500_000),
  alwaysInclude: z.boolean(),
});

const relationSchema = z.object({
  id: idSchema,
  sourceEntityId: idSchema,
  targetEntityId: idSchema,
  name: z.string().min(1).max(500),
  description: z.string().max(500_000),
  alwaysInclude: z.boolean(),
});

const swipeSchema = z.object({
  id: idSchema,
  content: z.string().max(5_000_000),
});

const blockSchema = z.object({
  id: idSchema,
  type: z.enum(["text", "checkpoint"]),
  synopsis: z.string().max(500_000),
  sortOrder: z.number().int().min(0),
  content: z.string().max(5_000_000).nullable(),
  currentSwipeId: idSchema.nullable(),
  stale: z.boolean(),
  swipes: z.array(swipeSchema).max(500),
});

const chapterSchema = z.object({
  id: idSchema,
  title: z.string().min(1).max(500),
  synopsis: z.string().max(500_000),
  sortOrder: z.number().int().min(0),
  entityMode: z.enum(["all", "selected"]),
  entityIds: z.array(idSchema).max(20_000),
  blocks: z.array(blockSchema).max(5_000),
});

const chatContextSchema = z.object({
  includeStorySynopsis: z.boolean(),
  chapterIds: z.array(idSchema).max(10_000),
  entityIds: z.array(idSchema).max(20_000),
  preferChapterSynopsis: z.boolean(),
  allowCharacterMentions: z.boolean(),
});

const chatMessageSchema = z.object({
  id: idSchema,
  role: z.enum(["author", "character"]),
  speakerEntityId: idSchema.nullable(),
  content: z.string().max(5_000_000),
});

const chatSessionSchema = z.object({
  id: idSchema,
  sortOrder: z.number().int().min(0),
  messages: z.array(chatMessageSchema).max(100_000),
});

const chatSchema = z.object({
  id: idSchema,
  userEntityId: idSchema.nullable(),
  memberEntityIds: z.array(idSchema).min(1).max(100),
  contextSettings: chatContextSchema,
  sessions: z.array(chatSessionSchema).min(1).max(10_000),
});

const completedReviewSchema = z.object({
  id: idSchema,
  reviewerId: z.string().min(1).max(160),
  reviewerName: z.string().min(1).max(500),
  reviewerPrompt: z.string().min(1).max(100_000),
  modelId: idSchema.nullable(),
  chapterId: idSchema.nullable(),
  chapterTitle: z.string().max(500).nullable(),
  content: z.string().min(1).max(5_000_000),
});

const revisionSourceChapterSchema = z.object({
  id: idSchema,
  sourceChapterId: idSchema,
  title: z.string().min(1).max(500),
  sortOrder: z.number().int().min(0),
  sourceContent: z.string().max(5_000_000),
});

const revisionBlueprintSchema = z.object({
  id: idSchema,
  version: z.number().int().min(1),
  modelId: idSchema,
  requirements: z.string().max(500_000),
  content: z.string().max(5_000_000),
});

const revisionWindowSchema = z.object({
  id: idSchema,
  sourceChapterSnapshotId: idSchema,
  sourceChapterNumber: z.number().int().min(1),
  sourceChapterTitle: z.string().min(1).max(500),
  chapterWindowIndex: z.number().int().min(0),
  chapterWindowCount: z.number().int().min(1),
  documentWindowIndex: z.number().int().min(0),
  documentWindowCount: z.number().int().min(1),
  mode: z.enum(["copy", "generate"]),
  sourceContent: z.string().max(5_000_000),
  outputContent: z.string().max(5_000_000),
});

const completedRevisionSchema = z.object({
  id: idSchema,
  reviewId: idSchema.nullable(),
  sourceType: z.enum(["review", "style", "custom"]),
  name: z.string().min(1).max(500),
  sourceProjectName: z.string().min(1).max(500),
  reviewerName: z.string().max(500),
  scopeChapterId: idSchema.nullable(),
  scopeChapterTitle: z.string().max(500).nullable(),
  reviewContent: z.string().max(5_000_000),
  requirements: z.string().max(500_000),
  styleFingerprintId: idSchema.nullable(),
  styleFingerprintName: z.string().max(500),
  styleFingerprintConfig: z.string().max(500_000),
  planModelId: idSchema.nullable(),
  executionModelId: idSchema.nullable(),
  windowTokenLimit: z.number().int().positive().nullable(),
  executionWindowTokens: z.number().int().positive().nullable(),
  resultMarkdown: z.string().max(20_000_000),
  sourceChapters: z.array(revisionSourceChapterSchema).min(1).max(10_000),
  activeBlueprint: revisionBlueprintSchema.nullable(),
  windows: z.array(revisionWindowSchema).max(100_000),
});

const transferSelectionSchema = z.object({
  settings: z.boolean(),
  entities: z.boolean(),
  reviews: z.boolean(),
  revisions: z.boolean(),
  chapterOutlines: z.boolean(),
  manuscript: z.boolean(),
  manuscriptHistory: z.boolean(),
  chats: z.boolean(),
  assistant: z.boolean(),
});

const assistantReferenceSchema = z.object({
  id: idSchema,
  resourceType: z.enum(["project", "chapter", "block", "entity", "relation", "attachment"]),
  resourceId: idSchema,
  label: z.string().max(500),
  sortOrder: z.number().int().min(0),
});

const assistantActivitySchema = z.object({
  id: idSchema,
  toolName: z.string().max(500),
  label: z.string().max(500),
  sortOrder: z.number().int().min(0),
});

const assistantProposalItemSchema = z.object({
  id: idSchema,
  action: z.string().min(1).max(160),
  label: z.string().max(500),
  payload: z.record(z.string(), z.unknown()),
  decision: z.enum(["pending", "accepted", "rejected", "superseded"]),
  appliedEntityId: idSchema.nullable(),
  supersedesItemId: idSchema.nullable(),
  sortOrder: z.number().int().min(0),
  updatedAt: z.string().max(100),
});

const assistantProposalSchema = z.object({
  id: idSchema,
  title: z.string().max(500),
  description: z.string().max(100_000),
  supersedesProposalId: idSchema.nullable(),
  createdAt: z.string().max(100),
  items: z.array(assistantProposalItemSchema).max(100_000),
});

const assistantMessageSchema = z.object({
  id: idSchema,
  role: z.enum(["user", "assistant"]),
  content: z.string().max(5_000_000),
  scope: z.enum(["project", "chapter"]),
  createdAt: z.string().max(100),
  proposals: z.array(assistantProposalSchema).max(100_000),
  references: z.array(assistantReferenceSchema).max(100_000),
  activities: z.array(assistantActivitySchema).max(100_000),
});

const assistantAttachmentSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(500),
  mimeType: z.string().max(500),
  sizeBytes: z.number().int().min(0),
  content: z.string().max(20_000_000),
  createdAt: z.string().max(100),
});

const assistantConversationSchema = z.object({
  id: idSchema,
  scope: z.enum(["project", "chapter"]),
  contextId: idSchema.nullable(),
  createdAt: z.string().max(100),
  updatedAt: z.string().max(100),
  messages: z.array(assistantMessageSchema).max(100_000),
  attachments: z.array(assistantAttachmentSchema).max(10_000),
});

export const projectTransferSchema = z.object({
  kind: z.literal("anima-forge-project"),
  version: z.literal(1),
  exportedAt: z.string().max(100),
  selection: transferSelectionSchema,
  project: z.object({
    sourceId: idSchema,
    name: z.string().min(1).max(500),
    synopsis: z.string().max(500_000),
    proseStyle: z.string().max(500_000),
    styleFingerprint: styleFingerprintSchema.nullable(),
    language: z.string().max(120),
    modelOverrides: z.record(z.string().max(80), idSchema.nullable()),
    customEntityTypes: z.array(customEntityTypeSchema).max(500),
    entities: z.array(entitySchema).max(20_000),
    relations: z.array(relationSchema).max(50_000),
    chapters: z.array(chapterSchema).max(10_000),
    chats: z.array(chatSchema).max(10_000),
    completedReviews: z.array(completedReviewSchema).max(10_000),
    completedRevisions: z.array(completedRevisionSchema).max(10_000),
    assistantConversations: z.array(assistantConversationSchema).max(20_000),
  }),
});

export type ProjectTransferDocument = z.infer<typeof projectTransferSchema>;

type Row = Record<string, unknown>;

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? [
        ...new Set(
          value.filter((item): item is string => typeof item === "string" && Boolean(item)),
        ),
      ]
    : [];
}

function exportedChatContext(value: unknown) {
  const context = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    includeStorySynopsis: context.includeStorySynopsis !== false,
    chapterIds: stringArray(context.chapterIds),
    entityIds: stringArray(context.entityIds),
    preferChapterSynopsis: context.preferChapterSynopsis !== false,
    allowCharacterMentions: context.allowCharacterMentions === true,
  };
}

function assertUnique(values: string[]) {
  if (new Set(values).size !== values.length) throw new ApiError("invalidProjectImport");
}

function validateReferences(document: ProjectTransferDocument) {
  const project = document.project;
  if (
    (document.selection.chats && !document.selection.entities) ||
    (document.selection.manuscriptHistory && !document.selection.manuscript)
  ) {
    throw new ApiError("invalidProjectImport");
  }
  const customTypeIds = new Set(project.customEntityTypes.map((type) => type.id));
  const entityIds = new Set(project.entities.map((entity) => entity.id));
  const chapterIds = new Set(project.chapters.map((chapter) => chapter.id));
  const characterIds = new Set(
    project.entities
      .filter((entity) => entity.type.kind === "system" && entity.type.systemKey === "character")
      .map((entity) => entity.id),
  );
  const blockIds = project.chapters.flatMap((chapter) => chapter.blocks.map((block) => block.id));
  const swipeIds = project.chapters.flatMap((chapter) =>
    chapter.blocks.flatMap((block) => block.swipes.map((swipe) => swipe.id)),
  );
  const reviewIds = new Set(project.completedReviews.map((review) => review.id));
  const sessionIds = project.chats.flatMap((chat) => chat.sessions.map((session) => session.id));
  const messageIds = project.chats.flatMap((chat) =>
    chat.sessions.flatMap((session) => session.messages.map((message) => message.id)),
  );
  const sourceSnapshotIds = project.completedRevisions.flatMap((revision) =>
    revision.sourceChapters.map((chapter) => chapter.id),
  );
  const blueprintIds = project.completedRevisions.flatMap((revision) =>
    revision.activeBlueprint ? [revision.activeBlueprint.id] : [],
  );
  const windowIds = project.completedRevisions.flatMap((revision) =>
    revision.windows.map((window) => window.id),
  );
  const assistantMessageIds = project.assistantConversations.flatMap((conversation) =>
    conversation.messages.map((message) => message.id),
  );
  const assistantProposalIds = project.assistantConversations.flatMap((conversation) =>
    conversation.messages.flatMap((message) => message.proposals.map((proposal) => proposal.id)),
  );
  const assistantItemIds = project.assistantConversations.flatMap((conversation) =>
    conversation.messages.flatMap((message) =>
      message.proposals.flatMap((proposal) => proposal.items.map((item) => item.id)),
    ),
  );
  const assistantAttachmentIds = project.assistantConversations.flatMap((conversation) =>
    conversation.attachments.map((attachment) => attachment.id),
  );

  assertUnique(project.customEntityTypes.map((type) => type.id));
  assertUnique(project.customEntityTypes.map((type) => type.name));
  assertUnique(project.entities.map((entity) => entity.id));
  assertUnique(project.relations.map((relation) => relation.id));
  assertUnique(project.chapters.map((chapter) => chapter.id));
  assertUnique(blockIds);
  assertUnique(swipeIds);
  assertUnique(project.chats.map((chat) => chat.id));
  assertUnique(sessionIds);
  assertUnique(messageIds);
  assertUnique([...reviewIds]);
  assertUnique(project.completedRevisions.map((revision) => revision.id));
  assertUnique(sourceSnapshotIds);
  assertUnique(blueprintIds);
  assertUnique(windowIds);
  assertUnique(project.assistantConversations.map((conversation) => conversation.id));
  assertUnique(assistantMessageIds);
  assertUnique(assistantProposalIds);
  assertUnique(assistantItemIds);
  assertUnique(assistantAttachmentIds);

  for (const entity of project.entities) {
    if (entity.type.kind === "custom" && !customTypeIds.has(entity.type.customTypeId)) {
      throw new ApiError("invalidProjectImport");
    }
  }
  for (const relation of project.relations) {
    if (
      relation.sourceEntityId === relation.targetEntityId ||
      !entityIds.has(relation.sourceEntityId) ||
      !entityIds.has(relation.targetEntityId)
    ) {
      throw new ApiError("invalidProjectImport");
    }
  }
  for (const chapter of project.chapters) {
    assertUnique(chapter.entityIds);
    if (chapter.entityIds.some((entityId) => !entityIds.has(entityId))) {
      throw new ApiError("invalidProjectImport");
    }
    for (const block of chapter.blocks) {
      const ownSwipeIds = block.swipes.map((swipe) => swipe.id);
      const currentSwipe = block.currentSwipeId
        ? block.swipes.find((swipe) => swipe.id === block.currentSwipeId)
        : null;
      assertUnique(ownSwipeIds);
      if (
        (ownSwipeIds.length > 0 && !block.currentSwipeId) ||
        (block.currentSwipeId && !ownSwipeIds.includes(block.currentSwipeId)) ||
        (block.type === "checkpoint" &&
          (block.content !== null || block.currentSwipeId !== null || block.swipes.length > 0)) ||
        (!document.selection.manuscript && block.content !== null) ||
        (!document.selection.manuscriptHistory &&
          (block.currentSwipeId !== null || block.swipes.length > 0)) ||
        (currentSwipe && currentSwipe.content !== block.content)
      ) {
        throw new ApiError("invalidProjectImport");
      }
    }
  }
  for (const chat of project.chats) {
    assertUnique(chat.memberEntityIds);
    assertUnique(chat.contextSettings.chapterIds);
    assertUnique(chat.contextSettings.entityIds);
    if (
      chat.memberEntityIds.some((entityId) => !characterIds.has(entityId)) ||
      (chat.userEntityId &&
        (!characterIds.has(chat.userEntityId) || chat.memberEntityIds.includes(chat.userEntityId)))
    ) {
      throw new ApiError("invalidProjectImport");
    }
    for (const session of chat.sessions) {
      for (const message of session.messages) {
        if (message.speakerEntityId && !characterIds.has(message.speakerEntityId)) {
          throw new ApiError("invalidProjectImport");
        }
      }
    }
  }
  for (const revision of project.completedRevisions) {
    if (revision.reviewId && !reviewIds.has(revision.reviewId)) {
      throw new ApiError("invalidProjectImport");
    }
    const revisionSourceIds = new Set(revision.sourceChapters.map((chapter) => chapter.id));
    if (
      (!revision.activeBlueprint && revision.windows.length) ||
      revision.windows.some((window) => !revisionSourceIds.has(window.sourceChapterSnapshotId))
    ) {
      throw new ApiError("invalidProjectImport");
    }
  }
  for (const conversation of project.assistantConversations) {
    if (
      conversation.scope === "chapter" &&
      (!conversation.contextId || !chapterIds.has(conversation.contextId))
    ) {
      throw new ApiError("invalidProjectImport");
    }
    const proposalIds = new Set(
      conversation.messages.flatMap((message) => message.proposals.map((proposal) => proposal.id)),
    );
    const itemIds = new Set(
      conversation.messages.flatMap((message) =>
        message.proposals.flatMap((proposal) => proposal.items.map((item) => item.id)),
      ),
    );
    for (const message of conversation.messages) {
      for (const proposal of message.proposals) {
        if (proposal.supersedesProposalId && !proposalIds.has(proposal.supersedesProposalId)) {
          throw new ApiError("invalidProjectImport");
        }
        for (const item of proposal.items) {
          if (item.supersedesItemId && !itemIds.has(item.supersedesItemId)) {
            throw new ApiError("invalidProjectImport");
          }
        }
      }
    }
  }
}

async function exportAssistantConversations(conn: Knex, projectId: string) {
  const conversationRows = (await conn("assistant_conversations")
    .where({ project_id: projectId })
    .orderBy("created_at", "asc")) as Row[];
  const conversationIds = conversationRows.map((row) => String(row.id));
  const [messageRows, attachmentRows] = conversationIds.length
    ? await Promise.all([
        conn("assistant_messages")
          .whereIn("conversation_id", conversationIds)
          .orderBy("created_at", "asc") as Promise<Row[]>,
        conn("assistant_attachments")
          .whereIn("conversation_id", conversationIds)
          .orderBy("created_at", "asc") as Promise<Row[]>,
      ])
    : [[], []];
  const messageIds = messageRows.map((row) => String(row.id));
  const [proposalRows, referenceRows, activityRows] = messageIds.length
    ? await Promise.all([
        conn("assistant_proposals")
          .whereIn("message_id", messageIds)
          .orderBy("created_at", "asc") as Promise<Row[]>,
        conn("assistant_message_refs")
          .whereIn("message_id", messageIds)
          .orderBy("sort_order", "asc") as Promise<Row[]>,
        conn("assistant_tool_activities")
          .whereIn("message_id", messageIds)
          .orderBy("sort_order", "asc") as Promise<Row[]>,
      ])
    : [[], [], []];
  const proposalIds = proposalRows.map((row) => String(row.id));
  const itemRows = proposalIds.length
    ? ((await conn("assistant_proposal_items")
        .whereIn("proposal_id", proposalIds)
        .orderBy("sort_order", "asc")) as Row[])
    : [];

  return conversationRows.map((conversation) => ({
    id: String(conversation.id),
    scope: conversation.scope === "chapter" ? ("chapter" as const) : ("project" as const),
    contextId:
      conversation.scope === "chapter" && conversation.context_id
        ? String(conversation.context_id)
        : null,
    createdAt: String(conversation.created_at ?? ""),
    updatedAt: String(conversation.updated_at ?? ""),
    messages: messageRows
      .filter((message) => String(message.conversation_id) === String(conversation.id))
      .map((message) => ({
        id: String(message.id),
        role: message.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: String(message.content ?? ""),
        scope: message.scope === "chapter" ? ("chapter" as const) : ("project" as const),
        createdAt: String(message.created_at ?? ""),
        proposals: proposalRows
          .filter((proposal) => String(proposal.message_id) === String(message.id))
          .map((proposal) => ({
            id: String(proposal.id),
            title: String(proposal.title ?? ""),
            description: String(proposal.description ?? ""),
            supersedesProposalId: proposal.supersedes_proposal_id
              ? String(proposal.supersedes_proposal_id)
              : null,
            createdAt: String(proposal.created_at ?? ""),
            items: itemRows
              .filter((item) => String(item.proposal_id) === String(proposal.id))
              .map((item) => ({
                id: String(item.id),
                action: String(item.action),
                label: String(item.label ?? ""),
                payload: parseJson<Record<string, unknown>>(String(item.payload ?? "{}"), {}),
                decision: ["accepted", "rejected", "superseded"].includes(String(item.decision))
                  ? (String(item.decision) as "accepted" | "rejected" | "superseded")
                  : ("pending" as const),
                appliedEntityId: item.applied_entity_id ? String(item.applied_entity_id) : null,
                supersedesItemId: item.supersedes_item_id ? String(item.supersedes_item_id) : null,
                sortOrder: Number(item.sort_order ?? 0),
                updatedAt: String(item.updated_at ?? ""),
              })),
          })),
        references: referenceRows
          .filter((reference) => String(reference.message_id) === String(message.id))
          .map((reference) => ({
            id: String(reference.id),
            resourceType: z
              .enum(["project", "chapter", "block", "entity", "relation", "attachment"])
              .parse(reference.resource_type),
            resourceId: String(reference.resource_id),
            label: String(reference.label ?? ""),
            sortOrder: Number(reference.sort_order ?? 0),
          })),
        activities: activityRows
          .filter((activity) => String(activity.message_id) === String(message.id))
          .map((activity) => ({
            id: String(activity.id),
            toolName: String(activity.tool_name ?? ""),
            label: String(activity.label ?? ""),
            sortOrder: Number(activity.sort_order ?? 0),
          })),
      })),
    attachments: attachmentRows
      .filter((attachment) => String(attachment.conversation_id) === String(conversation.id))
      .map((attachment) => ({
        id: String(attachment.id),
        name: String(attachment.name),
        mimeType: String(attachment.mime_type ?? ""),
        sizeBytes: Number(attachment.size_bytes ?? 0),
        content: String(attachment.content ?? ""),
        createdAt: String(attachment.created_at ?? ""),
      })),
  }));
}

export async function buildProjectTransfer(
  projectId: string,
  requestedSelection: Partial<ProjectTransferSelection> = allProjectTransferSections,
): Promise<ProjectTransferDocument> {
  const selection = normalizeProjectTransferSelection(requestedSelection);
  if (!hasProjectTransferSelection(selection))
    throw new ApiError("projectTransferSelectionRequired");
  const conn = await getDb();
  const projectRow = (await conn("projects").where({ id: projectId }).first()) as Row | undefined;
  if (!projectRow) throw new ApiError("projectNotFound", 404);

  const [fingerprintRow, customTypeRows, entityRows, relationRows, chapterRows] = await Promise.all(
    [
      projectRow.style_fingerprint_id && selection.settings
        ? (conn("style_fingerprints")
            .where({ id: projectRow.style_fingerprint_id })
            .first() as Promise<Row | undefined>)
        : Promise.resolve(undefined),
      conn("entity_types").where({ project_id: projectId }).orderBy("sort_order", "asc") as Promise<
        Row[]
      >,
      conn("entities as entities")
        .join("entity_types as types", "entities.type_id", "types.id")
        .where("entities.project_id", projectId)
        .select("entities.*", "types.project_id as type_project_id", "types.system_key")
        .orderBy("entities.created_at", "asc") as Promise<Row[]>,
      conn("entity_relations")
        .where({ project_id: projectId })
        .orderBy("created_at", "asc") as Promise<Row[]>,
      conn("chapters").where({ project_id: projectId }).orderBy("sort_order", "asc") as Promise<
        Row[]
      >,
    ],
  );

  const chapterIds = chapterRows.map((chapter) => String(chapter.id));
  const [chapterEntityRows, blockRows] = chapterIds.length
    ? await Promise.all([
        conn("chapter_entities").whereIn("chapter_id", chapterIds) as Promise<Row[]>,
        conn("blocks").whereIn("chapter_id", chapterIds).orderBy("sort_order", "asc") as Promise<
          Row[]
        >,
      ])
    : [[], []];
  const blockIds = blockRows.map((block) => String(block.id));
  const swipeRows = blockIds.length
    ? ((await conn("block_swipes")
        .whereIn("block_id", blockIds)
        .orderBy("created_at", "asc")) as Row[])
    : [];
  const [chatRows, completedReviewRows, completedRevisionRows] = await Promise.all([
    conn("character_chats")
      .where({ project_id: projectId })
      .orderBy("created_at", "asc") as Promise<Row[]>,
    conn("project_reviews")
      .where({ project_id: projectId, status: "completed" })
      .orderBy("created_at", "asc") as Promise<Row[]>,
    conn("project_revisions")
      .where({ project_id: projectId, status: "completed" })
      .orderBy("created_at", "asc") as Promise<Row[]>,
  ]);
  const chatIds = chatRows.map((chat) => String(chat.id));
  const [chatMemberRows, chatSessionRows] = chatIds.length
    ? await Promise.all([
        conn("character_chat_members")
          .whereIn("chat_id", chatIds)
          .orderBy("sort_order", "asc") as Promise<Row[]>,
        conn("character_chat_sessions")
          .whereIn("chat_id", chatIds)
          .orderBy("sort_order", "asc") as Promise<Row[]>,
      ])
    : [[], []];
  const sessionIds = chatSessionRows.map((session) => String(session.id));
  const chatMessageRows = sessionIds.length
    ? ((await conn("character_chat_messages")
        .whereIn("session_id", sessionIds)
        .orderBy("created_at", "asc")) as Row[])
    : [];
  const revisionIds = completedRevisionRows.map((revision) => String(revision.id));
  const revisionSourceRows = revisionIds.length
    ? ((await conn("project_revision_source_chapters")
        .whereIn("revision_id", revisionIds)
        .orderBy("sort_order", "asc")) as Row[])
    : [];
  const activeBlueprintIds = completedRevisionRows
    .map((revision) => (revision.active_blueprint_id ? String(revision.active_blueprint_id) : ""))
    .filter(Boolean);
  const revisionBlueprintRows = activeBlueprintIds.length
    ? ((await conn("project_revision_blueprints").whereIn("id", activeBlueprintIds)) as Row[])
    : [];
  const revisionWindowRows = activeBlueprintIds.length
    ? ((await conn("project_revision_windows")
        .whereIn("blueprint_id", activeBlueprintIds)
        .orderBy("document_window_index", "asc")) as Row[])
    : [];
  const assistantConversations = selection.assistant
    ? await exportAssistantConversations(conn, projectId)
    : [];
  const includeChapters = selection.chapterOutlines || selection.manuscript || selection.assistant;

  return {
    kind: "anima-forge-project",
    version: 1,
    exportedAt: new Date().toISOString(),
    selection,
    project: {
      sourceId: String(projectRow.id),
      name: String(projectRow.name),
      synopsis: selection.settings ? String(projectRow.synopsis ?? "") : "",
      proseStyle: selection.settings ? String(projectRow.prose_style ?? "") : "",
      styleFingerprint:
        selection.settings && fingerprintRow
          ? {
              id: String(fingerprintRow.id),
              name: String(fingerprintRow.name),
              config: String(fingerprintRow.config ?? ""),
            }
          : null,
      language: selection.settings ? String(projectRow.language ?? "") : "",
      modelOverrides: selection.settings
        ? parseJson<Partial<Record<TaskType, string | null>>>(
            String(projectRow.model_overrides ?? "{}"),
            {},
          )
        : {},
      customEntityTypes: selection.entities
        ? customTypeRows.map((type) => ({
            id: String(type.id),
            name: String(type.name),
            description: String(type.description ?? ""),
            sortOrder: Number(type.sort_order ?? 0),
          }))
        : [],
      entities: selection.entities
        ? entityRows.map((entity) => ({
            id: String(entity.id),
            type: entity.type_project_id
              ? ({ kind: "custom", customTypeId: String(entity.type_id) } as const)
              : ({ kind: "system", systemKey: systemKeySchema.parse(entity.system_key) } as const),
            name: String(entity.name),
            description: String(entity.description ?? ""),
            alwaysInclude: Boolean(entity.always_include),
          }))
        : [],
      relations: selection.entities
        ? relationRows.map((relation) => ({
            id: String(relation.id),
            sourceEntityId: String(relation.source_entity_id),
            targetEntityId: String(relation.target_entity_id),
            name: String(relation.name),
            description: String(relation.description ?? ""),
            alwaysInclude: Boolean(relation.always_include),
          }))
        : [],
      chapters: includeChapters
        ? chapterRows.map((chapter) => ({
            id: String(chapter.id),
            title: String(chapter.title),
            synopsis: selection.chapterOutlines ? String(chapter.synopsis ?? "") : "",
            sortOrder: Number(chapter.sort_order ?? 0),
            entityMode:
              selection.entities && chapter.entity_mode === "all"
                ? ("all" as const)
                : ("selected" as const),
            entityIds: selection.entities
              ? chapterEntityRows
                  .filter((link) => String(link.chapter_id) === String(chapter.id))
                  .map((link) => String(link.entity_id))
              : [],
            blocks: blockRows
              .filter((block) => String(block.chapter_id) === String(chapter.id))
              .filter(
                (block) =>
                  selection.chapterOutlines ||
                  (selection.manuscript && block.type !== "checkpoint"),
              )
              .map((block) => {
                const blockSwipes = swipeRows.filter(
                  (swipe) => String(swipe.block_id) === String(block.id),
                );
                const currentSwipe = block.current_swipe_id
                  ? blockSwipes.find((swipe) => String(swipe.id) === String(block.current_swipe_id))
                  : undefined;
                return {
                  id: String(block.id),
                  type: block.type === "checkpoint" ? ("checkpoint" as const) : ("text" as const),
                  synopsis: selection.chapterOutlines ? String(block.synopsis ?? "") : "",
                  sortOrder: Number(block.sort_order ?? 0),
                  content:
                    selection.manuscript && block.type !== "checkpoint" && currentSwipe
                      ? String(currentSwipe.content ?? "")
                      : null,
                  currentSwipeId:
                    selection.manuscriptHistory &&
                    block.type !== "checkpoint" &&
                    block.current_swipe_id
                      ? String(block.current_swipe_id)
                      : null,
                  stale: selection.chapterOutlines ? Boolean(block.stale) : false,
                  swipes:
                    selection.manuscriptHistory && block.type !== "checkpoint"
                      ? blockSwipes.map((swipe) => ({
                          id: String(swipe.id),
                          content: String(swipe.content ?? ""),
                        }))
                      : [],
                };
              }),
          }))
        : [],
      chats: selection.chats
        ? chatRows.map((chat) => ({
            id: String(chat.id),
            userEntityId: chat.user_entity_id ? String(chat.user_entity_id) : null,
            memberEntityIds: chatMemberRows
              .filter((member) => String(member.chat_id) === String(chat.id))
              .map((member) => String(member.entity_id)),
            contextSettings: exportedChatContext(
              parseJson<unknown>(String(chat.context_settings ?? "{}"), {}),
            ),
            sessions: chatSessionRows
              .filter((session) => String(session.chat_id) === String(chat.id))
              .map((session) => ({
                id: String(session.id),
                sortOrder: Number(session.sort_order),
                messages: chatMessageRows
                  .filter((message) => String(message.session_id) === String(session.id))
                  .map((message) => ({
                    id: String(message.id),
                    role:
                      message.role === "character" ? ("character" as const) : ("author" as const),
                    speakerEntityId: message.speaker_entity_id
                      ? String(message.speaker_entity_id)
                      : null,
                    content: String(message.content ?? ""),
                  })),
              })),
          }))
        : [],
      completedReviews: selection.reviews
        ? completedReviewRows.map((review) => ({
            id: String(review.id),
            reviewerId: String(review.reviewer_id),
            reviewerName: String(review.reviewer_name),
            reviewerPrompt: String(review.reviewer_prompt),
            modelId: review.model_id ? String(review.model_id) : null,
            chapterId: review.chapter_id ? String(review.chapter_id) : null,
            chapterTitle: review.chapter_title ? String(review.chapter_title) : null,
            content: String(review.content),
          }))
        : [],
      completedRevisions: selection.revisions
        ? completedRevisionRows.map((revision) => {
            const activeBlueprint = revisionBlueprintRows.find(
              (blueprint) => String(blueprint.id) === String(revision.active_blueprint_id),
            );
            return {
              id: String(revision.id),
              reviewId: selection.reviews && revision.review_id ? String(revision.review_id) : null,
              sourceType:
                revision.source_type === "review" || revision.source_type === "style"
                  ? revision.source_type
                  : ("custom" as const),
              name: String(revision.name),
              sourceProjectName: String(revision.source_project_name),
              reviewerName: String(revision.reviewer_name ?? ""),
              scopeChapterId: revision.scope_chapter_id ? String(revision.scope_chapter_id) : null,
              scopeChapterTitle: revision.scope_chapter_title
                ? String(revision.scope_chapter_title)
                : null,
              reviewContent: String(revision.review_content ?? ""),
              requirements: String(revision.requirements ?? ""),
              styleFingerprintId: revision.style_fingerprint_id
                ? String(revision.style_fingerprint_id)
                : null,
              styleFingerprintName: String(revision.style_fingerprint_name ?? ""),
              styleFingerprintConfig: String(revision.style_fingerprint_config ?? ""),
              planModelId: revision.plan_model_id ? String(revision.plan_model_id) : null,
              executionModelId: revision.execution_model_id
                ? String(revision.execution_model_id)
                : null,
              windowTokenLimit:
                revision.window_token_limit == null ? null : Number(revision.window_token_limit),
              executionWindowTokens:
                revision.execution_window_tokens == null
                  ? null
                  : Number(revision.execution_window_tokens),
              resultMarkdown: String(revision.result_markdown ?? ""),
              sourceChapters: revisionSourceRows
                .filter((chapter) => String(chapter.revision_id) === String(revision.id))
                .map((chapter) => ({
                  id: String(chapter.id),
                  sourceChapterId: String(chapter.source_chapter_id),
                  title: String(chapter.title),
                  sortOrder: Number(chapter.sort_order),
                  sourceContent: String(chapter.source_content ?? ""),
                })),
              activeBlueprint: activeBlueprint
                ? {
                    id: String(activeBlueprint.id),
                    version: Number(activeBlueprint.version),
                    modelId: String(activeBlueprint.model_id),
                    requirements: String(activeBlueprint.requirements ?? ""),
                    content: String(activeBlueprint.content ?? ""),
                  }
                : null,
              windows: activeBlueprint
                ? revisionWindowRows
                    .filter(
                      (window) =>
                        String(window.revision_id) === String(revision.id) &&
                        String(window.blueprint_id) === String(activeBlueprint.id),
                    )
                    .map((window) => ({
                      id: String(window.id),
                      sourceChapterSnapshotId: String(window.source_chapter_snapshot_id),
                      sourceChapterNumber: Number(window.source_chapter_number),
                      sourceChapterTitle: String(window.source_chapter_title),
                      chapterWindowIndex: Number(window.chapter_window_index),
                      chapterWindowCount: Number(window.chapter_window_count),
                      documentWindowIndex: Number(window.document_window_index),
                      documentWindowCount: Number(window.document_window_count),
                      mode: window.mode === "copy" ? ("copy" as const) : ("generate" as const),
                      sourceContent: String(window.source_content ?? ""),
                      outputContent: String(window.output_content ?? ""),
                    }))
                : [],
            };
          })
        : [],
      assistantConversations,
    },
  };
}

async function insertRows(trx: Knex.Transaction, table: string, rows: Record<string, unknown>[]) {
  for (let index = 0; index < rows.length; index += 100) {
    await trx(table).insert(rows.slice(index, index + 100));
  }
}

function remapTransferValue(value: unknown, ids: Map<string, string>): unknown {
  if (typeof value === "string") return ids.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => remapTransferValue(item, ids));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, remapTransferValue(item, ids)]),
    );
  }
  return value;
}

async function importStyleFingerprint(
  trx: Knex.Transaction,
  fingerprint: ProjectTransferDocument["project"]["styleFingerprint"],
) {
  if (!fingerprint) return null;
  const sameContent = await trx("style_fingerprints")
    .where({ name: fingerprint.name, config: fingerprint.config })
    .first();
  if (sameContent) return String(sameContent.id);
  const sameId = await trx("style_fingerprints").where({ id: fingerprint.id }).first();
  const id = sameId ? newId() : fingerprint.id;
  await trx("style_fingerprints").insert({
    id,
    name: fingerprint.name,
    config: fingerprint.config,
  });
  return id;
}

export async function importProjectTransfer(value: unknown) {
  const result = projectTransferSchema.safeParse(value);
  if (!result.success) throw new ApiError("invalidProjectImport");
  const document = result.data;
  validateReferences(document);

  const conn = await getDb();
  const projectId = newId();
  await conn.transaction(async (trx) => {
    const fingerprintId = await importStyleFingerprint(trx, document.project.styleFingerprint);
    await trx("projects").insert({
      id: projectId,
      name: document.project.name,
      synopsis: document.project.synopsis,
      prose_style: document.project.proseStyle,
      style_fingerprint_id: fingerprintId,
      language: document.project.language,
      model_overrides: JSON.stringify(document.project.modelOverrides),
    });

    const systemTypeRows = (await trx("entity_types")
      .whereIn("system_key", systemKeys)
      .select("id", "system_key")) as Row[];
    const systemTypeIds = new Map(
      systemTypeRows.map((type) => [String(type.system_key), String(type.id)]),
    );
    if (systemKeys.some((key) => !systemTypeIds.has(key))) {
      throw new ApiError("invalidProjectImport");
    }

    const customTypeIds = new Map(
      document.project.customEntityTypes.map((type) => [type.id, newId()]),
    );
    await insertRows(
      trx,
      "entity_types",
      document.project.customEntityTypes.map((type) => ({
        id: customTypeIds.get(type.id),
        project_id: projectId,
        system_key: null,
        name: type.name,
        description: type.description,
        sort_order: type.sortOrder,
      })),
    );

    const entityIds = new Map(document.project.entities.map((entity) => [entity.id, newId()]));
    await insertRows(
      trx,
      "entities",
      document.project.entities.map((entity) => ({
        id: entityIds.get(entity.id),
        project_id: projectId,
        type_id:
          entity.type.kind === "system"
            ? systemTypeIds.get(entity.type.systemKey)
            : customTypeIds.get(entity.type.customTypeId),
        name: entity.name,
        description: entity.description,
        always_include: entity.alwaysInclude ? 1 : 0,
      })),
    );

    const relationIds = new Map(
      document.project.relations.map((relation) => [relation.id, newId()]),
    );
    await insertRows(
      trx,
      "entity_relations",
      document.project.relations.map((relation) => ({
        id: relationIds.get(relation.id),
        project_id: projectId,
        source_entity_id: entityIds.get(relation.sourceEntityId),
        target_entity_id: entityIds.get(relation.targetEntityId),
        name: relation.name,
        description: relation.description,
        always_include: relation.alwaysInclude ? 1 : 0,
      })),
    );

    const chapterIds = new Map(document.project.chapters.map((chapter) => [chapter.id, newId()]));
    await insertRows(
      trx,
      "chapters",
      document.project.chapters.map((chapter) => ({
        id: chapterIds.get(chapter.id),
        project_id: projectId,
        title: chapter.title,
        synopsis: chapter.synopsis,
        sort_order: chapter.sortOrder,
        entity_mode: chapter.entityMode,
      })),
    );

    const blockRows: Record<string, unknown>[] = [];
    const swipeRows: Record<string, unknown>[] = [];
    const chapterEntityRows: Record<string, unknown>[] = [];
    const blockIds = new Map<string, string>();
    const importedSwipeIds = new Map<string, string>();
    let swipeOrder = 0;
    for (const chapter of document.project.chapters) {
      const importedChapterId = chapterIds.get(chapter.id);
      for (const entityId of chapter.entityIds) {
        const importedEntityId = entityIds.get(entityId);
        if (!importedEntityId) continue;
        chapterEntityRows.push({
          chapter_id: importedChapterId,
          entity_id: importedEntityId,
        });
      }
      for (const block of chapter.blocks) {
        const importedBlockId = newId();
        const swipeIds = new Map(block.swipes.map((swipe) => [swipe.id, newId()]));
        const contentSwipeId = block.swipes.length === 0 && block.content !== null ? newId() : null;
        blockIds.set(block.id, importedBlockId);
        for (const [sourceId, importedId] of swipeIds) importedSwipeIds.set(sourceId, importedId);
        blockRows.push({
          id: importedBlockId,
          chapter_id: importedChapterId,
          type: block.type,
          synopsis: block.synopsis,
          sort_order: block.sortOrder,
          current_swipe_id: block.currentSwipeId
            ? swipeIds.get(block.currentSwipeId)
            : contentSwipeId,
          stale: block.stale ? 1 : 0,
        });
        for (const swipe of block.swipes) {
          swipeRows.push({
            id: swipeIds.get(swipe.id),
            block_id: importedBlockId,
            content: swipe.content,
            created_at: new Date(Date.now() + swipeOrder).toISOString(),
          });
          swipeOrder += 1;
        }
        if (contentSwipeId !== null) {
          swipeRows.push({
            id: contentSwipeId,
            block_id: importedBlockId,
            content: block.content,
            created_at: new Date(Date.now() + swipeOrder).toISOString(),
          });
          swipeOrder += 1;
        }
      }
    }
    await insertRows(trx, "blocks", blockRows);
    await insertRows(trx, "block_swipes", swipeRows);
    await insertRows(trx, "chapter_entities", chapterEntityRows);

    const importedAt = Date.now();
    const chatRows: Record<string, unknown>[] = [];
    const chatMemberRows: Record<string, unknown>[] = [];
    const chatSessionRows: Record<string, unknown>[] = [];
    const chatMessageRows: Record<string, unknown>[] = [];
    let messageOrder = 0;
    for (const chat of document.project.chats) {
      const chatId = newId();
      const memberIds = chat.memberEntityIds.map((entityId) => entityIds.get(entityId)!);
      const userEntityId = chat.userEntityId ? entityIds.get(chat.userEntityId)! : null;
      const contextEntityIds = [
        ...new Set([
          ...chat.contextSettings.entityIds,
          ...chat.memberEntityIds,
          ...(chat.userEntityId ? [chat.userEntityId] : []),
        ]),
      ].flatMap((entityId) => {
        const importedId = entityIds.get(entityId);
        return importedId ? [importedId] : [];
      });
      chatRows.push({
        id: chatId,
        project_id: projectId,
        user_entity_id: userEntityId,
        member_key: [...memberIds].sort().join(":"),
        context_settings: JSON.stringify({
          ...chat.contextSettings,
          chapterIds: chat.contextSettings.chapterIds.flatMap((chapterId) => {
            const importedId = chapterIds.get(chapterId);
            return importedId ? [importedId] : [];
          }),
          entityIds: contextEntityIds,
        }),
      });
      chat.memberEntityIds.forEach((entityId, index) => {
        chatMemberRows.push({
          chat_id: chatId,
          entity_id: entityIds.get(entityId),
          sort_order: index,
        });
      });
      for (const session of chat.sessions) {
        const sessionId = newId();
        chatSessionRows.push({
          id: sessionId,
          chat_id: chatId,
          sort_order: session.sortOrder,
        });
        for (const message of session.messages) {
          chatMessageRows.push({
            id: newId(),
            session_id: sessionId,
            role: message.role,
            speaker_entity_id: message.speakerEntityId
              ? entityIds.get(message.speakerEntityId)
              : null,
            content: message.content,
            created_at: new Date(importedAt + messageOrder).toISOString(),
          });
          messageOrder += 1;
        }
      }
    }
    await insertRows(trx, "character_chats", chatRows);
    await insertRows(trx, "character_chat_members", chatMemberRows);
    await insertRows(trx, "character_chat_sessions", chatSessionRows);
    await insertRows(trx, "character_chat_messages", chatMessageRows);

    const historicalChapterIds = new Map(chapterIds);
    const historicalChapterId = (sourceId: string | null) => {
      if (!sourceId) return null;
      const existing = historicalChapterIds.get(sourceId);
      if (existing) return existing;
      const id = newId();
      historicalChapterIds.set(sourceId, id);
      return id;
    };
    const reviewIds = new Map(
      document.project.completedReviews.map((review) => [review.id, newId()]),
    );
    await insertRows(
      trx,
      "project_reviews",
      document.project.completedReviews.map((review, index) => ({
        id: reviewIds.get(review.id),
        project_id: projectId,
        reviewer_id: review.reviewerId,
        reviewer_name: review.reviewerName,
        reviewer_prompt: review.reviewerPrompt,
        model_id: review.modelId,
        chapter_id: historicalChapterId(review.chapterId),
        chapter_title: review.chapterTitle,
        content: review.content,
        status: "completed",
        created_at: new Date(importedAt + index).toISOString(),
        updated_at: new Date(importedAt + index).toISOString(),
      })),
    );

    const revisionRows: Record<string, unknown>[] = [];
    const revisionSourceRows: Record<string, unknown>[] = [];
    const revisionBlueprintRows: Record<string, unknown>[] = [];
    const revisionWindowRows: Record<string, unknown>[] = [];
    const importedRevisionIds = new Map<string, string>();
    for (const [revisionIndex, revision] of document.project.completedRevisions.entries()) {
      const revisionId = newId();
      importedRevisionIds.set(revision.id, revisionId);
      const blueprintId = revision.activeBlueprint ? newId() : null;
      const sourceChapterIds = new Map(
        revision.sourceChapters.map((chapter) => [chapter.id, newId()]),
      );
      const timestamp = new Date(importedAt + revisionIndex).toISOString();
      revisionRows.push({
        id: revisionId,
        project_id: projectId,
        source_type: revision.sourceType,
        style_fingerprint_id:
          revision.styleFingerprintId &&
          revision.styleFingerprintId === document.project.styleFingerprint?.id
            ? fingerprintId
            : null,
        style_fingerprint_name: revision.styleFingerprintName,
        style_fingerprint_config: revision.styleFingerprintConfig,
        review_id: revision.reviewId ? reviewIds.get(revision.reviewId) : null,
        name: revision.name,
        source_project_name: revision.sourceProjectName,
        reviewer_name: revision.reviewerName,
        scope_chapter_id: historicalChapterId(revision.scopeChapterId),
        scope_chapter_title: revision.scopeChapterTitle,
        review_content: revision.reviewContent,
        requirements: revision.requirements,
        plan_model_id: revision.planModelId,
        execution_model_id: revision.executionModelId,
        active_blueprint_id: blueprintId,
        result_markdown: revision.resultMarkdown,
        status: "completed",
        window_token_limit: revision.windowTokenLimit,
        execution_window_tokens: revision.executionWindowTokens,
        created_at: timestamp,
        updated_at: timestamp,
      });
      for (const chapter of revision.sourceChapters) {
        revisionSourceRows.push({
          id: sourceChapterIds.get(chapter.id),
          revision_id: revisionId,
          source_chapter_id: historicalChapterId(chapter.sourceChapterId),
          title: chapter.title,
          sort_order: chapter.sortOrder,
          source_content: chapter.sourceContent,
        });
      }
      if (revision.activeBlueprint && blueprintId) {
        revisionBlueprintRows.push({
          id: blueprintId,
          revision_id: revisionId,
          version: revision.activeBlueprint.version,
          model_id: revision.activeBlueprint.modelId,
          requirements: revision.activeBlueprint.requirements,
          content: revision.activeBlueprint.content,
          status: "completed",
          created_at: timestamp,
          updated_at: timestamp,
        });
        for (const window of revision.windows) {
          revisionWindowRows.push({
            id: newId(),
            revision_id: revisionId,
            blueprint_id: blueprintId,
            source_chapter_snapshot_id: sourceChapterIds.get(window.sourceChapterSnapshotId),
            source_chapter_number: window.sourceChapterNumber,
            source_chapter_title: window.sourceChapterTitle,
            chapter_window_index: window.chapterWindowIndex,
            chapter_window_count: window.chapterWindowCount,
            document_window_index: window.documentWindowIndex,
            document_window_count: window.documentWindowCount,
            mode: window.mode,
            source_content: window.sourceContent,
            output_content: window.outputContent,
            status: "completed",
            updated_at: timestamp,
          });
        }
      }
    }
    await insertRows(trx, "project_revisions", revisionRows);
    await insertRows(trx, "project_revision_source_chapters", revisionSourceRows);
    await insertRows(trx, "project_revision_blueprints", revisionBlueprintRows);
    await insertRows(trx, "project_revision_windows", revisionWindowRows);

    const assistantConversationIds = new Map(
      document.project.assistantConversations.map((conversation) => [conversation.id, newId()]),
    );
    const assistantMessageIds = new Map(
      document.project.assistantConversations.flatMap((conversation) =>
        conversation.messages.map((message) => [message.id, newId()] as const),
      ),
    );
    const assistantProposalIds = new Map(
      document.project.assistantConversations.flatMap((conversation) =>
        conversation.messages.flatMap((message) =>
          message.proposals.map((proposal) => [proposal.id, newId()] as const),
        ),
      ),
    );
    const assistantItemIds = new Map(
      document.project.assistantConversations.flatMap((conversation) =>
        conversation.messages.flatMap((message) =>
          message.proposals.flatMap((proposal) =>
            proposal.items.map((item) => [item.id, newId()] as const),
          ),
        ),
      ),
    );
    const assistantAttachmentIds = new Map(
      document.project.assistantConversations.flatMap((conversation) =>
        conversation.attachments.map((attachment) => [attachment.id, newId()] as const),
      ),
    );
    const transferIds = new Map<string, string>([
      [document.project.sourceId, projectId],
      ...entityIds,
      ...relationIds,
      ...chapterIds,
      ...blockIds,
      ...importedSwipeIds,
      ...reviewIds,
      ...importedRevisionIds,
      ...assistantConversationIds,
      ...assistantMessageIds,
      ...assistantProposalIds,
      ...assistantItemIds,
      ...assistantAttachmentIds,
    ]);
    const assistantConversationRows: Record<string, unknown>[] = [];
    const assistantMessageRows: Record<string, unknown>[] = [];
    const assistantProposalRows: Record<string, unknown>[] = [];
    const assistantItemRows: Record<string, unknown>[] = [];
    const assistantAttachmentRows: Record<string, unknown>[] = [];
    const assistantReferenceRows: Record<string, unknown>[] = [];
    const assistantActivityRows: Record<string, unknown>[] = [];
    const proposalSupersedes: Array<[string, string]> = [];
    const itemSupersedes: Array<[string, string]> = [];
    const resourceId = (
      type: ProjectTransferDocument["project"]["assistantConversations"][number]["messages"][number]["references"][number]["resourceType"],
      sourceId: string,
    ) => {
      if (type === "project") return projectId;
      if (type === "chapter") return chapterIds.get(sourceId) ?? null;
      if (type === "block") return blockIds.get(sourceId) ?? null;
      if (type === "entity") return entityIds.get(sourceId) ?? null;
      if (type === "relation") return relationIds.get(sourceId) ?? null;
      return assistantAttachmentIds.get(sourceId) ?? null;
    };

    for (const conversation of document.project.assistantConversations) {
      const conversationId = assistantConversationIds.get(conversation.id)!;
      const contextId =
        conversation.scope === "chapter" && conversation.contextId
          ? chapterIds.get(conversation.contextId)
          : null;
      if (conversation.scope === "chapter" && !contextId) continue;
      assistantConversationRows.push({
        id: conversationId,
        project_id: projectId,
        scope: conversation.scope,
        context_id: contextId ?? "",
        created_at: conversation.createdAt,
        updated_at: conversation.updatedAt,
      });
      for (const attachment of conversation.attachments) {
        assistantAttachmentRows.push({
          id: assistantAttachmentIds.get(attachment.id),
          conversation_id: conversationId,
          name: attachment.name,
          mime_type: attachment.mimeType,
          size_bytes: attachment.sizeBytes,
          content: attachment.content,
          created_at: attachment.createdAt,
        });
      }
      for (const message of conversation.messages) {
        const messageId = assistantMessageIds.get(message.id)!;
        assistantMessageRows.push({
          id: messageId,
          conversation_id: conversationId,
          role: message.role,
          content: message.content,
          scope: message.scope,
          created_at: message.createdAt,
        });
        for (const proposal of message.proposals) {
          const proposalId = assistantProposalIds.get(proposal.id)!;
          assistantProposalRows.push({
            id: proposalId,
            message_id: messageId,
            title: proposal.title,
            description: proposal.description,
            supersedes_proposal_id: null,
            created_at: proposal.createdAt,
          });
          if (proposal.supersedesProposalId) {
            const supersededId = assistantProposalIds.get(proposal.supersedesProposalId);
            if (supersededId) proposalSupersedes.push([proposalId, supersededId]);
          }
          for (const item of proposal.items) {
            const itemId = assistantItemIds.get(item.id)!;
            assistantItemRows.push({
              id: itemId,
              proposal_id: proposalId,
              action: item.action,
              label: item.label,
              payload: JSON.stringify(remapTransferValue(item.payload, transferIds)),
              decision: item.decision,
              applied_entity_id: item.appliedEntityId
                ? (entityIds.get(item.appliedEntityId) ?? null)
                : null,
              supersedes_item_id: null,
              sort_order: item.sortOrder,
              updated_at: item.updatedAt,
            });
            if (item.supersedesItemId) {
              const supersededId = assistantItemIds.get(item.supersedesItemId);
              if (supersededId) itemSupersedes.push([itemId, supersededId]);
            }
          }
        }
        for (const reference of message.references) {
          const importedResourceId = resourceId(reference.resourceType, reference.resourceId);
          if (!importedResourceId) continue;
          assistantReferenceRows.push({
            id: newId(),
            message_id: messageId,
            resource_type: reference.resourceType,
            resource_id: importedResourceId,
            label: reference.label,
            sort_order: reference.sortOrder,
          });
        }
        for (const activity of message.activities) {
          assistantActivityRows.push({
            id: newId(),
            message_id: messageId,
            tool_name: activity.toolName,
            label: activity.label,
            sort_order: activity.sortOrder,
          });
        }
      }
    }
    await insertRows(trx, "assistant_conversations", assistantConversationRows);
    await insertRows(trx, "assistant_messages", assistantMessageRows);
    await insertRows(trx, "assistant_proposals", assistantProposalRows);
    await insertRows(trx, "assistant_proposal_items", assistantItemRows);
    await insertRows(trx, "assistant_attachments", assistantAttachmentRows);
    await insertRows(trx, "assistant_message_refs", assistantReferenceRows);
    await insertRows(trx, "assistant_tool_activities", assistantActivityRows);
    for (const [id, supersedesId] of proposalSupersedes) {
      await trx("assistant_proposals")
        .where({ id })
        .update({ supersedes_proposal_id: supersedesId });
    }
    for (const [id, supersedesId] of itemSupersedes) {
      await trx("assistant_proposal_items")
        .where({ id })
        .update({ supersedes_item_id: supersedesId });
    }
  });

  const projectRow = (await conn("projects").where({ id: projectId }).first()) as Row;
  return {
    project: mapProject(projectRow) satisfies Project,
    summary: {
      chapters: document.project.chapters.length,
      entities: document.project.entities.length,
      relations: document.project.relations.length,
      blocks: document.project.chapters.reduce(
        (count, chapter) => count + chapter.blocks.length,
        0,
      ),
      chats: document.project.chats.length,
      reviews: document.project.completedReviews.length,
      revisions: document.project.completedRevisions.length,
      assistantConversations: document.project.assistantConversations.length,
    },
  };
}

export async function cloneProjectTransfer(
  projectId: string,
  name: string,
  selection: Partial<ProjectTransferSelection>,
) {
  const normalizedName = name.trim();
  if (!normalizedName) throw new ApiError("projectCloneNameRequired");
  const document = await buildProjectTransfer(projectId, selection);
  return importProjectTransfer({
    ...document,
    exportedAt: new Date().toISOString(),
    project: { ...document.project, name: normalizedName },
  });
}

export async function buildProjectManuscript(projectId: string, format: "txt" | "markdown") {
  const conn = await getDb();
  const project = (await conn("projects").where({ id: projectId }).first()) as Row | undefined;
  if (!project) throw new ApiError("projectNotFound", 404);
  const chapters = (await conn("chapters")
    .where({ project_id: projectId })
    .orderBy("sort_order", "asc")
    .select("id", "title")) as Row[];
  const chapterIds = chapters.map((chapter) => String(chapter.id));
  const blocks = chapterIds.length
    ? ((await conn("blocks")
        .leftJoin("block_swipes", "blocks.current_swipe_id", "block_swipes.id")
        .whereIn("blocks.chapter_id", chapterIds)
        .andWhere("blocks.type", "text")
        .orderBy("blocks.sort_order", "asc")
        .select("blocks.chapter_id", "block_swipes.content")) as Row[])
    : [];
  const nonEmptyChapters = chapters.flatMap((chapter) => {
    const content = blocks
      .filter((block) => String(block.chapter_id) === String(chapter.id))
      .map((block) => String(block.content ?? "").trim())
      .filter(Boolean)
      .join("\n\n");
    return content ? [{ title: String(chapter.title), content }] : [];
  });
  const title = singleLine(String(project.name));
  const body = nonEmptyChapters
    .map((chapter) =>
      format === "markdown"
        ? `## ${singleLine(chapter.title)}\n\n${chapter.content}`
        : `${singleLine(chapter.title)}\n\n${chapter.content}`,
    )
    .join("\n\n");
  return {
    content: `${format === "markdown" ? "# " : ""}${title}${body ? `\n\n${body}` : ""}`,
    chapterCount: nonEmptyChapters.length,
  };
}

function singleLine(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}
