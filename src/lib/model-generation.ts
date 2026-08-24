import { ApiError } from "@/lib/api";
import { parseJson } from "@/lib/db";
import {
  openAiStreamOptions,
  TokenUsageTracker,
  type UsageProjectReference,
} from "@/lib/token-usage";
import type { LlmModel, LlmService, TaskType } from "@/lib/types";

interface ModelTextRequest {
  service: LlmService;
  model: LlmModel;
  feature: TaskType;
  system: string;
  prompt: string;
  maxTokens?: number;
  signal?: AbortSignal;
  onDelta?: (text: string) => void | Promise<void>;
  onReasoningDelta?: (text: string) => void | Promise<void>;
  preserveWhitespace?: boolean;
  project?: UsageProjectReference;
}

export async function generateModelText({
  service,
  model,
  feature,
  system,
  prompt,
  maxTokens,
  signal,
  onDelta,
  onReasoningDelta,
  preserveWhitespace = false,
  project,
}: ModelTextRequest) {
  signal?.throwIfAborted();
  const baseUrl = service.baseUrl.replace(/\/$/, "");
  const customBody = parseJson<Record<string, unknown>>(model.customBody || "{}", {});
  const anthropicMaxTokens = maxTokens ?? Number(customBody.max_tokens ?? 4096);
  const response =
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
            max_tokens: anthropicMaxTokens,
            stream: true,
            tools: undefined,
            system,
            messages: [{ role: "user", content: prompt }],
          }),
          signal,
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
            ...(maxTokens ? { max_tokens: maxTokens } : {}),
            stream: true,
            stream_options: openAiStreamOptions(customBody),
            tools: undefined,
            tool_choice: undefined,
            messages: [
              { role: "system", content: system },
              { role: "user", content: prompt },
            ],
          }),
          signal,
        });

  if (!response.ok) {
    const message = await response.text();
    throw new ApiError("modelRequestFailed", 502, {
      status: response.status,
      message: message.slice(0, 500),
    });
  }
  if (!response.body) throw new ApiError("modelNoData", 502);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const usage = new TokenUsageTracker({
    service,
    model,
    feature,
    input: `${system}\n${prompt}`,
    project,
  });
  let buffer = "";
  let content = "";

  const processLine = async (line: string) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    let event: {
      choices?: Array<{
        delta?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown };
      }>;
      type?: unknown;
      delta?: { type?: unknown; text?: unknown; thinking?: unknown };
    };
    try {
      event = JSON.parse(data) as typeof event;
    } catch {
      return;
    }
    usage.observe(event);
    const text =
      service.type === "openai"
        ? event.choices?.[0]?.delta?.content
        : event.type === "content_block_delta"
          ? event.delta?.text
          : undefined;
    const reasoning =
      service.type === "openai"
        ? (event.choices?.[0]?.delta?.reasoning_content ?? event.choices?.[0]?.delta?.reasoning)
        : event.type === "content_block_delta" && event.delta?.type === "thinking_delta"
          ? event.delta.thinking
          : undefined;
    if (typeof reasoning === "string" && reasoning) {
      usage.collectOutput(reasoning);
      await onReasoningDelta?.(reasoning);
    }
    if (typeof text === "string" && text) {
      content += text;
      usage.collectOutput(text);
      await onDelta?.(text);
    }
  };

  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) await processLine(line);
    }
    buffer += decoder.decode();
    if (buffer.trim()) await processLine(buffer);
  } finally {
    await usage.commit();
  }
  return preserveWhitespace ? content : content.trim();
}
