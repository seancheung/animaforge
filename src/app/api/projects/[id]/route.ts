import { ApiError, apiDefault, fail, jsonBody, ok } from "@/lib/api";
import { mapChapter, mapCharacter, mapProject } from "@/lib/data";
import { getDb } from "@/lib/db";
import type { TaskType } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const conn = await getDb();
    const row = await conn("projects").where({ id }).first();
    if (!row) throw new ApiError("projectNotFound", 404);
    const characterRows = await conn("characters")
      .where({ project_id: id })
      .orderBy("created_at", "asc");
    const chapterRows = await conn("chapters")
      .where({ project_id: id })
      .orderBy("sort_order", "asc");
    const links = await conn("chapter_characters").whereIn(
      "chapter_id",
      chapterRows.map((chapter) => chapter.id),
    );
    const blockRows = await conn("blocks")
      .join("chapters", "blocks.chapter_id", "chapters.id")
      .leftJoin("block_swipes", "blocks.current_swipe_id", "block_swipes.id")
      .where("chapters.project_id", id)
      .select("blocks.chapter_id", "blocks.type", "blocks.stale", "block_swipes.content");
    const [chatCountRow, chatSessionCountRow, chatMessageCountRow, reviewRows, revisionRows] =
      await Promise.all([
        conn("character_chats").where({ project_id: id }).count({ count: "*" }).first() as Promise<{
          count?: number | string;
        }>,
        conn("character_chat_sessions as sessions")
          .join("character_chats as chats", "sessions.chat_id", "chats.id")
          .where("chats.project_id", id)
          .count({ count: "*" })
          .first() as Promise<{ count?: number | string }>,
        conn("character_chat_messages as messages")
          .join("character_chat_sessions as sessions", "messages.session_id", "sessions.id")
          .join("character_chats as chats", "sessions.chat_id", "chats.id")
          .where("chats.project_id", id)
          .count({ count: "*" })
          .first() as Promise<{ count?: number | string }>,
        conn("project_reviews").where({ project_id: id }).select("status") as Promise<
          { status: string }[]
        >,
        conn("project_revisions").where({ project_id: id }).select("status") as Promise<
          { status: string }[]
        >,
      ]);
    const textBlocks = blockRows.filter((block) => block.type === "text");
    const contentChapterIds = new Set(
      textBlocks
        .filter((block) => String(block.content ?? "").trim())
        .map((block) => String(block.chapter_id)),
    );
    const completedRevisionCount = revisionRows.filter(
      (revision) => revision.status === "completed",
    ).length;
    return ok({
      project: mapProject(row),
      characters: characterRows.map(mapCharacter),
      chapters: chapterRows.map((chapter) =>
        mapChapter(
          chapter,
          links
            .filter((link) => link.chapter_id === chapter.id)
            .map((link) => String(link.character_id)),
        ),
      ),
      stats: {
        chapterCount: chapterRows.length,
        characterCount: characterRows.length,
        textBlockCount: textBlocks.length,
        checkpointCount: blockRows.filter((block) => block.type === "checkpoint").length,
        staleCheckpointCount: blockRows.filter(
          (block) => block.type === "checkpoint" && Boolean(block.stale),
        ).length,
        chaptersWithContent: contentChapterIds.size,
        proseCharacters: textBlocks.reduce(
          (total, block) => total + String(block.content ?? "").length,
          0,
        ),
        chatCount: Number(chatCountRow?.count ?? 0),
        chatSessionCount: Number(chatSessionCountRow?.count ?? 0),
        chatMessageCount: Number(chatMessageCountRow?.count ?? 0),
        reviewCount: reviewRows.length,
        completedReviewCount: reviewRows.filter((review) => review.status === "completed").length,
        failedReviewCount: reviewRows.filter((review) => review.status === "failed").length,
        revisionCount: revisionRows.length,
        completedRevisionCount,
        unfinishedRevisionCount: revisionRows.length - completedRevisionCount,
      },
    });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await jsonBody<{
      name?: string;
      synopsis?: string;
      proseStyle?: string;
      styleFingerprintId?: string | null;
      language?: string;
      modelOverrides?: Partial<Record<TaskType, string | null>>;
    }>(request);
    const conn = await getDb();
    const update: Record<string, unknown> = { updated_at: conn.fn.now() };
    if (body.name !== undefined)
      update.name = body.name.trim() || (await apiDefault("unnamedProject"));
    if (body.synopsis !== undefined) update.synopsis = body.synopsis;
    if (body.proseStyle !== undefined) update.prose_style = body.proseStyle;
    if (body.styleFingerprintId !== undefined) {
      const fingerprintId = body.styleFingerprintId?.trim() || null;
      if (fingerprintId && !(await conn("style_fingerprints").where({ id: fingerprintId }).first()))
        throw new ApiError("styleFingerprintNotFound", 404);
      update.style_fingerprint_id = fingerprintId;
    }
    if (body.language !== undefined) update.language = body.language.trim();
    if (body.modelOverrides !== undefined)
      update.model_overrides = JSON.stringify(body.modelOverrides);
    if (!(await conn("projects").where({ id }).update(update)))
      throw new ApiError("projectNotFound", 404);
    return ok(mapProject(await conn("projects").where({ id }).first()));
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const conn = await getDb();
    if (!(await conn("projects").where({ id }).delete()))
      throw new ApiError("projectNotFound", 404);
    return ok({ success: true });
  } catch (error) {
    return fail(error);
  }
}
