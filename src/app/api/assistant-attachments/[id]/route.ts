import { ApiError, fail, ok } from "@/lib/api";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const conn = await getDb();
    if (!(await conn("assistant_attachments").where({ id }).delete()))
      throw new ApiError("attachmentNotFound", 404);
    return ok({ success: true });
  } catch (error) {
    return fail(error);
  }
}
