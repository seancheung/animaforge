import { apiDefault, fail, jsonBody, ok } from "@/lib/api";
import { mapChapter } from "@/lib/data";
import { getDb, newId } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await params;
    const body = await jsonBody<{ title?: string; synopsis?: string }>(request);
    const conn = await getDb();
    const max = await conn("chapters")
      .where({ project_id: projectId })
      .max("sort_order as value")
      .first();
    const id = newId();
    await conn("chapters").insert({
      id,
      project_id: projectId,
      title: body.title?.trim() || (await apiDefault("newChapter")),
      synopsis: body.synopsis || "",
      sort_order: Number(max?.value ?? -1) + 1,
    });
    return ok(mapChapter(await conn("chapters").where({ id }).first()), { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
