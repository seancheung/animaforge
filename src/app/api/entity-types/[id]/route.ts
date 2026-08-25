import { ApiError, fail, jsonBody, ok } from "@/lib/api";
import { mapEntityType } from "@/lib/data";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await jsonBody<{ name?: string; description?: string }>(request);
    const conn = await getDb();
    const type = await conn("entity_types").where({ id }).first();
    if (!type) throw new ApiError("entityTypeNotFound", 404);
    if (type.system_key) throw new ApiError("systemEntityTypeImmutable");
    const update: Record<string, unknown> = { updated_at: conn.fn.now() };
    if (body.name !== undefined) {
      const name = body.name.trim();
      if (!name) throw new ApiError("entityTypeNameRequired");
      const duplicate = await conn("entity_types")
        .where({ project_id: type.project_id, name })
        .whereNot({ id })
        .first();
      if (duplicate) throw new ApiError("entityTypeNameExists");
      update.name = name;
    }
    if (body.description !== undefined) update.description = body.description;
    await conn("entity_types").where({ id }).update(update);
    return ok(mapEntityType(await conn("entity_types").where({ id }).first()));
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const conn = await getDb();
    const type = await conn("entity_types").where({ id }).first();
    if (!type) throw new ApiError("entityTypeNotFound", 404);
    if (type.system_key) throw new ApiError("systemEntityTypeImmutable");
    if (await conn("entities").where({ type_id: id }).first())
      throw new ApiError("entityTypeInUse");
    await conn("entity_types").where({ id }).delete();
    return ok({ success: true });
  } catch (error) {
    return fail(error);
  }
}
