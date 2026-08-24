import { fail, jsonBody, ok } from "@/lib/api";
import { createProjectRevision, loadProjectRevisions } from "@/lib/project-revision";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return ok(await loadProjectRevisions(id));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await jsonBody<{ reviewId?: string | null; name?: string; requirements?: string }>(
      request,
    );
    return ok(
      await createProjectRevision(
        id,
        body.reviewId ?? "",
        body.name ?? "",
        body.requirements ?? "",
      ),
      { status: 201 },
    );
  } catch (error) {
    return fail(error);
  }
}
