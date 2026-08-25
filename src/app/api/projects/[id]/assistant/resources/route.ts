import { ApiError, fail, ok } from "@/lib/api";
import { assistantScopeSchema } from "@/lib/assistant";
import { listAssistantResources } from "@/lib/assistant-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const search = new URL(request.url).searchParams;
    const scope = assistantScopeSchema.safeParse(search.get("scope") ?? "project");
    if (!scope.success) throw new ApiError("invalidAssistantScope");
    const contextId = scope.data === "chapter" ? search.get("contextId") : null;
    if (scope.data === "chapter" && !contextId) throw new ApiError("assistantContextMissing");
    return ok(await listAssistantResources(id, scope.data, search.get("q") ?? "", contextId));
  } catch (error) {
    return fail(error);
  }
}
