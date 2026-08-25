import { fail, jsonBody, ok } from "@/lib/api";
import { cloneProjectTransfer } from "@/lib/project-transfer";
import {
  allProjectTransferSections,
  type ProjectTransferSelection,
} from "@/lib/project-transfer-selection";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: RouteContext<"/api/projects/[id]/clone">) {
  try {
    const { id } = await params;
    const body = await jsonBody<{
      name?: string;
      selection?: Partial<ProjectTransferSelection>;
    }>(request);
    return ok(
      await cloneProjectTransfer(id, body.name ?? "", body.selection ?? allProjectTransferSections),
      { status: 201 },
    );
  } catch (error) {
    return fail(error);
  }
}
