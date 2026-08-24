import { getDb } from "@/lib/db";
import type { LlmModel, LlmService, TaskType } from "@/lib/types";

type UsageNumbers = {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
};

export type UsageProjectKind = "creative" | "translation";
export interface UsageProjectReference {
  kind: UsageProjectKind;
  id: string;
}

const emptyUsage = (): UsageNumbers => ({ input: 0, cacheRead: 0, cacheWrite: 0, output: 0 });
const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const asNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : null;

export function estimateTokens(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text ? Math.ceil(text.length / 4) : 0;
}

export class TokenUsageTracker {
  private usage = emptyUsage();
  private promptReported = false;
  private outputReported = false;
  private outputCharacters = 0;
  private committed = false;

  constructor(
    private readonly options: {
      service: LlmService;
      model: LlmModel;
      feature: TaskType;
      input: unknown;
      project?: UsageProjectReference;
    },
  ) {}

  observe(value: unknown) {
    const event = asRecord(value);
    if (!event) return;

    if (this.options.service.type === "anthropic") {
      const message = asRecord(event.message);
      const usage = asRecord(message?.usage) ?? asRecord(event.usage);
      if (!usage) return;
      const input = asNumber(usage.input_tokens);
      const cacheRead = asNumber(usage.cache_read_input_tokens);
      const cacheWrite = asNumber(usage.cache_creation_input_tokens);
      const output = asNumber(usage.output_tokens);
      if (input !== null || cacheRead !== null || cacheWrite !== null) {
        this.promptReported = true;
        this.usage.input = input ?? this.usage.input;
        this.usage.cacheRead = cacheRead ?? this.usage.cacheRead;
        this.usage.cacheWrite = cacheWrite ?? this.usage.cacheWrite;
      }
      if (output !== null) {
        this.outputReported = true;
        this.usage.output = output;
      }
      return;
    }

    const usage = asRecord(event.usage);
    if (!usage) return;
    const prompt = asNumber(usage.prompt_tokens);
    const details = asRecord(usage.prompt_tokens_details);
    const cacheRead =
      asNumber(details?.cached_tokens) ?? asNumber(usage.prompt_cache_hit_tokens) ?? 0;
    const cacheWrite =
      asNumber(details?.cache_write_tokens) ?? asNumber(usage.cache_write_tokens) ?? 0;
    const output = asNumber(usage.completion_tokens);
    if (prompt !== null) {
      this.promptReported = true;
      this.usage.cacheRead = cacheRead;
      this.usage.cacheWrite = cacheWrite;
      this.usage.input = Math.max(0, prompt - cacheRead - cacheWrite);
    }
    if (output !== null) {
      this.outputReported = true;
      this.usage.output = output;
    }
  }

  collectOutput(text: string) {
    this.outputCharacters += text.length;
  }

  async commit() {
    if (this.committed) return;
    this.committed = true;
    const usage = {
      ...this.usage,
      input: this.promptReported ? this.usage.input : estimateTokens(this.options.input),
      output:
        this.outputReported && this.usage.output > 0
          ? this.usage.output
          : Math.ceil(this.outputCharacters / 4),
    };
    try {
      const conn = await getDb();
      await conn("token_usage").insert({
        service_name: this.options.service.name,
        model_id: this.options.model.modelId,
        feature: this.options.feature,
        project_kind: this.options.project?.kind ?? null,
        project_id: this.options.project?.id ?? null,
        input_tokens: usage.input,
        cache_read_tokens: usage.cacheRead,
        cache_write_tokens: usage.cacheWrite,
        output_tokens: usage.output,
      });
    } catch (error) {
      console.error("Failed to record token usage", error);
    }
  }
}

export function openAiStreamOptions(customBody: Record<string, unknown>) {
  return {
    ...(asRecord(customBody.stream_options) ?? {}),
    include_usage: true,
  };
}
