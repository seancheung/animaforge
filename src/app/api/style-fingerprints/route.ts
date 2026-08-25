import { ApiError, fail, jsonBody, ok } from "@/lib/api";
import { loadStyleFingerprints, mapStyleFingerprint } from "@/lib/data";
import { getDb, newId } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    return ok(await loadStyleFingerprints());
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await jsonBody<{ name?: string; config?: string }>(request);
    const name = body.name?.trim() ?? "";
    const config = body.config?.trim() ?? "";
    if (!name || !config) throw new ApiError("styleFingerprintFieldsRequired", 400);
    const conn = await getDb();
    const id = newId();
    await conn("style_fingerprints").insert({ id, name, config });
    return ok(mapStyleFingerprint(await conn("style_fingerprints").where({ id }).first()), {
      status: 201,
    });
  } catch (error) {
    return fail(error);
  }
}
