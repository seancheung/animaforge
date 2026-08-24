import { fail, jsonBody, ok } from "@/lib/api";
import { createProjectReview, loadProjectReviews } from "@/lib/project-review";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return ok(await loadProjectReviews(id));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await jsonBody<{
      reviewerId?: string;
      modelId?: string | null;
      chapterId?: string | null;
    }>(request);
    return ok(await createProjectReview(id, body.reviewerId ?? "", body.modelId, body.chapterId), {
      status: 201,
    });
  } catch (error) {
    return fail(error);
  }
}
