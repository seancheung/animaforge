import { z } from "zod";
import { ApiError } from "@/lib/api";
import { loadServices, loadSettings, loadStyleFingerprints } from "@/lib/data";
import { getDb } from "@/lib/db";
import type { AppSettings } from "@/lib/types";

const optionalModelIdSchema = z.string().min(1).nullable();
const priceSchema = z.number().finite().min(0).nullable();

const appSettingsSchema = z.object({
  uiLanguage: z.enum(["en", "zh-CN"]).nullable(),
  language: z.string().max(120),
  globalDefaultModel: optionalModelIdSchema,
  taskModels: z.record(z.string(), optionalModelIdSchema),
  replyCaps: z.record(z.string(), z.number().finite().positive().nullable()),
  characterChatMaxConsecutiveReplies: z.number().int().min(1).max(100),
  translationConcurrency: z.number().int().min(1).max(4),
  translationWindowTokenLimit: z.number().int().min(1_000).max(64_000).nullable(),
  revisionWindowTokenLimit: z.number().int().min(1_000).max(64_000).nullable(),
  reviewerPrompts: z
    .array(
      z.object({
        id: z.string().min(1).max(160),
        name: z.string().min(1).max(160),
        prompt: z.string().min(1).max(40_000),
      }),
    )
    .max(100),
});

const modelSchema = z.object({
  id: z.string().min(1).max(160),
  modelId: z.string().min(1).max(500),
  displayName: z.string().min(1).max(500),
  contextWindowK: z.number().int().min(1).max(10_000),
  customBody: z.string().max(100_000),
  inputPrice: priceSchema,
  cacheReadPrice: priceSchema,
  cacheWritePrice: priceSchema,
  outputPrice: priceSchema,
});

const serviceSchema = z.object({
  id: z.string().min(1).max(160),
  name: z.string().min(1).max(500),
  type: z.enum(["openai", "anthropic"]),
  baseUrl: z.string().min(1).max(2_000),
  apiKey: z.string().max(20_000),
  models: z.array(modelSchema).max(500),
});

const styleFingerprintSchema = z.object({
  id: z.string().min(1).max(160),
  name: z.string().min(1).max(500),
  config: z.string().min(1).max(500_000),
});

export const settingsTransferSchema = z.object({
  kind: z.literal("anima-forge-settings"),
  version: z.literal(1),
  exportedAt: z.string(),
  includesSecrets: z.literal(true),
  settings: appSettingsSchema,
  services: z.array(serviceSchema).max(200),
  styleFingerprints: z.array(styleFingerprintSchema).max(500),
});

export type SettingsTransferDocument = z.infer<typeof settingsTransferSchema>;

function assertUnique(values: string[]) {
  if (new Set(values).size !== values.length) throw new ApiError("invalidSettingsImport");
}

export async function buildSettingsTransfer(): Promise<SettingsTransferDocument> {
  const [settings, services, styleFingerprints] = await Promise.all([
    loadSettings(),
    loadServices(),
    loadStyleFingerprints(),
  ]);
  return {
    kind: "anima-forge-settings",
    version: 1,
    exportedAt: new Date().toISOString(),
    includesSecrets: true,
    settings,
    services: services.map((service) => ({
      id: service.id,
      name: service.name,
      type: service.type,
      baseUrl: service.baseUrl,
      apiKey: service.apiKey,
      models: service.models.map((model) => ({
        id: model.id,
        modelId: model.modelId,
        displayName: model.displayName,
        contextWindowK: model.contextWindowK,
        customBody: model.customBody,
        inputPrice: model.inputPrice,
        cacheReadPrice: model.cacheReadPrice,
        cacheWritePrice: model.cacheWritePrice,
        outputPrice: model.outputPrice,
      })),
    })),
    styleFingerprints: styleFingerprints.map((fingerprint) => ({
      id: fingerprint.id,
      name: fingerprint.name,
      config: fingerprint.config,
    })),
  };
}

export async function importSettingsTransfer(value: unknown) {
  const result = settingsTransferSchema.safeParse(value);
  if (!result.success) throw new ApiError("invalidSettingsImport");
  const document = result.data;
  const modelIds = document.services.flatMap((service) => service.models.map((model) => model.id));
  assertUnique(document.services.map((service) => service.id));
  assertUnique(modelIds);
  assertUnique(document.styleFingerprints.map((fingerprint) => fingerprint.id));
  assertUnique(document.settings.reviewerPrompts.map((reviewer) => reviewer.id));
  for (const service of document.services) {
    for (const model of service.models) {
      const customBody = model.customBody.trim();
      if (customBody) {
        try {
          JSON.parse(customBody);
        } catch {
          throw new ApiError("invalidSettingsImport");
        }
      }
    }
  }

  const conn = await getDb();
  await conn.transaction(async (trx) => {
    for (const service of document.services) {
      const existing = await trx("llm_services").where({ id: service.id }).first();
      const serviceData = {
        name: service.name,
        type: service.type,
        base_url: service.baseUrl,
        updated_at: trx.fn.now(),
      };
      if (existing) {
        await trx("llm_services")
          .where({ id: service.id })
          .update({
            ...serviceData,
            api_key: service.apiKey,
          });
      } else {
        await trx("llm_services").insert({
          id: service.id,
          ...serviceData,
          api_key: service.apiKey,
        });
      }
      for (const model of service.models) {
        await trx("llm_models")
          .insert({
            id: model.id,
            service_id: service.id,
            model_id: model.modelId,
            display_name: model.displayName,
            context_window_k: model.contextWindowK,
            custom_body: model.customBody,
            input_price: model.inputPrice,
            cache_read_price: model.cacheReadPrice,
            cache_write_price: model.cacheWritePrice,
            output_price: model.outputPrice,
          })
          .onConflict("id")
          .merge([
            "service_id",
            "model_id",
            "display_name",
            "context_window_k",
            "custom_body",
            "input_price",
            "cache_read_price",
            "cache_write_price",
            "output_price",
          ]);
      }
    }
    for (const fingerprint of document.styleFingerprints) {
      await trx("style_fingerprints")
        .insert({ id: fingerprint.id, name: fingerprint.name, config: fingerprint.config })
        .onConflict("id")
        .merge({
          name: fingerprint.name,
          config: fingerprint.config,
          updated_at: trx.fn.now(),
        });
    }
    const settings = document.settings satisfies AppSettings;
    await trx("app_settings")
      .insert(
        Object.entries(settings).map(([key, setting]) => ({
          key,
          value: JSON.stringify(setting),
        })),
      )
      .onConflict("key")
      .merge(["value"]);
  });

  const [settings, services, styleFingerprints] = await Promise.all([
    loadSettings(),
    loadServices(),
    loadStyleFingerprints(),
  ]);
  return {
    settings,
    services,
    styleFingerprints,
    summary: {
      services: document.services.length,
      models: modelIds.length,
      styleFingerprints: document.styleFingerprints.length,
      secrets: document.services.filter((service) => Boolean(service.apiKey)).length,
    },
  };
}
