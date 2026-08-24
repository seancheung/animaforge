import { apiDefault, fail, jsonBody, ok } from "@/lib/api";
import { loadServices } from "@/lib/data";
import { getDb, newId } from "@/lib/db";

export const runtime = "nodejs";

type ModelBody = {
  serviceId: string;
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
const contextWindowK = (value: number | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(1, Math.round(value)) : 128;

export async function POST(request: Request) {
  try {
    const body = await jsonBody<ModelBody>(request);
    const conn = await getDb();
    const id = newId();
    const customBody = body.customBody?.trim() || "";
    if (customBody) JSON.parse(customBody);
    await conn("llm_models").insert({
      id,
      service_id: body.serviceId,
      model_id: body.modelId?.trim() || "model-id",
      display_name:
        body.displayName?.trim() || body.modelId?.trim() || (await apiDefault("newModel")),
      context_window_k: contextWindowK(body.contextWindowK),
      custom_body: customBody,
      input_price: price(body.inputPrice),
      cache_read_price: price(body.cacheReadPrice),
      cache_write_price: price(body.cacheWritePrice),
      output_price: price(body.outputPrice),
    });
    const services = await loadServices();
    return ok(
      services.flatMap((service) => service.models).find((model) => model.id === id),
      { status: 201 },
    );
  } catch (error) {
    return fail(error);
  }
}
