import { fail, jsonBody, ok } from "@/lib/api";
import { deleteCharacterChatMessage, updateCharacterChatMessage } from "@/lib/character-chat";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await jsonBody<{ content: string }>(request);
    await updateCharacterChatMessage(id, body.content);
    return ok({ success: true });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await deleteCharacterChatMessage(id);
    return ok({ success: true });
  } catch (error) {
    return fail(error);
  }
}
