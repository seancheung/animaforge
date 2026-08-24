import { fail, ok } from "@/lib/api";
import { deleteProjectRevision, loadProjectRevision } from "@/lib/project-revision";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return ok(await loadProjectRevision(id));
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await deleteProjectRevision(id);
    return ok({ success: true });
  } catch (error) {
    return fail(error);
  }
}
