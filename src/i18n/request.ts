import { headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { fallbackUiLocale, resolveUiLocale } from "@/i18n/config";
import { loadSettings } from "@/lib/data";

type Messages = Record<string, unknown>;

export default getRequestConfig(async () => {
  const requestHeaders = await headers();
  const settings = await loadSettings();
  const locale = resolveUiLocale(settings.uiLanguage, requestHeaders.get("accept-language"));
  const fallbackMessages = (await import("../../messages/en.json")).default as Messages;
  const localeMessages =
    locale === fallbackUiLocale
      ? fallbackMessages
      : ((await import(`../../messages/${locale}.json`)).default as Messages);

  return {
    locale,
    messages: mergeMessages(fallbackMessages, localeMessages),
  };
});

function mergeMessages(fallback: Messages, localized: Messages): Messages {
  return Object.fromEntries(
    Object.entries(fallback).map(([key, value]) => {
      const translated = localized[key];
      if (isRecord(value) && isRecord(translated)) return [key, mergeMessages(value, translated)];
      return [key, translated ?? value];
    }),
  );
}

function isRecord(value: unknown): value is Messages {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
