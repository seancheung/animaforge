import { ApiError, fail, ok } from "@/lib/api";
import { importProjectTransfer } from "@/lib/project-transfer";

export const runtime = "nodejs";

const maxImportBytes = 50_000_000;

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > maxImportBytes) throw new ApiError("projectImportTooLarge", 413);
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > maxImportBytes) {
      throw new ApiError("projectImportTooLarge", 413);
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new ApiError("invalidProjectImport");
    }
    return ok(await importProjectTransfer(body), { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
