import { ApiError, fail, ok } from "@/lib/api";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const conn = await getDb();
    if (!(await conn("projects").where({ id }).first())) throw new ApiError("projectNotFound", 404);
    const chapterRows = await conn("chapters")
      .where({ project_id: id })
      .orderBy("sort_order", "asc")
      .select("id", "title");
    const chapterIds = chapterRows.map((chapter) => String(chapter.id));
    const blockRows = chapterIds.length
      ? await conn("blocks")
          .leftJoin("block_swipes", "blocks.current_swipe_id", "block_swipes.id")
          .whereIn("blocks.chapter_id", chapterIds)
          .andWhere("blocks.type", "text")
          .orderBy("blocks.sort_order", "asc")
          .select("blocks.id", "blocks.chapter_id", "block_swipes.content")
      : [];

    return ok({
      chapters: chapterRows.map((chapter) => ({
        id: String(chapter.id),
        title: String(chapter.title),
        blocks: blockRows
          .filter((block) => String(block.chapter_id) === String(chapter.id))
          .map((block) => ({ id: String(block.id), content: String(block.content ?? "") })),
      })),
    });
  } catch (error) {
    return fail(error);
  }
}
