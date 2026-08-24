import { ApiError, fail, ok } from "@/lib/api";
import { createTranslationProject, loadTranslationProjects } from "@/lib/translation";

export const runtime = "nodejs";

export async function GET() {
  try {
    return ok(await loadTranslationProjects());
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new ApiError("translationFileRequired", 400);
    if (file.size > 10 * 1024 * 1024) throw new ApiError("translationFileTooLarge", 400);
    const lowerName = file.name.toLowerCase();
    const sourceFormat =
      lowerName.endsWith(".md") || lowerName.endsWith(".markdown")
        ? "md"
        : lowerName.endsWith(".txt")
          ? "txt"
          : null;
    if (!sourceFormat) throw new ApiError("translationFileType", 400);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sourceHasBom =
      bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
    let raw: string;
    try {
      raw = new TextDecoder("utf-8", { fatal: true }).decode(sourceHasBom ? bytes.slice(3) : bytes);
    } catch {
      throw new ApiError("translationFileEncoding", 400);
    }
    if (!raw.trim()) throw new ApiError("translationFileEmpty", 400);
    const sourceLineEnding = raw.includes("\r\n") ? "crlf" : raw.includes("\r") ? "cr" : "lf";
    const sourceContent = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    return ok(
      await createTranslationProject({
        name: String(form.get("name") ?? ""),
        sourceFileName: file.name,
        sourceFormat,
        sourceLanguage: String(form.get("sourceLanguage") ?? ""),
        sourceContent,
        sourceHasBom,
        sourceLineEnding,
      }),
      { status: 201 },
    );
  } catch (error) {
    return fail(error);
  }
}
