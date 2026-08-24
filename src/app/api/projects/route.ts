import { apiDefault, fail, jsonBody, ok } from "@/lib/api";
import { mapProject } from "@/lib/data";
import { getDb, newId } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    const conn = await getDb();
    const rows = await conn("projects")
      .select("projects.*")
      .select(
        conn.raw(
          "(select count(*) from chapters where chapters.project_id = projects.id) as chapter_count",
        ),
      )
      .select(
        conn.raw(
          "(select count(*) from characters where characters.project_id = projects.id) as character_count",
        ),
      )
      .orderBy("updated_at", "desc");
    return ok(rows.map(mapProject));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await jsonBody<{
      name?: string;
      synopsis?: string;
      proseStyle?: string;
      language?: string;
    }>(request);
    const conn = await getDb();
    const id = newId();
    await conn("projects").insert({
      id,
      name: body.name?.trim() || (await apiDefault("unnamedProject")),
      synopsis: body.synopsis?.trim() || "",
      prose_style: body.proseStyle?.trim() || "",
      language: body.language?.trim() || "",
    });
    const row = await conn("projects").where({ id }).first();
    return ok(mapProject(row), { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
