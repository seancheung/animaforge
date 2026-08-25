import { ApiError, apiDefault, fail, jsonBody, ok } from "@/lib/api";
import { loadEntities, loadEntity } from "@/lib/data";
import { getDb, newId } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return ok(await loadEntities(id));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await params;
    const body = await jsonBody<{
      typeId?: string;
      name?: string;
      description?: string;
      alwaysInclude?: boolean;
    }>(request);
    const conn = await getDb();
    const type = body.typeId
      ? await conn("entity_types")
          .where({ id: body.typeId })
          .andWhere((builder) => builder.whereNull("project_id").orWhere({ project_id: projectId }))
          .first()
      : null;
    if (!type) throw new ApiError("entityTypeNotFound", 404);
    const id = newId();
    await conn("entities").insert({
      id,
      project_id: projectId,
      type_id: type.id,
      name: body.name?.trim() || (await apiDefault("unnamedEntity")),
      description: body.description ?? "",
      always_include: body.alwaysInclude ? 1 : 0,
    });
    return ok(await loadEntity(projectId, id), { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
