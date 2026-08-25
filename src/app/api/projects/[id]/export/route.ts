import { ApiError, fail, ok } from "@/lib/api";
import { buildProjectManuscript, buildProjectTransfer } from "@/lib/project-transfer";
import {
  allProjectTransferSections,
  normalizeProjectTransferSelection,
  projectTransferSectionKeys,
} from "@/lib/project-transfer-selection";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const search = new URL(request.url).searchParams;
    const format = search.get("format") ?? "project";
    if (format === "project") {
      const included = search.get("include");
      const selection = included
        ? normalizeProjectTransferSelection(
            Object.fromEntries(
              projectTransferSectionKeys.map((key) => [key, included.split(",").includes(key)]),
            ),
          )
        : allProjectTransferSections;
      return ok(await buildProjectTransfer(id, selection));
    }
    if (format !== "txt" && format !== "markdown") {
      throw new ApiError("invalidProjectExportFormat");
    }
    const manuscript = await buildProjectManuscript(id, format);
    return new Response(`\uFEFF${manuscript.content}`, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (error) {
    return fail(error);
  }
}
