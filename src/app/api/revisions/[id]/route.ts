import { fail, jsonBody, ok } from "@/lib/api";
import {
  deleteProjectRevision,
  loadProjectRevision,
  renameProjectRevision,
} from "@/lib/project-revision";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return ok(await loadProjectRevision(id));
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await jsonBody<{ name?: string }>(request);
    return ok(await renameProjectRevision(id, body.name ?? ""));
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
