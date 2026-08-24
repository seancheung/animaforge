import { localizeApiError } from "@/lib/api";
import { generateProjectRevisionBlueprint } from "@/lib/project-revision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    modelId?: string | null;
    requirements?: string;
  };
  const encoder = new TextEncoder();
  const abortController = new AbortController();
  const abort = () => abortController.abort(request.signal.reason);
  if (request.signal.aborted) abort();
  else request.signal.addEventListener("abort", abort, { once: true });

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (value: unknown) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
      void generateProjectRevisionBlueprint(
        id,
        body.modelId,
        body.requirements ?? "",
        abortController.signal,
        (text) => send({ type: "delta", text }),
        (text) => send({ type: "reasoning_delta", text }),
      )
        .then(() => send({ type: "complete" }))
        .catch(async (error) => {
          if (!abortController.signal.aborted) {
            try {
              send({ type: "error", message: await localizeApiError(error) });
            } catch {
              /* The client disconnected. */
            }
          }
        })
        .finally(() => {
          request.signal.removeEventListener("abort", abort);
          try {
            controller.close();
          } catch {
            /* The client disconnected. */
          }
        });
    },
    cancel() {
      abortController.abort();
      request.signal.removeEventListener("abort", abort);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
