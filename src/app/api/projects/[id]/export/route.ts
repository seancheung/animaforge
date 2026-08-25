import { ApiError, fail, ok } from "@/lib/api";
import { buildProjectManuscript, buildProjectTransfer } from "@/lib/project-transfer";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const format = new URL(request.url).searchParams.get("format") ?? "project";
    if (format === "project") return ok(await buildProjectTransfer(id));
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
