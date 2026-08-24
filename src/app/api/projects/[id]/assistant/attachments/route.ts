import path from "node:path";
import { ApiError, fail, ok } from "@/lib/api";
import {
  assistantScopeSchema,
  ensureAssistantConversation,
  loadAssistantConversation,
} from "@/lib/assistant";
import { getDb, newId } from "@/lib/db";

export const runtime = "nodejs";

const allowedExtensions = new Set([".txt", ".md", ".markdown", ".json", ".csv"]);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await params;
    const form = await request.formData();
    const file = form.get("file");
    const scopeResult = assistantScopeSchema.safeParse(form.get("scope"));
    if (!(file instanceof File)) throw new ApiError("attachmentRequired");
    if (!scopeResult.success) throw new ApiError("invalidAssistantScope");
    const contextId =
      scopeResult.data === "chapter" ? String(form.get("contextId") ?? "").trim() : null;
    if (scopeResult.data === "chapter" && !contextId) throw new ApiError("assistantContextMissing");
    if (!allowedExtensions.has(path.extname(file.name).toLowerCase()))
      throw new ApiError("attachmentType");
    if (file.size > 2 * 1024 * 1024) throw new ApiError("attachmentTooLarge");
    const content = await file.text();
    if (!content.trim()) throw new ApiError("attachmentEmpty");
    const conversation = await ensureAssistantConversation(projectId, scopeResult.data, contextId);
    const conn = await getDb();
    await conn("assistant_attachments").insert({
      id: newId(),
      conversation_id: conversation.id,
      name: file.name,
      mime_type: file.type || "text/plain",
      size_bytes: file.size,
      content,
    });
    await conn("assistant_conversations")
      .where({ id: conversation.id })
      .update({ updated_at: conn.fn.now() });
    return ok(await loadAssistantConversation(projectId, scopeResult.data, contextId), {
      status: 201,
    });
  } catch (error) {
    return fail(error);
  }
}
