import { ApiError, apiDefault, fail, jsonBody, ok } from "@/lib/api";
import { loadServices } from "@/lib/data";
import { getDb } from "@/lib/db";
import type { LlmServiceType } from "@/lib/types";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await jsonBody<{
      name?: string;
      type?: LlmServiceType;
      baseUrl?: string;
      apiKey?: string;
    }>(request);
    const conn = await getDb();
    const update: Record<string, unknown> = { updated_at: conn.fn.now() };
    if (body.name !== undefined)
      update.name = body.name.trim() || (await apiDefault("unnamedService"));
    if (body.type !== undefined) update.type = body.type;
    if (body.baseUrl !== undefined) update.base_url = body.baseUrl.trim();
    if (body.apiKey !== undefined) update.api_key = body.apiKey;
    if (!(await conn("llm_services").where({ id }).update(update)))
      throw new ApiError("serviceNotFound", 404);
    return ok((await loadServices()).find((service) => service.id === id));
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const conn = await getDb();
    if (!(await conn("llm_services").where({ id }).delete()))
      throw new ApiError("serviceNotFound", 404);
    return ok({ success: true });
  } catch (error) {
    return fail(error);
  }
}
