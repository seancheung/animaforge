// Translation can expand substantially across languages. This is an estimate,
// not a guarantee; providers must still report truncation as a failed request.
export const TRANSLATION_OUTPUT_EXPANSION = 3;

export function translationOutputBudget(replyCap: number | null | undefined, customBody: string) {
  let body: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(customBody || "{}");
    body = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    /* Use automatic defaults. */
  }
  const value = replyCap ?? body.max_tokens ?? body.max_completion_tokens;
  const cap =
    typeof value === "number" && Number.isFinite(value) && value > 0
      ? Math.floor(value)
      : undefined;
  const thinking = body.thinking as { type?: unknown; budget_tokens?: unknown } | undefined;
  const thinkingTokens =
    thinking?.type === "disabled"
      ? 0
      : typeof thinking?.budget_tokens === "number" && Number.isFinite(thinking.budget_tokens)
        ? Math.max(0, thinking.budget_tokens)
        : Math.min(2_048, Math.floor((cap ?? 8_192) / 4));
  return { cap, reserve: thinkingTokens + 256 };
}
