import { ApiError, fail, jsonBody, localizeApiError, ok } from "@/lib/api";
import {
  assistantScopeSchema,
  generateAssistantResponse,
  loadAssistantConversation,
  persistAssistantResponse,
  persistAssistantUserMessage,
} from "@/lib/assistant";
import { getDb } from "@/lib/db";
import type { AssistantResourceRef, AssistantScope } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function readTarget(request: Request): { scope: AssistantScope; contextId: string | null } {
  const search = new URL(request.url).searchParams;
  const value = search.get("scope") ?? "project";
  const parsed = assistantScopeSchema.safeParse(value);
  if (!parsed.success) throw new ApiError("invalidAssistantScope");
  const contextId = parsed.data === "chapter" ? search.get("contextId") : null;
  if (parsed.data === "chapter" && !contextId) throw new ApiError("assistantContextMissing");
  return { scope: parsed.data, contextId };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const target = readTarget(request);
    return ok(await loadAssistantConversation(id, target.scope, target.contextId));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await jsonBody<{
      scope?: AssistantScope;
      contextId?: string;
      content?: string;
      references?: AssistantResourceRef[];
    }>(request);
    const scopeResult = assistantScopeSchema.safeParse(body.scope ?? "project");
    if (!scopeResult.success) throw new ApiError("invalidAssistantScope");
    const contextId = scopeResult.data === "chapter" ? body.contextId?.trim() : null;
    if (scopeResult.data === "chapter" && !contextId) throw new ApiError("assistantContextMissing");
    const content = body.content?.trim();
    if (!content) throw new ApiError("messageRequired");
    if (content.length > 12000) throw new ApiError("messageTooLong");
    const allowedTypes = new Set(["chapter", "block", "character", "attachment"]);
    const references = Array.isArray(body.references)
      ? body.references
          .filter(
            (reference) =>
              reference &&
              allowedTypes.has(reference.type) &&
              typeof reference.id === "string" &&
              typeof reference.label === "string",
          )
          .slice(0, 12)
      : [];
    const userMessageId = await persistAssistantUserMessage(
      id,
      scopeResult.data,
      contextId,
      content,
      references,
    );
    const encoder = new TextEncoder();
    const abortController = new AbortController();
    const abortUpstream = () => abortController.abort(request.signal.reason);
    if (request.signal.aborted) abortUpstream();
    else request.signal.addEventListener("abort", abortUpstream, { once: true });
    let closed = false;
    const cleanup = () => request.signal.removeEventListener("abort", abortUpstream);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (event: Record<string, unknown>) => {
          if (closed || abortController.signal.aborted) return;
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          } catch {
            closed = true;
            abortController.abort();
          }
        };
        send({ type: "user_ack", messageId: userMessageId });
        void (async () => {
          try {
            const generated = await generateAssistantResponse(
              id,
              scopeResult.data,
              contextId,
              content,
              references,
              userMessageId,
              {
                signal: abortController.signal,
                onReplyDelta: (text) => send({ type: "delta", text }),
                onReplyComplete: () => send({ type: "proposal_pending" }),
                onActivity: (activity) => send({ type: "activity", activity }),
              },
            );
            abortController.signal.throwIfAborted();
            await persistAssistantResponse(id, scopeResult.data, contextId, generated);
            abortController.signal.throwIfAborted();
            send({
              type: "done",
              conversation: await loadAssistantConversation(id, scopeResult.data, contextId),
            });
          } catch (error) {
            if (!abortController.signal.aborted && !isAbortError(error)) {
              console.error(error);
              send({ type: "error", error: await localizeApiError(error) });
            }
          } finally {
            cleanup();
            if (!closed) {
              closed = true;
              try {
                controller.close();
              } catch {
                /* The client already cancelled the stream. */
              }
            }
          }
        })();
      },
      cancel() {
        closed = true;
        cleanup();
        abortController.abort();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const target = readTarget(request);
    const conn = await getDb();
    await conn("assistant_conversations")
      .where({ project_id: id, scope: target.scope, context_id: target.contextId ?? "" })
      .delete();
    return ok({ success: true });
  } catch (error) {
    return fail(error);
  }
}
