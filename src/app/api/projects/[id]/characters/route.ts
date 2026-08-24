import { apiDefault, fail, jsonBody, ok } from "@/lib/api";
import { mapCharacter } from "@/lib/data";
import { getDb, newId } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await params;
    const body = await jsonBody<{ name?: string; description?: string }>(request);
    const conn = await getDb();
    const id = newId();
    await conn("characters").insert({
      id,
      project_id: projectId,
      name: body.name?.trim() || (await apiDefault("newCharacter")),
      description: body.description || "",
    });
    return ok(mapCharacter(await conn("characters").where({ id }).first()), { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
