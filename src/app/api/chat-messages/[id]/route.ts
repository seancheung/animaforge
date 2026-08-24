import { fail, ok } from "@/lib/api";
import { deleteCharacterChatMessage } from "@/lib/character-chat";

export const runtime = "nodejs";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await deleteCharacterChatMessage(id);
    return ok({ success: true });
  } catch (error) {
    return fail(error);
  }
}
