import { ApiError, fail, jsonBody, ok } from "@/lib/api";
import { loadServices } from "@/lib/data";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

type ModelBody = {
  modelId?: string;
  displayName?: string;
  contextWindowK?: number;
  customBody?: string;
  inputPrice?: number | null;
  cacheReadPrice?: number | null;
  cacheWritePrice?: number | null;
  outputPrice?: number | null;
};
const price = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const contextWindowK = (value: number) => Math.max(1, Math.round(value));

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await jsonBody<ModelBody>(request);
    const conn = await getDb();
    const update: Record<string, unknown> = {};
    if (body.modelId !== undefined) update.model_id = body.modelId.trim();
    if (body.displayName !== undefined) update.display_name = body.displayName.trim();
    if (body.contextWindowK !== undefined && Number.isFinite(body.contextWindowK))
      update.context_window_k = contextWindowK(body.contextWindowK);
    if (body.customBody !== undefined) {
      const customBody = body.customBody.trim();
      if (customBody) JSON.parse(customBody);
      update.custom_body = customBody;
    }
    if (body.inputPrice !== undefined) update.input_price = price(body.inputPrice);
    if (body.cacheReadPrice !== undefined) update.cache_read_price = price(body.cacheReadPrice);
    if (body.cacheWritePrice !== undefined) update.cache_write_price = price(body.cacheWritePrice);
    if (body.outputPrice !== undefined) update.output_price = price(body.outputPrice);
    if (!(await conn("llm_models").where({ id }).update(update)))
      throw new ApiError("modelNotFound", 404);
    return ok(
      (await loadServices()).flatMap((service) => service.models).find((model) => model.id === id),
    );
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const conn = await getDb();
    if (!(await conn("llm_models").where({ id }).delete()))
      throw new ApiError("modelNotFound", 404);
    return ok({ success: true });
  } catch (error) {
    return fail(error);
  }
}
