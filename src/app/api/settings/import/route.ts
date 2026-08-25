import { ApiError, fail, ok } from "@/lib/api";
import { importSettingsTransfer } from "@/lib/settings-transfer";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const text = await request.text();
    if (text.length > 2_000_000) throw new ApiError("settingsImportTooLarge");
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new ApiError("invalidSettingsImport");
    }
    return ok(await importSettingsTransfer(body));
  } catch (error) {
    return fail(error);
  }
}
