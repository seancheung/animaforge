import { fail, jsonBody, ok } from "@/lib/api";
import { createGeneratedBlueprint } from "@/lib/translation";
import type { TranslationStageConfig } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/translations/[id]/blueprints">,
) {
  try {
    const { id } = await params;
    const body = await jsonBody<{
      name?: string;
      targetLanguage?: string;
      instructions?: string;
      generationModelId?: string | null;
      stageConfig?: TranslationStageConfig[];
    }>(request);
    return ok(
      await createGeneratedBlueprint(id, {
        name: body.name,
        targetLanguage: body.targetLanguage ?? "",
        instructions: body.instructions,
        generationModelId: body.generationModelId,
        stageConfig: body.stageConfig,
      }),
      { status: 201 },
    );
  } catch (error) {
    return fail(error);
  }
}
