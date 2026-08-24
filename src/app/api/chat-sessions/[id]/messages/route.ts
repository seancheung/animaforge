import { fail, jsonBody, localizeApiError } from "@/lib/api";
import { runCharacterChatTurn } from "@/lib/character-chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await jsonBody<{ content?: string; characterIds?: string[] }>(request);
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
        void (async () => {
          try {
            const chat = await runCharacterChatTurn(id, body, abortController.signal, {
              onAuthorMessage: (message) => send({ type: "author_message", message }),
              onCharacterStart: (message) => send({ type: "character_start", message }),
              onCharacterDelta: (messageId, text) =>
                send({ type: "character_delta", messageId, text }),
              onCharacterComplete: (message) => send({ type: "character_done", message }),
            });
            abortController.signal.throwIfAborted();
            send({ type: "done", chat });
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
