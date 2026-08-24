import { isUiLocale } from "@/i18n/config";
import { fail, jsonBody, ok } from "@/lib/api";
import { loadServices, loadSettings, saveSettings } from "@/lib/data";
import type { AppSettings } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  try {
    return ok({ settings: await loadSettings(), services: await loadServices() });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await jsonBody<Partial<AppSettings>>(request);
    const update: Partial<AppSettings> = {};
    if (body.uiLanguage !== undefined)
      update.uiLanguage = isUiLocale(body.uiLanguage) ? body.uiLanguage : null;
    if (body.language !== undefined) update.language = body.language.trim();
    if (body.globalDefaultModel !== undefined)
      update.globalDefaultModel =
        typeof body.globalDefaultModel === "string" && body.globalDefaultModel
          ? body.globalDefaultModel
          : null;
    if (body.taskModels !== undefined) update.taskModels = body.taskModels;
    if (body.replyCaps !== undefined) update.replyCaps = body.replyCaps;
    if (body.characterChatMaxConsecutiveReplies !== undefined) {
      const value = Number(body.characterChatMaxConsecutiveReplies);
      update.characterChatMaxConsecutiveReplies = Number.isFinite(value)
        ? Math.max(1, Math.floor(value))
        : 5;
    }
    if (body.translationConcurrency !== undefined) {
      const value = Number(body.translationConcurrency);
      update.translationConcurrency = Number.isFinite(value)
        ? Math.min(4, Math.max(1, Math.floor(value)))
        : 2;
    }
    if (body.translationWindowTokenLimit !== undefined)
      update.translationWindowTokenLimit = normalizeWindowTokenLimit(
        body.translationWindowTokenLimit,
      );
    if (body.revisionWindowTokenLimit !== undefined)
      update.revisionWindowTokenLimit = normalizeWindowTokenLimit(body.revisionWindowTokenLimit);
    if (body.reviewerPrompts !== undefined) {
      update.reviewerPrompts = body.reviewerPrompts.flatMap((reviewer) => {
        const id = typeof reviewer?.id === "string" ? reviewer.id.trim() : "";
        const name = typeof reviewer?.name === "string" ? reviewer.name.trim() : "";
        const prompt = typeof reviewer?.prompt === "string" ? reviewer.prompt.trim() : "";
        return id && name && prompt ? [{ id, name, prompt }] : [];
      });
    }
    await saveSettings(update);
    return ok(await loadSettings());
  } catch (error) {
    return fail(error);
  }
}

function normalizeWindowTokenLimit(value: number | null) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(64_000, Math.max(1_000, Math.round(value)))
    : null;
}
