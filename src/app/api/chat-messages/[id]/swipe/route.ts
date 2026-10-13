import { fail, jsonBody, ok } from "@/lib/api";
import { selectCharacterChatSwipe } from "@/lib/character-chat";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await jsonBody<{ index: number }>(request);
    await selectCharacterChatSwipe(id, body.index);
    return ok({ success: true });
  } catch (error) {
    return fail(error);
  }
}
