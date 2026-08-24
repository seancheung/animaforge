import { ApiError, fail, jsonBody, ok } from "@/lib/api";
import { controlTranslationJob } from "@/lib/translation";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/translation-blueprints/[id]/control">,
) {
  try {
    const { id } = await params;
    const body = await jsonBody<{ action?: "pause" | "resume" | "cancel" }>(request);
    if (!body.action || !["pause", "resume", "cancel"].includes(body.action))
      throw new ApiError("translationJobControlInvalid", 400);
    return ok(await controlTranslationJob(id, body.action));
  } catch (error) {
    return fail(error);
  }
}
