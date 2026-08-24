import { fail, ok } from "@/lib/api";
import { loadUsageReport } from "@/lib/usage-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const search = new URL(request.url).searchParams;
    const rawDays = search.get("days") ?? "30";
    const requested = Number(rawDays);
    const days =
      rawDays === "all"
        ? null
        : Number.isFinite(requested)
          ? Math.min(3650, Math.max(1, Math.round(requested)))
          : 30;
    const projectKind = search.get("projectKind");
    const projectId = search.get("projectId")?.trim();
    let project: { kind: "creative" | "translation"; id: string } | undefined;
    if (projectId && (projectKind === "creative" || projectKind === "translation"))
      project = { kind: projectKind, id: projectId };
    return ok(await loadUsageReport(days, project));
  } catch (error) {
    return fail(error);
  }
}
