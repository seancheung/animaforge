import { ApiError, fail, jsonBody, ok } from "@/lib/api";
import { loadEntityTypes, mapEntityType } from "@/lib/data";
import { getDb, newId } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const conn = await getDb();
    if (!(await conn("projects").where({ id }).first())) throw new ApiError("projectNotFound", 404);
    return ok(await loadEntityTypes(id));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await params;
    const body = await jsonBody<{ name?: string; description?: string }>(request);
    const name = body.name?.trim();
    if (!name) throw new ApiError("entityTypeNameRequired");
    const conn = await getDb();
    if (!(await conn("projects").where({ id: projectId }).first()))
      throw new ApiError("projectNotFound", 404);
    if (await conn("entity_types").where({ project_id: projectId, name }).first())
      throw new ApiError("entityTypeNameExists");
    const last = await conn("entity_types")
      .where({ project_id: projectId })
      .max<{ max: number | null }>("sort_order as max")
      .first();
    const id = newId();
    await conn("entity_types").insert({
      id,
      project_id: projectId,
      system_key: null,
      name,
      description: body.description ?? "",
      sort_order: Number(last?.max ?? 99) + 1,
    });
    return ok(mapEntityType(await conn("entity_types").where({ id }).first()), { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
