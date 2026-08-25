import { ApiError, fail, jsonBody, ok } from "@/lib/api";
import { mapEntityRelation } from "@/lib/data";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await jsonBody<{
      sourceEntityId?: string;
      targetEntityId?: string;
      name?: string;
      description?: string;
      alwaysInclude?: boolean;
    }>(request);
    const conn = await getDb();
    const relation = await conn("entity_relations").where({ id }).first();
    if (!relation) throw new ApiError("entityRelationNotFound", 404);
    const sourceId = body.sourceEntityId ?? String(relation.source_entity_id);
    const targetId = body.targetEntityId ?? String(relation.target_entity_id);
    if (sourceId === targetId) throw new ApiError("selfEntityRelation");
    const endpoints = await conn("entities")
      .where({ project_id: relation.project_id })
      .whereIn("id", [sourceId, targetId]);
    if (endpoints.length !== 2) throw new ApiError("entityNotFound", 404);
    const update: Record<string, unknown> = { updated_at: conn.fn.now() };
    if (body.sourceEntityId !== undefined) update.source_entity_id = body.sourceEntityId;
    if (body.targetEntityId !== undefined) update.target_entity_id = body.targetEntityId;
    if (body.name !== undefined) {
      if (!body.name.trim()) throw new ApiError("invalidEntityRelation");
      update.name = body.name.trim();
    }
    if (body.description !== undefined) update.description = body.description;
    if (body.alwaysInclude !== undefined) update.always_include = body.alwaysInclude ? 1 : 0;
    await conn("entity_relations").where({ id }).update(update);
    return ok(mapEntityRelation(await conn("entity_relations").where({ id }).first()));
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const conn = await getDb();
    if (!(await conn("entity_relations").where({ id }).delete()))
      throw new ApiError("entityRelationNotFound", 404);
    return ok({ success: true });
  } catch (error) {
    return fail(error);
  }
}
