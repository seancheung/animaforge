import { fail, jsonBody, ok } from "@/lib/api";
import { loadCharacterChat, updateCharacterChatContext } from "@/lib/character-chat";
import type { CharacterChatContextSettings } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const sessionId = new URL(request.url).searchParams.get("session");
    return ok(await loadCharacterChat(id, sessionId));
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await jsonBody<{ contextSettings?: Partial<CharacterChatContextSettings> }>(
      request,
    );
    return ok(await updateCharacterChatContext(id, body.contextSettings));
  } catch (error) {
    return fail(error);
  }
}
