import { apiDefault, fail, jsonBody, ok } from "@/lib/api";
import { loadServices } from "@/lib/data";
import { getDb, newId } from "@/lib/db";
import type { LlmServiceType } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await jsonBody<{
      name?: string;
      type?: LlmServiceType;
      baseUrl?: string;
      apiKey?: string;
    }>(request);
    const conn = await getDb();
    const id = newId();
    await conn("llm_services").insert({
      id,
      name: body.name?.trim() || (await apiDefault("newService")),
      type: body.type === "anthropic" ? "anthropic" : "openai",
      base_url:
        body.baseUrl?.trim() ||
        (body.type === "anthropic" ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1"),
      api_key: body.apiKey || "",
    });
    return ok(
      (await loadServices()).find((service) => service.id === id),
      { status: 201 },
    );
  } catch (error) {
    return fail(error);
  }
}
