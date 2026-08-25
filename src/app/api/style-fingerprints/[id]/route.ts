import { ApiError, fail, jsonBody, ok } from "@/lib/api";
import { mapStyleFingerprint } from "@/lib/data";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await jsonBody<{ name?: string; config?: string }>(request);
    const update: Record<string, unknown> = {};
    if (body.name !== undefined) update.name = body.name.trim();
    if (body.config !== undefined) update.config = body.config.trim();
    if ((body.name !== undefined && !update.name) || (body.config !== undefined && !update.config))
      throw new ApiError("styleFingerprintFieldsRequired", 400);
    const conn = await getDb();
    update.updated_at = conn.fn.now();
    if (!(await conn("style_fingerprints").where({ id }).update(update)))
      throw new ApiError("styleFingerprintNotFound", 404);
    return ok(mapStyleFingerprint(await conn("style_fingerprints").where({ id }).first()));
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const conn = await getDb();
    if (!(await conn("style_fingerprints").where({ id }).delete()))
      throw new ApiError("styleFingerprintNotFound", 404);
    return ok({ success: true });
  } catch (error) {
    return fail(error);
  }
}
