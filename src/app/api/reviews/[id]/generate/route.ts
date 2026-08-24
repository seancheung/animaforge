import { ApiError, fail } from "@/lib/api";
import { parseJson } from "@/lib/db";
import {
  finishProjectReviewGeneration,
  prepareProjectReviewGeneration,
} from "@/lib/project-review";
import { openAiStreamOptions, TokenUsageTracker } from "@/lib/token-usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function reviewTextStream(
  response: Response,
  provider: "openai" | "anthropic",
  reviewId: string,
  usage: TokenUsageTracker,
) {
  if (!response.body) throw new ApiError("modelNoData", 502);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let content = "";

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            if (buffer.trim()) processLine(buffer);
            const result = content.trim();
            await finishProjectReviewGeneration(reviewId, result, result ? "completed" : "failed");
            await usage.commit();
            controller.close();
            return;
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? "";
          for (const line of lines) processLine(line);
          if (lines.length) return;
        }
      } catch (error) {
        await finishProjectReviewGeneration(reviewId, content.trim(), "failed");
        await usage.commit();
        controller.error(error);
      }

      function processLine(line: string) {
        if (!line.startsWith("data:")) return;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") return;
        try {
          const event = JSON.parse(data);
          usage.observe(event);
          const text =
            provider === "openai"
              ? event.choices?.[0]?.delta?.content
              : event.type === "content_block_delta"
                ? event.delta?.text
                : undefined;
          if (typeof text === "string" && text) {
            content += text;
            usage.collectOutput(text);
            controller.enqueue(encoder.encode(text));
          }
        } catch {
          // Ignore keep-alive and provider-specific events.
        }
      }
    },
    cancel() {
      void reader.cancel();
      void finishProjectReviewGeneration(reviewId, content.trim(), "failed");
      void usage.commit();
    },
  });
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let generationStarted = false;
  try {
    const generation = await prepareProjectReviewGeneration(id);
    generationStarted = true;
    const { service, model } = generation;
    const baseUrl = service.baseUrl.replace(/\/$/, "");
    const customBody = parseJson<Record<string, unknown>>(model.customBody || "{}", {});
    const upstream =
      service.type === "anthropic"
        ? await fetch(`${baseUrl}/messages`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": service.apiKey,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              ...customBody,
              model: model.modelId,
              max_tokens: generation.maxTokens ?? Number(customBody.max_tokens ?? 4096),
              stream: true,
              tools: undefined,
              system: generation.system,
              messages: [{ role: "user", content: generation.prompt }],
            }),
          })
        : await fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${service.apiKey}`,
            },
            body: JSON.stringify({
              ...customBody,
              model: model.modelId,
              ...(generation.maxTokens ? { max_tokens: generation.maxTokens } : {}),
              stream: true,
              stream_options: openAiStreamOptions(customBody),
              tools: undefined,
              tool_choice: undefined,
              messages: [
                { role: "system", content: generation.system },
                { role: "user", content: generation.prompt },
              ],
            }),
          });
    if (!upstream.ok) {
      const message = await upstream.text();
      await finishProjectReviewGeneration(id, "", "failed");
      throw new ApiError("modelRequestFailed", 502, {
        status: upstream.status,
        message: message.slice(0, 500),
      });
    }
    const usage = new TokenUsageTracker({
      service,
      model,
      feature: "review",
      input: `${generation.system}\n${generation.prompt}`,
      project: { kind: "creative", id: generation.project.id },
    });
    return new Response(reviewTextStream(upstream, service.type, id, usage), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  } catch (error) {
    if (generationStarted) await finishProjectReviewGeneration(id, "", "failed");
    return fail(error);
  }
}
