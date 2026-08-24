import { fail, ok } from "@/lib/api";
import { startTranslationExecution } from "@/lib/translation";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: RouteContext<"/api/translation-blueprints/[id]/execute">,
) {
  try {
    const { id } = await params;
    return ok(await startTranslationExecution(id), { status: 202 });
  } catch (error) {
    return fail(error);
  }
}
