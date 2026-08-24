import { ApiError, fail, jsonBody, ok } from "@/lib/api";
import { loadBlocks, markFollowingCheckpointsStale } from "@/lib/data";
import { getDb, newId } from "@/lib/db";
import type { BlockType } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: chapterId } = await params;
    const body = await jsonBody<{ type?: BlockType; beforeId?: string; afterId?: string }>(request);
    const conn = await getDb();
    const id = newId();
    const swipeId = newId();
    await conn.transaction(async (trx) => {
      const rows = await trx("blocks")
        .where({ chapter_id: chapterId })
        .orderBy("sort_order", "asc");
      let index = rows.length;
      if (body.beforeId)
        index = Math.max(
          0,
          rows.findIndex((row) => row.id === body.beforeId),
        );
      if (body.afterId) {
        const found = rows.findIndex((row) => row.id === body.afterId);
        index = found < 0 ? rows.length : found + 1;
      }
      await trx("blocks")
        .where({ chapter_id: chapterId })
        .andWhere("sort_order", ">=", index)
        .increment("sort_order", 1);
      await trx("blocks").insert({
        id,
        chapter_id: chapterId,
        type: body.type === "checkpoint" ? "checkpoint" : "text",
        synopsis: "",
        sort_order: index,
        current_swipe_id: swipeId,
      });
      await trx("block_swipes").insert({ id: swipeId, block_id: id, content: "" });
      await markFollowingCheckpointsStale(
        chapterId,
        body.type === "checkpoint" ? index : index - 1,
        trx,
      );
    });
    const block = (await loadBlocks(chapterId)).find((item) => item.id === id);
    if (!block) throw new ApiError("blockCreateFailed", 500);
    return ok(block, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
