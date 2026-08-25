import { fail, jsonBody, ok } from "@/lib/api";
import { createProjectRevision, loadProjectRevisions } from "@/lib/project-revision";
import type { ProjectRevisionSource } from "@/lib/types";

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
    const body = await jsonBody<{
      reviewId?: string | null;
      sourceType?: ProjectRevisionSource;
      name?: string;
      requirements?: string;
      styleFingerprintId?: string | null;
    }>(request);
    return ok(
      await createProjectRevision(
        id,
        body.sourceType === "review" || body.sourceType === "style" ? body.sourceType : "custom",
        body.reviewId ?? "",
        body.name ?? "",
        body.requirements ?? "",
        body.styleFingerprintId ?? "",
      ),
      { status: 201 },
    );
  } catch (error) {
    return fail(error);
  }
}
