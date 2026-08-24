import { ApiError, fail, ok } from "@/lib/api";
import { loadBlocks, markFollowingCheckpointsStale } from "@/lib/data";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const conn = await getDb();
    const swipe = await conn("block_swipes").where({ id }).first();
    if (!swipe) throw new ApiError("swipeNotFound", 404);
    const block = await conn("blocks").where({ id: swipe.block_id }).first();
    const siblings = await conn("block_swipes")
      .where({ block_id: swipe.block_id })
      .orderBy("created_at", "asc");
    if (siblings.length <= 1) throw new ApiError("mustRetainSwipe");
    await conn.transaction(async (trx) => {
      const currentChanged = block.current_swipe_id === id;
      if (currentChanged) {
        const next = siblings.find((item) => item.id !== id);
        await trx("blocks")
          .where({ id: block.id })
          .update({ current_swipe_id: next.id, updated_at: trx.fn.now() });
      }
      await trx("block_swipes").where({ id }).delete();
      if (block.type === "text" || currentChanged)
        await markFollowingCheckpointsStale(
          String(block.chapter_id),
          Number(block.sort_order),
          trx,
        );
    });
    const updated = (await loadBlocks(String(block.chapter_id))).find(
      (item) => item.id === block.id,
    );
    return ok(updated);
  } catch (error) {
    return fail(error);
  }
}
