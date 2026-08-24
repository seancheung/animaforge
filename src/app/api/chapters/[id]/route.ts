import { ApiError, apiDefault, fail, jsonBody, ok } from "@/lib/api";
import {
  loadBlocks,
  loadServices,
  loadSettings,
  mapChapter,
  mapCharacter,
  mapProject,
} from "@/lib/data";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const conn = await getDb();
    const chapterRow = await conn("chapters").where({ id }).first();
    if (!chapterRow) throw new ApiError("chapterNotFound", 404);
    const projectRow = await conn("projects").where({ id: chapterRow.project_id }).first();
    const allCharacterRows = await conn("characters")
      .where({ project_id: chapterRow.project_id })
      .orderBy("created_at", "asc");
    const links = await conn("chapter_characters").where({ chapter_id: id });
    const characterIds = links.map((link) => String(link.character_id));
    const selected =
      chapterRow.character_mode === "selected"
        ? allCharacterRows.filter((character) => characterIds.includes(String(character.id)))
        : allCharacterRows;
    return ok({
      chapter: mapChapter(chapterRow, characterIds),
      project: mapProject(projectRow),
      characters: selected.map(mapCharacter),
      allCharacters: allCharacterRows.map(mapCharacter),
      blocks: await loadBlocks(id),
      settings: await loadSettings(),
      services: await loadServices(),
    });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await jsonBody<{
      title?: string;
      synopsis?: string;
      characterMode?: "all" | "selected";
      characterIds?: string[];
      move?: "up" | "down";
    }>(request);
    const conn = await getDb();
    await conn.transaction(async (trx) => {
      if (body.move) {
        const current = await trx("chapters").where({ id }).first();
        if (!current) throw new ApiError("chapterNotFound", 404);
        const siblingQuery = trx("chapters").where({ project_id: current.project_id });
        const sibling =
          body.move === "up"
            ? await siblingQuery
                .clone()
                .andWhere("sort_order", "<", current.sort_order)
                .orderBy("sort_order", "desc")
                .first()
            : await siblingQuery
                .clone()
                .andWhere("sort_order", ">", current.sort_order)
                .orderBy("sort_order", "asc")
                .first();
        if (sibling) {
          await trx("chapters")
            .where({ id: current.id })
            .update({ sort_order: sibling.sort_order, updated_at: trx.fn.now() });
          await trx("chapters")
            .where({ id: sibling.id })
            .update({ sort_order: current.sort_order, updated_at: trx.fn.now() });
        }
      }
      const update: Record<string, unknown> = { updated_at: trx.fn.now() };
      if (body.title !== undefined)
        update.title = body.title.trim() || (await apiDefault("unnamedChapter"));
      if (body.synopsis !== undefined) update.synopsis = body.synopsis;
      if (body.characterMode !== undefined) update.character_mode = body.characterMode;
      if (!(await trx("chapters").where({ id }).update(update)))
        throw new ApiError("chapterNotFound", 404);
      if (body.characterIds !== undefined) {
        await trx("chapter_characters").where({ chapter_id: id }).delete();
        if (body.characterIds.length)
          await trx("chapter_characters").insert(
            body.characterIds.map((characterId) => ({ chapter_id: id, character_id: characterId })),
          );
      }
    });
    const row = await conn("chapters").where({ id }).first();
    const links = await conn("chapter_characters").where({ chapter_id: id });
    return ok(
      mapChapter(
        row,
        links.map((link) => String(link.character_id)),
      ),
    );
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const conn = await getDb();
    if (!(await conn("chapters").where({ id }).delete()))
      throw new ApiError("chapterNotFound", 404);
    return ok({ success: true });
  } catch (error) {
    return fail(error);
  }
}
