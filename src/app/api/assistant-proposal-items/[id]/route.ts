import { ApiError, apiDefault, fail, jsonBody, ok } from "@/lib/api";
import { markFollowingCheckpointsStale } from "@/lib/data";
import { getDb, newId, parseJson } from "@/lib/db";
import type { AssistantAction, AssistantDecision } from "@/lib/types";

export const runtime = "nodejs";

type ProposalItemRow = Record<string, unknown> & {
  id: string;
  proposal_id: string;
  project_id: string;
  conversation_id: string;
  context_id: string;
  action: AssistantAction;
  decision: AssistantDecision;
  payload: string;
  supersedes_item_id?: string | null;
  sort_order: number;
};

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await jsonBody<{ decision?: "accepted" | "rejected" }>(request);
    if (body.decision !== "accepted" && body.decision !== "rejected")
      throw new ApiError("invalidReviewDecision");
    const conn = await getDb();
    const row = (await conn("assistant_proposal_items as item")
      .join("assistant_proposals as proposal", "item.proposal_id", "proposal.id")
      .join("assistant_messages as message", "proposal.message_id", "message.id")
      .join("assistant_conversations as conversation", "message.conversation_id", "conversation.id")
      .where("item.id", id)
      .select(
        "item.*",
        "conversation.id as conversation_id",
        "conversation.project_id",
        "conversation.context_id",
      )
      .first()) as ProposalItemRow | undefined;
    if (!row) throw new ApiError("proposalNotFound", 404);
    if (row.decision === "accepted") {
      if (body.decision === "rejected") throw new ApiError("acceptedCannotReject");
      return ok({
        success: true,
        decision: "accepted",
        appliedEntityId: row.applied_entity_id ?? null,
      });
    }
    if (row.decision === "superseded") throw new ApiError("supersededProposalImmutable");
    if (row.decision === "rejected") {
      if (body.decision === "accepted") throw new ApiError("rejectedProposalImmutable");
      return ok({ success: true, decision: "rejected", appliedEntityId: null });
    }

    if (body.decision === "rejected") {
      await conn("assistant_proposal_items")
        .where({ id })
        .update({ decision: "rejected", updated_at: conn.fn.now() });
      return ok({ success: true, decision: "rejected", appliedEntityId: null });
    }

    const payload = parseJson<Record<string, unknown>>(row.payload, {});
    let appliedEntityId: string | null = null;
    await conn.transaction(async (trx) => {
      const resolveAnchor = async (item: Record<string, unknown>) => {
        let anchor = item;
        const visited = new Set<string>();
        while (anchor.supersedes_item_id && !visited.has(String(anchor.supersedes_item_id))) {
          visited.add(String(anchor.supersedes_item_id));
          const source = (await trx("assistant_proposal_items")
            .where({ id: anchor.supersedes_item_id })
            .first()) as Record<string, unknown> | undefined;
          if (!source) break;
          anchor = source;
        }
        return { proposalId: String(anchor.proposal_id), sortOrder: Number(anchor.sort_order) };
      };
      const findAcceptedRevisionSiblings = async (
        action: "create_chapter" | "create_text_block",
      ) => {
        const currentAnchor = await resolveAnchor(row);
        const acceptedCandidates = (await trx("assistant_proposal_items as item")
          .join("assistant_proposals as proposal", "item.proposal_id", "proposal.id")
          .join("assistant_messages as message", "proposal.message_id", "message.id")
          .where({
            "message.conversation_id": row.conversation_id,
            "item.action": action,
            "item.decision": "accepted",
          })
          .whereNotNull("item.applied_entity_id")
          .select("item.*")) as Record<string, unknown>[];
        const anchoredCandidates = await Promise.all(
          acceptedCandidates.map(async (item) => ({ item, anchor: await resolveAnchor(item) })),
        );
        const acceptedSiblings = anchoredCandidates.filter(
          (candidate) => candidate.anchor.proposalId === currentAnchor.proposalId,
        );
        return {
          previous: acceptedSiblings
            .filter((candidate) => candidate.anchor.sortOrder < currentAnchor.sortOrder)
            .sort((a, b) => b.anchor.sortOrder - a.anchor.sortOrder)[0]?.item,
          next: acceptedSiblings
            .filter((candidate) => candidate.anchor.sortOrder > currentAnchor.sortOrder)
            .sort((a, b) => a.anchor.sortOrder - b.anchor.sortOrder)[0]?.item,
        };
      };
      if (row.action === "update_project_field") {
        const fieldMap = {
          name: "name",
          synopsis: "synopsis",
          proseStyle: "prose_style",
          language: "language",
        } as const;
        const field = String(payload.field ?? "") as keyof typeof fieldMap;
        if (!(field in fieldMap) || typeof payload.value !== "string")
          throw new ApiError("invalidProjectFieldProposal");
        const value =
          field === "name"
            ? payload.value.trim() || (await apiDefault("unnamedProject"))
            : field === "language"
              ? payload.value.trim()
              : payload.value;
        await trx("projects")
          .where({ id: row.project_id })
          .update({ [fieldMap[field]]: value, updated_at: trx.fn.now() });
        appliedEntityId = row.project_id;
      } else if (row.action === "create_entity") {
        if (typeof payload.name !== "string" || typeof payload.typeId !== "string")
          throw new ApiError("invalidEntityProposal");
        if (
          payload.chapterIds !== undefined &&
          (!Array.isArray(payload.chapterIds) ||
            payload.chapterIds.some((chapterId) => typeof chapterId !== "string"))
        )
          throw new ApiError("invalidChapterEntitiesProposal");
        const chapterIds = [
          ...new Set((Array.isArray(payload.chapterIds) ? payload.chapterIds : []) as string[]),
        ];
        if (row.context_id && chapterIds.some((chapterId) => chapterId !== row.context_id))
          throw new ApiError("invalidChapterEntitiesProposal");
        const chapters = chapterIds.length
          ? await trx("chapters").where({ project_id: row.project_id }).whereIn("id", chapterIds)
          : [];
        if (chapters.length !== chapterIds.length) throw new ApiError("chapterNotFound", 404);
        const type = await trx("entity_types")
          .where({ id: payload.typeId })
          .andWhere((builder) =>
            builder.whereNull("project_id").orWhere({ project_id: row.project_id }),
          )
          .first();
        if (!type) throw new ApiError("entityTypeNotFound", 404);
        appliedEntityId = newId();
        await trx("entities").insert({
          id: appliedEntityId,
          project_id: row.project_id,
          type_id: type.id,
          name: payload.name.trim() || (await apiDefault("unnamedEntity")),
          description: typeof payload.description === "string" ? payload.description : "",
          always_include: payload.alwaysInclude === true ? 1 : 0,
        });
        if (chapterIds.length)
          await trx("chapter_entities").insert(
            chapterIds.map((chapterId) => ({ chapter_id: chapterId, entity_id: appliedEntityId })),
          );
      } else if (row.action === "update_entity") {
        const entityId = typeof payload.entityId === "string" ? payload.entityId : "";
        const entity = await trx("entities")
          .where({ id: entityId, project_id: row.project_id })
          .first();
        if (!entity) throw new ApiError("entityNotFound", 404);
        const update: Record<string, unknown> = { updated_at: trx.fn.now() };
        if (typeof payload.name === "string")
          update.name = payload.name.trim() || (await apiDefault("unnamedEntity"));
        if (typeof payload.description === "string") update.description = payload.description;
        if (typeof payload.alwaysInclude === "boolean")
          update.always_include = payload.alwaysInclude ? 1 : 0;
        if (typeof payload.typeId === "string") {
          const type = await trx("entity_types")
            .where({ id: payload.typeId })
            .andWhere((builder) =>
              builder.whereNull("project_id").orWhere({ project_id: row.project_id }),
            )
            .first();
          if (!type) throw new ApiError("entityTypeNotFound", 404);
          if (
            entity.type_id === "system-character" &&
            type.id !== "system-character" &&
            ((await trx("character_chat_members").where({ entity_id: entityId }).first()) ||
              (await trx("character_chats").where({ user_entity_id: entityId }).first()))
          )
            throw new ApiError("entityInChat");
          update.type_id = type.id;
        }
        await trx("entities").where({ id: entityId }).update(update);
        appliedEntityId = entityId;
      } else if (row.action === "create_relation") {
        if (
          typeof payload.sourceEntityId !== "string" ||
          typeof payload.targetEntityId !== "string" ||
          typeof payload.name !== "string"
        )
          throw new ApiError("invalidEntityRelation");
        if (payload.sourceEntityId === payload.targetEntityId)
          throw new ApiError("selfEntityRelation");
        const endpoints = await trx("entities")
          .where({ project_id: row.project_id })
          .whereIn("id", [payload.sourceEntityId, payload.targetEntityId]);
        if (endpoints.length !== 2) throw new ApiError("entityNotFound", 404);
        appliedEntityId = newId();
        await trx("entity_relations").insert({
          id: appliedEntityId,
          project_id: row.project_id,
          source_entity_id: payload.sourceEntityId,
          target_entity_id: payload.targetEntityId,
          name: payload.name.trim(),
          description: typeof payload.description === "string" ? payload.description : "",
          always_include: payload.alwaysInclude === true ? 1 : 0,
        });
      } else if (row.action === "update_relation") {
        const relationId = typeof payload.relationId === "string" ? payload.relationId : "";
        const relation = await trx("entity_relations")
          .where({ id: relationId, project_id: row.project_id })
          .first();
        if (!relation) throw new ApiError("entityRelationNotFound", 404);
        const sourceId =
          typeof payload.sourceEntityId === "string"
            ? payload.sourceEntityId
            : String(relation.source_entity_id);
        const targetId =
          typeof payload.targetEntityId === "string"
            ? payload.targetEntityId
            : String(relation.target_entity_id);
        if (sourceId === targetId) throw new ApiError("selfEntityRelation");
        const endpoints = await trx("entities")
          .where({ project_id: row.project_id })
          .whereIn("id", [sourceId, targetId]);
        if (endpoints.length !== 2) throw new ApiError("entityNotFound", 404);
        const update: Record<string, unknown> = { updated_at: trx.fn.now() };
        if (typeof payload.sourceEntityId === "string")
          update.source_entity_id = payload.sourceEntityId;
        if (typeof payload.targetEntityId === "string")
          update.target_entity_id = payload.targetEntityId;
        if (typeof payload.name === "string") {
          if (!payload.name.trim()) throw new ApiError("invalidEntityRelation");
          update.name = payload.name.trim();
        }
        if (typeof payload.description === "string") update.description = payload.description;
        if (typeof payload.alwaysInclude === "boolean")
          update.always_include = payload.alwaysInclude ? 1 : 0;
        await trx("entity_relations").where({ id: relationId }).update(update);
        appliedEntityId = relationId;
      } else if (row.action === "create_chapter") {
        if (typeof payload.title !== "string") throw new ApiError("invalidChapterProposal");
        if (
          payload.entityIds !== undefined &&
          (!Array.isArray(payload.entityIds) ||
            payload.entityIds.some((entityId) => typeof entityId !== "string"))
        )
          throw new ApiError("invalidChapterEntitiesProposal");
        const entityIds = [
          ...new Set((Array.isArray(payload.entityIds) ? payload.entityIds : []) as string[]),
        ];
        const entities = entityIds.length
          ? await trx("entities").where({ project_id: row.project_id }).whereIn("id", entityIds)
          : [];
        if (entities.length !== entityIds.length) throw new ApiError("entityNotFound", 404);
        const { previous, next } = await findAcceptedRevisionSiblings("create_chapter");
        const previousChapter = previous
          ? await trx("chapters")
              .where({ id: previous.applied_entity_id, project_id: row.project_id })
              .first()
          : null;
        const nextChapter = next
          ? await trx("chapters")
              .where({ id: next.applied_entity_id, project_id: row.project_id })
              .first()
          : null;
        const last = await trx("chapters")
          .where({ project_id: row.project_id })
          .max<{ max: number | null }>("sort_order as max")
          .first();
        const insertAt = previousChapter
          ? Number(previousChapter.sort_order) + 1
          : nextChapter
            ? Number(nextChapter.sort_order)
            : Number(last?.max ?? -1) + 1;
        await trx("chapters")
          .where({ project_id: row.project_id })
          .andWhere("sort_order", ">=", insertAt)
          .increment("sort_order", 1);
        appliedEntityId = newId();
        await trx("chapters").insert({
          id: appliedEntityId,
          project_id: row.project_id,
          title: payload.title.trim() || (await apiDefault("unnamedChapter")),
          synopsis: typeof payload.synopsis === "string" ? payload.synopsis : "",
          sort_order: insertAt,
          entity_mode: "selected",
        });
        if (entityIds.length)
          await trx("chapter_entities").insert(
            entityIds.map((entityId) => ({
              chapter_id: appliedEntityId,
              entity_id: entityId,
            })),
          );
      } else if (row.action === "update_chapter_title") {
        const chapterId =
          typeof payload.chapterId === "string" ? payload.chapterId : row.context_id;
        if (
          !chapterId ||
          (row.context_id && chapterId !== row.context_id) ||
          typeof payload.title !== "string"
        )
          throw new ApiError("invalidChapterTitleProposal");
        const chapter = await trx("chapters")
          .where({ id: chapterId, project_id: row.project_id })
          .first();
        if (!chapter) throw new ApiError("chapterNotFound", 404);
        await trx("chapters")
          .where({ id: chapterId })
          .update({
            title: payload.title.trim() || (await apiDefault("unnamedChapter")),
            updated_at: trx.fn.now(),
          });
        appliedEntityId = chapterId;
      } else if (row.action === "update_chapter_synopsis") {
        const chapterId =
          typeof payload.chapterId === "string" ? payload.chapterId : row.context_id;
        if (
          !chapterId ||
          (row.context_id && chapterId !== row.context_id) ||
          typeof payload.synopsis !== "string"
        )
          throw new ApiError("invalidChapterSynopsisProposal");
        const chapter = await trx("chapters")
          .where({ id: chapterId, project_id: row.project_id })
          .first();
        if (!chapter) throw new ApiError("chapterNotFound", 404);
        await trx("chapters")
          .where({ id: chapterId })
          .update({ synopsis: payload.synopsis, updated_at: trx.fn.now() });
        appliedEntityId = chapterId;
      } else if (row.action === "update_chapter_entities") {
        const chapterId =
          typeof payload.chapterId === "string" ? payload.chapterId : row.context_id;
        if (
          !chapterId ||
          (row.context_id && chapterId !== row.context_id) ||
          !Array.isArray(payload.entityIds) ||
          payload.entityIds.some((entityId) => typeof entityId !== "string") ||
          !["add", "remove", "replace"].includes(String(payload.operation)) ||
          (payload.entityMode !== undefined &&
            payload.entityMode !== "all" &&
            payload.entityMode !== "selected")
        )
          throw new ApiError("invalidChapterEntitiesProposal");
        const chapter = await trx("chapters")
          .where({ id: chapterId, project_id: row.project_id })
          .first();
        if (!chapter) throw new ApiError("chapterNotFound", 404);
        const entityIds = [...new Set(payload.entityIds as string[])];
        const entities = entityIds.length
          ? await trx("entities").where({ project_id: row.project_id }).whereIn("id", entityIds)
          : [];
        if (entities.length !== entityIds.length) throw new ApiError("entityNotFound", 404);
        if (payload.entityMode !== undefined)
          await trx("chapters")
            .where({ id: chapterId })
            .update({ entity_mode: payload.entityMode, updated_at: trx.fn.now() });
        if (payload.operation === "replace")
          await trx("chapter_entities").where({ chapter_id: chapterId }).delete();
        if (payload.operation === "remove" && entityIds.length)
          await trx("chapter_entities")
            .where({ chapter_id: chapterId })
            .whereIn("entity_id", entityIds)
            .delete();
        if ((payload.operation === "add" || payload.operation === "replace") && entityIds.length)
          await trx("chapter_entities")
            .insert(entityIds.map((entityId) => ({ chapter_id: chapterId, entity_id: entityId })))
            .onConflict(["chapter_id", "entity_id"])
            .ignore();
        appliedEntityId = chapterId;
      } else if (row.action === "create_text_block") {
        const chapterId =
          typeof payload.chapterId === "string" ? payload.chapterId : row.context_id;
        if (
          !chapterId ||
          (row.context_id && chapterId !== row.context_id) ||
          typeof payload.synopsis !== "string" ||
          !payload.synopsis.trim()
        )
          throw new ApiError("invalidTextOutlineProposal");
        const chapter = await trx("chapters")
          .where({ id: chapterId, project_id: row.project_id })
          .first();
        if (!chapter) throw new ApiError("chapterNotFound", 404);
        const { previous, next } = await findAcceptedRevisionSiblings("create_text_block");
        const previousBlock = previous
          ? await trx("blocks")
              .where({ id: previous.applied_entity_id, chapter_id: chapterId })
              .first()
          : null;
        const nextBlock = next
          ? await trx("blocks").where({ id: next.applied_entity_id, chapter_id: chapterId }).first()
          : null;
        const last = await trx("blocks")
          .where({ chapter_id: chapterId })
          .max<{ max: number | null }>("sort_order as max")
          .first();
        const insertAt = previousBlock
          ? Number(previousBlock.sort_order) + 1
          : nextBlock
            ? Number(nextBlock.sort_order)
            : Number(last?.max ?? -1) + 1;
        await trx("blocks")
          .where({ chapter_id: chapterId })
          .andWhere("sort_order", ">=", insertAt)
          .increment("sort_order", 1);
        appliedEntityId = newId();
        const swipeId = newId();
        await trx("blocks").insert({
          id: appliedEntityId,
          chapter_id: chapterId,
          type: "text",
          synopsis: payload.synopsis,
          sort_order: insertAt,
          current_swipe_id: swipeId,
        });
        await trx("block_swipes").insert({ id: swipeId, block_id: appliedEntityId, content: "" });
        await markFollowingCheckpointsStale(chapterId, insertAt - 1, trx);
      } else if (row.action === "update_block_synopsis") {
        const blockId = typeof payload.blockId === "string" ? payload.blockId : "";
        if (!blockId || typeof payload.synopsis !== "string")
          throw new ApiError("invalidTextSynopsisProposal");
        const block = await trx("blocks")
          .join("chapters", "blocks.chapter_id", "chapters.id")
          .where({
            "blocks.id": blockId,
            "blocks.type": "text",
            "chapters.project_id": row.project_id,
          })
          .select("blocks.*")
          .first();
        if (!block || (row.context_id && String(block.chapter_id) !== row.context_id))
          throw new ApiError("textNotFound", 404);
        await trx("blocks")
          .where({ id: blockId })
          .update({ synopsis: payload.synopsis, updated_at: trx.fn.now() });
        await markFollowingCheckpointsStale(
          String(block.chapter_id),
          Number(block.sort_order),
          trx,
        );
        appliedEntityId = blockId;
      } else {
        throw new ApiError("unsupportedProposal");
      }
      await trx("assistant_proposal_items").where({ id }).update({
        decision: "accepted",
        applied_entity_id: appliedEntityId,
        updated_at: trx.fn.now(),
      });
    });
    return ok({ success: true, decision: "accepted", appliedEntityId });
  } catch (error) {
    return fail(error);
  }
}
