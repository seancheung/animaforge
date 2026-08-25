import { ApiError, apiDefault, fail, jsonBody, ok } from "@/lib/api";
import { loadEntity } from "@/lib/data";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await jsonBody<{
      typeId?: string;
      name?: string;
      description?: string;
      alwaysInclude?: boolean;
    }>(request);
    const conn = await getDb();
    const entity = await conn("entities").where({ id }).first();
    if (!entity) throw new ApiError("entityNotFound", 404);
    const update: Record<string, unknown> = { updated_at: conn.fn.now() };
    if (body.typeId !== undefined) {
      const type = await conn("entity_types")
        .where({ id: body.typeId })
        .andWhere((builder) =>
          builder.whereNull("project_id").orWhere({ project_id: entity.project_id }),
        )
        .first();
      if (!type) throw new ApiError("entityTypeNotFound", 404);
      if (
        entity.type_id === "system-character" &&
        body.typeId !== "system-character" &&
        ((await conn("character_chat_members").where({ entity_id: id }).first()) ||
          (await conn("character_chats").where({ user_entity_id: id }).first()))
      )
        throw new ApiError("entityInChat");
      update.type_id = body.typeId;
    }
    if (body.name !== undefined)
      update.name = body.name.trim() || (await apiDefault("unnamedEntity"));
    if (body.description !== undefined) update.description = body.description;
    if (body.alwaysInclude !== undefined) update.always_include = body.alwaysInclude ? 1 : 0;
    await conn("entities").where({ id }).update(update);
    return ok(await loadEntity(String(entity.project_id), id));
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const conn = await getDb();
    if (
      (await conn("character_chat_members").where({ entity_id: id }).first()) ||
      (await conn("character_chats").where({ user_entity_id: id }).first())
    )
      throw new ApiError("entityInChat");
    if (!(await conn("entities").where({ id }).delete())) throw new ApiError("entityNotFound", 404);
    return ok({ success: true });
  } catch (error) {
    return fail(error);
  }
}
