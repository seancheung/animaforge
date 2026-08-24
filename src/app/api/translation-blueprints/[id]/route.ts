import { fail, jsonBody, ok } from "@/lib/api";
import {
  deleteTranslationBlueprint,
  loadTranslationBlueprint,
  updateTranslationBlueprint,
} from "@/lib/translation";
import type { TranslationStageConfig } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/translation-blueprints/[id]">,
) {
  try {
    const { id } = await params;
    return ok(await loadTranslationBlueprint(id));
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: RouteContext<"/api/translation-blueprints/[id]">,
) {
  try {
    const { id } = await params;
    const body = await jsonBody<{
      name?: string;
      targetLanguage?: string;
      instructions?: string;
      content?: string;
      generationModelId?: string | null;
      stageConfig?: TranslationStageConfig[];
    }>(request);
    return ok(await updateTranslationBlueprint(id, body));
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: RouteContext<"/api/translation-blueprints/[id]">,
) {
  try {
    const { id } = await params;
    await deleteTranslationBlueprint(id);
    return ok({ success: true });
  } catch (error) {
    return fail(error);
  }
}
