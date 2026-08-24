export const uiLocales = ["en", "zh-CN"] as const;
export type UiLocale = (typeof uiLocales)[number];

export const fallbackUiLocale: UiLocale = "en";

export function isUiLocale(value: unknown): value is UiLocale {
  return typeof value === "string" && uiLocales.includes(value as UiLocale);
}

export function resolveUiLocale(configured: unknown, acceptLanguage?: string | null): UiLocale {
  if (isUiLocale(configured)) return configured;
  const requested =
    acceptLanguage
      ?.split(",")
      .map((part) => part.trim().split(";")[0]?.toLowerCase())
      .filter(Boolean) ?? [];
  return requested.some((locale) => locale === "zh" || locale.startsWith("zh-"))
    ? "zh-CN"
    : fallbackUiLocale;
}
