import { ApiError, fail, jsonBody, ok } from "@/lib/api";
import { loadBlocks, markFollowingCheckpointsStale } from "@/lib/data";
import { getDb, newId } from "@/lib/db";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await jsonBody<{
      content?: string;
      synopsis?: string;
      currentSwipeId?: string;
      newSwipe?: boolean;
      stale?: boolean;
      move?: "up" | "down";
    }>(request);
    const conn = await getDb();
    const blockRow = await conn("blocks").where({ id }).first();
    if (!blockRow) throw new ApiError("blockNotFound", 404);

    await conn.transaction(async (trx) => {
      let affectsFollowingCheckpoints = false;
      let staleAfter = Number(blockRow.sort_order);

      if (body.move) {
        const operator = body.move === "up" ? "<" : ">";
        const order = body.move === "up" ? "desc" : "asc";
        const neighbor = await trx("blocks")
          .where({ chapter_id: blockRow.chapter_id })
          .andWhere("sort_order", operator, blockRow.sort_order)
          .orderBy("sort_order", order)
          .first();
        if (neighbor) {
          await trx("blocks")
            .where({ id })
            .update({ sort_order: neighbor.sort_order, updated_at: trx.fn.now() });
          await trx("blocks")
            .where({ id: neighbor.id })
            .update({ sort_order: blockRow.sort_order, updated_at: trx.fn.now() });
          staleAfter = Math.min(Number(blockRow.sort_order), Number(neighbor.sort_order)) - 1;
          affectsFollowingCheckpoints = true;
        }
      }

      const update: Record<string, unknown> = { updated_at: trx.fn.now() };
      if (body.synopsis !== undefined) {
        update.synopsis = body.synopsis;
        if (blockRow.type === "text") affectsFollowingCheckpoints = true;
      }
      if (body.stale !== undefined) update.stale = body.stale ? 1 : 0;

      if (body.content !== undefined) {
        if (body.newSwipe) {
          const swipeId = newId();
          await trx("block_swipes").insert({ id: swipeId, block_id: id, content: body.content });
          update.current_swipe_id = swipeId;
        } else {
          await trx("block_swipes")
            .where({ id: blockRow.current_swipe_id, block_id: id })
            .update({ content: body.content });
        }
        affectsFollowingCheckpoints = true;
      }

      if (body.currentSwipeId !== undefined) {
        const swipe = await trx("block_swipes")
          .where({ id: body.currentSwipeId, block_id: id })
          .first();
        if (!swipe) throw new ApiError("swipeNotFound", 404);
        update.current_swipe_id = body.currentSwipeId;
        affectsFollowingCheckpoints = true;
      }

      if (Object.keys(update).length > 1 || body.stale !== undefined)
        await trx("blocks").where({ id }).update(update);
      if (affectsFollowingCheckpoints)
        await markFollowingCheckpointsStale(String(blockRow.chapter_id), staleAfter, trx);
    });

    const block = (await loadBlocks(String(blockRow.chapter_id))).find((item) => item.id === id);
    if (!block) throw new ApiError("blockNotFound", 404);
    return ok(block);
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const conn = await getDb();
    const row = await conn("blocks").where({ id }).first();
    if (!row) throw new ApiError("blockNotFound", 404);
    await conn.transaction(async (trx) => {
      await trx("blocks").where({ id }).delete();
      await trx("blocks")
        .where({ chapter_id: row.chapter_id })
        .andWhere("sort_order", ">", row.sort_order)
        .decrement("sort_order", 1);
      await markFollowingCheckpointsStale(String(row.chapter_id), Number(row.sort_order) - 1, trx);
    });
    return ok({ success: true });
  } catch (error) {
    return fail(error);
  }
}
