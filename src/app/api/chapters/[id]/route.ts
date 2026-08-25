import { ApiError, apiDefault, fail, jsonBody, ok } from "@/lib/api";
import {
  loadBlocks,
  loadEntities,
  loadEntityRelations,
  loadServices,
  loadSettings,
  loadStyleFingerprint,
  mapChapter,
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
    const [allEntities, allRelations, links] = await Promise.all([
      loadEntities(String(chapterRow.project_id)),
      loadEntityRelations(String(chapterRow.project_id)),
      conn("chapter_entities").where({ chapter_id: id }),
    ]);
    const entityIds = links.map((link) => String(link.entity_id));
    const seedIds = new Set(
      allEntities
        .filter(
          (entity) =>
            entity.alwaysInclude ||
            chapterRow.entity_mode === "all" ||
            entityIds.includes(entity.id),
        )
        .map((entity) => entity.id),
    );
    const relations = allRelations.filter(
      (relation) =>
        relation.alwaysInclude ||
        seedIds.has(relation.sourceEntityId) ||
        seedIds.has(relation.targetEntityId),
    );
    relations.forEach((relation) => {
      seedIds.add(relation.sourceEntityId);
      seedIds.add(relation.targetEntityId);
    });
    const project = mapProject(projectRow);
    return ok({
      chapter: mapChapter(chapterRow, entityIds),
      project,
      styleFingerprint: await loadStyleFingerprint(project.styleFingerprintId),
      entities: allEntities.filter((entity) => seedIds.has(entity.id)),
      allEntities,
      relations,
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
      entityMode?: "all" | "selected";
      entityIds?: string[];
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
      if (body.entityMode !== undefined) update.entity_mode = body.entityMode;
      if (!(await trx("chapters").where({ id }).update(update)))
        throw new ApiError("chapterNotFound", 404);
      if (body.entityIds !== undefined) {
        if (
          !Array.isArray(body.entityIds) ||
          body.entityIds.some((entityId) => typeof entityId !== "string")
        )
          throw new ApiError("entityNotFound", 404);
        const entityIds = [...new Set(body.entityIds)];
        const chapter = await trx("chapters").where({ id }).first();
        const validEntities = entityIds.length
          ? await trx("entities").where({ project_id: chapter.project_id }).whereIn("id", entityIds)
          : [];
        if (validEntities.length !== entityIds.length) throw new ApiError("entityNotFound", 404);
        await trx("chapter_entities").where({ chapter_id: id }).delete();
        if (entityIds.length)
          await trx("chapter_entities").insert(
            entityIds.map((entityId) => ({ chapter_id: id, entity_id: entityId })),
          );
      }
    });
    const row = await conn("chapters").where({ id }).first();
    const links = await conn("chapter_entities").where({ chapter_id: id });
    return ok(
      mapChapter(
        row,
        links.map((link) => String(link.entity_id)),
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
