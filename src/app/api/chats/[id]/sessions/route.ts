import { fail, ok } from "@/lib/api";
import { createCharacterChatSession } from "@/lib/character-chat";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return ok(await createCharacterChatSession(id), { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
