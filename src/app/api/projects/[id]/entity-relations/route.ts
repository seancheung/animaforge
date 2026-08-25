import { ApiError, fail, jsonBody, ok } from "@/lib/api";
import { loadEntityRelations, mapEntityRelation } from "@/lib/data";
import { getDb, newId } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return ok(await loadEntityRelations(id));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await params;
    const body = await jsonBody<{
      sourceEntityId?: string;
      targetEntityId?: string;
      name?: string;
      description?: string;
      alwaysInclude?: boolean;
    }>(request);
    const name = body.name?.trim();
    if (!name || !body.sourceEntityId || !body.targetEntityId)
      throw new ApiError("invalidEntityRelation");
    if (body.sourceEntityId === body.targetEntityId) throw new ApiError("selfEntityRelation");
    const conn = await getDb();
    const endpoints = await conn("entities")
      .where({ project_id: projectId })
      .whereIn("id", [body.sourceEntityId, body.targetEntityId]);
    if (endpoints.length !== 2) throw new ApiError("entityNotFound", 404);
    const id = newId();
    await conn("entity_relations").insert({
      id,
      project_id: projectId,
      source_entity_id: body.sourceEntityId,
      target_entity_id: body.targetEntityId,
      name,
      description: body.description ?? "",
      always_include: body.alwaysInclude ? 1 : 0,
    });
    return ok(mapEntityRelation(await conn("entity_relations").where({ id }).first()), {
      status: 201,
    });
  } catch (error) {
    return fail(error);
  }
}
