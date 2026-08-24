import { fail, ok } from "@/lib/api";
import { deleteProjectReview, loadProjectReview } from "@/lib/project-review";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return ok(await loadProjectReview(id));
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await deleteProjectReview(id);
    return ok({ success: true });
  } catch (error) {
    return fail(error);
  }
}
