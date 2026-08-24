import { fail, jsonBody, ok } from "@/lib/api";
import { cloneTranslationBlueprint } from "@/lib/translation";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/translation-blueprints/[id]/clone">,
) {
  try {
    const { id } = await params;
    const body = await jsonBody<{ name?: string }>(request);
    return ok(await cloneTranslationBlueprint(id, body.name), { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
