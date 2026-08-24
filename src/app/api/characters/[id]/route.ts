import { ApiError, apiDefault, fail, jsonBody, ok } from "@/lib/api";
import { mapCharacter } from "@/lib/data";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await jsonBody<{ name?: string; description?: string }>(request);
    const conn = await getDb();
    const update: Record<string, unknown> = { updated_at: conn.fn.now() };
    if (body.name !== undefined)
      update.name = body.name.trim() || (await apiDefault("unnamedCharacter"));
    if (body.description !== undefined) update.description = body.description;
    if (!(await conn("characters").where({ id }).update(update)))
      throw new ApiError("characterNotFound", 404);
    return ok(mapCharacter(await conn("characters").where({ id }).first()));
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const conn = await getDb();
    const [membership, identity] = await Promise.all([
      conn("character_chat_members").where({ character_id: id }).first(),
      conn("character_chats").where({ user_character_id: id }).first(),
    ]);
    if (membership || identity) throw new ApiError("characterInChat");
    if (!(await conn("characters").where({ id }).delete()))
      throw new ApiError("characterNotFound", 404);
    return ok({ success: true });
  } catch (error) {
    return fail(error);
  }
}
