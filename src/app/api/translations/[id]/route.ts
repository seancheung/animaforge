import { fail, jsonBody, ok } from "@/lib/api";
import {
  deleteTranslationProject,
  loadTranslationProject,
  updateTranslationProject,
} from "@/lib/translation";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: RouteContext<"/api/translations/[id]">) {
  try {
    const { id } = await params;
    return ok(await loadTranslationProject(id, false));
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request, { params }: RouteContext<"/api/translations/[id]">) {
  try {
    const { id } = await params;
    const body = await jsonBody<{ name?: string }>(request);
    return ok(await updateTranslationProject(id, body.name ?? ""));
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: RouteContext<"/api/translations/[id]">,
) {
  try {
    const { id } = await params;
    await deleteTranslationProject(id);
    return ok({ success: true });
  } catch (error) {
    return fail(error);
  }
}
