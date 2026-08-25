import { fail, jsonBody, ok } from "@/lib/api";
import { cloneProjectRevisionBlueprint } from "@/lib/project-revision";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/revisions/[id]/clone">,
) {
  try {
    const { id } = await params;
    const body = await jsonBody<{ name?: string }>(request);
    return ok(await cloneProjectRevisionBlueprint(id, body.name), { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
