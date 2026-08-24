import { ApiError, fail, jsonBody } from "@/lib/api";
import {
  loadBlocks,
  loadServices,
  loadSettings,
  mapChapter,
  mapCharacter,
  mapProject,
} from "@/lib/data";
import { getDb } from "@/lib/db";
import { type AdjacentChaptersContext, buildPrompt, type GenerationOptions } from "@/lib/prompt";
import { openAiStreamOptions, TokenUsageTracker } from "@/lib/token-usage";
import type { ChapterDetail, TaskType } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GenerateBody = GenerationOptions & { chapterId: string; blockId?: string; modelId?: string };

const SYSTEM_PROMPT =
  "You are a professional fiction-writing assistant. Follow the structured context and task instructions exactly. Return only the requested output.";

function streamTextFromSse(
  response: Response,
  provider: "openai" | "anthropic",
  usage: TokenUsageTracker,
) {
  if (!response.body) throw new ApiError("modelNoData", 502);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            if (buffer.trim()) processLine(buffer);
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
      void usage.commit();
    },
  });
}

async function chapterDetail(chapterId: string): Promise<ChapterDetail> {
  const conn = await getDb();
  const chapterRow = await conn("chapters").where({ id: chapterId }).first();
  if (!chapterRow) throw new ApiError("chapterNotFound", 404);
  const projectRow = await conn("projects").where({ id: chapterRow.project_id }).first();
  const characterRows = await conn("characters")
    .where({ project_id: chapterRow.project_id })
    .orderBy("created_at", "asc");
  const links = await conn("chapter_characters").where({ chapter_id: chapterId });
  const ids = links.map((link) => String(link.character_id));
  const characters =
    chapterRow.character_mode === "selected"
      ? characterRows.filter((row) => ids.includes(String(row.id)))
      : characterRows;
  return {
    chapter: mapChapter(chapterRow, ids),
    project: mapProject(projectRow),
    characters: characters.map(mapCharacter),
    allCharacters: characterRows.map(mapCharacter),
    blocks: await loadBlocks(chapterId),
    settings: await loadSettings(),
    services: await loadServices(),
  };
}

async function loadAdjacentChapters(
  detail: ChapterDetail,
  options: GenerationOptions,
): Promise<AdjacentChaptersContext> {
  const includePrevious =
    options.previousChapter !== undefined && options.previousChapter !== "ignore";
  const includeNext = options.nextChapter !== undefined && options.nextChapter !== "ignore";
  if (!includePrevious && !includeNext) return {};
  const conn = await getDb();
  const [previousRow, nextRow] = await Promise.all([
    includePrevious
      ? conn("chapters")
          .where({ project_id: detail.project.id })
          .andWhere("sort_order", "<", detail.chapter.sortOrder)
          .orderBy("sort_order", "desc")
          .first()
      : undefined,
    includeNext
      ? conn("chapters")
          .where({ project_id: detail.project.id })
          .andWhere("sort_order", ">", detail.chapter.sortOrder)
          .orderBy("sort_order", "asc")
          .first()
      : undefined,
  ]);
  const [previousBlocks, nextBlocks] = await Promise.all([
    previousRow ? loadBlocks(String(previousRow.id)) : undefined,
    nextRow ? loadBlocks(String(nextRow.id)) : undefined,
  ]);
  return {
    ...(previousRow && previousBlocks
      ? { previous: { chapter: mapChapter(previousRow, []), blocks: previousBlocks } }
      : {}),
    ...(nextRow && nextBlocks
      ? { next: { chapter: mapChapter(nextRow, []), blocks: nextBlocks } }
      : {}),
  };
}

export async function POST(request: Request) {
  try {
    const body = await jsonBody<GenerateBody>(request);
    const detail = await chapterDetail(body.chapterId);
    const task: TaskType = body.mode === "content" ? "writing" : "summary";
    const configuredModel =
      body.modelId ||
      detail.project.modelOverrides[task] ||
      detail.settings.taskModels[task] ||
      detail.settings.globalDefaultModel;
    if (!configuredModel) throw new ApiError("taskModelNotConfigured", 400, { task });
    const services = detail.services;
    const service = services.find((candidate) =>
      candidate.models.some((model) => model.id === configuredModel),
    );
    const model = service?.models.find((candidate) => candidate.id === configuredModel);
    if (!service || !model) throw new ApiError("configuredModelMissing");
    const customBody = JSON.parse(model.customBody || "{}") as Record<string, unknown>;
    const maxTokens = detail.settings.replyCaps[task] ?? undefined;
    const adjacentChapters = await loadAdjacentChapters(detail, body);
    const prompt = buildPrompt(detail, body.blockId, body, adjacentChapters);
    const baseUrl = service.baseUrl.replace(/\/$/, "");

    let upstream: Response;
    if (service.type === "anthropic") {
      upstream = await fetch(`${baseUrl}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": service.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          ...customBody,
          model: model.modelId,
          max_tokens: maxTokens ?? Number(customBody.max_tokens ?? 4096),
          stream: true,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: prompt }],
        }),
        signal: request.signal,
      });
    } else {
      upstream = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${service.apiKey}` },
        body: JSON.stringify({
          ...customBody,
          model: model.modelId,
          ...(maxTokens ? { max_tokens: maxTokens } : {}),
          stream: true,
          stream_options: openAiStreamOptions(customBody),
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ],
        }),
        signal: request.signal,
      });
    }

    if (!upstream.ok) {
      const message = await upstream.text();
      throw new ApiError("modelRequestFailed", 502, {
        status: upstream.status,
        message: message.slice(0, 500),
      });
    }

    const usage = new TokenUsageTracker({
      service,
      model,
      feature: task,
      input: `${SYSTEM_PROMPT}\n${prompt}`,
      project: { kind: "creative", id: detail.project.id },
    });
    return new Response(streamTextFromSse(upstream, service.type, usage), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  } catch (error) {
    if (request.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
      return new Response(null, { status: 499 });
    }
    return fail(error);
  }
}
