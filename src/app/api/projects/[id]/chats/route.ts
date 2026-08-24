import { fail, jsonBody, ok } from "@/lib/api";
import { createCharacterChat, loadProjectCharacterChats } from "@/lib/character-chat";
import type { CharacterChatContextSettings } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return ok(await loadProjectCharacterChats(id));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await jsonBody<{
      memberIds?: string[];
      userCharacterId?: string | null;
      contextSettings?: Partial<CharacterChatContextSettings>;
    }>(request);
    return ok(
      await createCharacterChat(
        id,
        body.memberIds ?? [],
        body.userCharacterId,
        body.contextSettings,
      ),
      { status: 201 },
    );
  } catch (error) {
    return fail(error);
  }
}
