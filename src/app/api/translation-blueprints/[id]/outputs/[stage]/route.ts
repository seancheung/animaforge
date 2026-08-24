import { ApiError, fail, ok } from "@/lib/api";
import { getDb } from "@/lib/db";
import { loadTranslationOutput, TRANSLATION_STAGES } from "@/lib/translation";
import type { TranslationStage } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: RouteContext<"/api/translation-blueprints/[id]/outputs/[stage]">,
) {
  try {
    const { id, stage: rawStage } = await params;
    const stage = rawStage as TranslationStage;
    if (!TRANSLATION_STAGES.includes(stage)) throw new ApiError("translationStageInvalid", 400);
    const output = await loadTranslationOutput(id, stage);
    if (new URL(request.url).searchParams.get("download") !== "1") return ok(output);
    const conn = await getDb();
    const row = (await conn("translation_blueprints as blueprints")
      .join("translation_projects as projects", "blueprints.project_id", "projects.id")
      .where("blueprints.id", id)
      .select(
        "blueprints.name",
        "projects.source_format",
        "projects.source_line_ending",
        "projects.source_has_bom",
      )
      .first()) as Record<string, unknown> | undefined;
    if (!row) throw new ApiError("translationBlueprintNotFound", 404);
    const ending =
      row.source_line_ending === "crlf" ? "\r\n" : row.source_line_ending === "cr" ? "\r" : "\n";
    const normalized = output.content
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/\n/g, ending);
    const content = `${row.source_has_bom ? "\ufeff" : ""}${normalized}`;
    const ext = row.source_format === "md" ? "md" : "txt";
    const filename = `${String(row.name).replace(/[\\/:*?"<>|]/g, "_")}.${stage}.${ext}`;
    return new Response(content, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  } catch (error) {
    return fail(error);
  }
}
