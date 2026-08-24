import { fail, ok } from "@/lib/api";
import { loadTranslationSourceContent } from "@/lib/translation";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/translations/[id]/source">,
) {
  try {
    const { id } = await params;
    return ok({ content: await loadTranslationSourceContent(id) });
  } catch (error) {
    return fail(error);
  }
}
