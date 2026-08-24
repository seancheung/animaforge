const DEFAULT_AUTO_QUALITY_LIMIT = 8_000;
const MIN_SOURCE_WINDOW = 512;

/**
 * Conservative tokenizer-independent estimate. Non-ASCII text commonly uses
 * at least one token per code point, while Latin prose averages about four
 * characters per token.
 */
export function estimateTextTokens(value: string) {
  let asciiCharacters = 0;
  let otherTokens = 0;
  for (const character of value) {
    if (character.codePointAt(0)! <= 0x7f) asciiCharacters += 1;
    else otherTokens += 1;
  }
  return otherTokens + Math.ceil(asciiCharacters / 4);
}

export function calculateSourceWindowTokens(input: {
  contextWindowTokens: number;
  fixedContent: string;
  fixedPromptOverhead: number;
  inputExpansion?: number;
  outputExpansion: number;
  replyTokenLimit?: number | null;
  customTokenLimit?: number | null;
  autoQualityLimit?: number;
}) {
  const contextTokens = Math.max(1_000, Math.floor(input.contextWindowTokens));
  const safetyMargin = Math.max(2_048, Math.floor(contextTokens * 0.1));
  const available =
    contextTokens -
    safetyMargin -
    estimateTextTokens(input.fixedContent) -
    input.fixedPromptOverhead;
  let safeLimit = Math.floor(available / ((input.inputExpansion ?? 1) + input.outputExpansion));
  if (input.replyTokenLimit && input.replyTokenLimit > 0) {
    safeLimit = Math.min(
      safeLimit,
      Math.floor((input.replyTokenLimit - 256) / input.outputExpansion),
    );
  }
  if (safeLimit < MIN_SOURCE_WINDOW) return null;
  const configuredLimit =
    input.customTokenLimit == null
      ? (input.autoQualityLimit ?? DEFAULT_AUTO_QUALITY_LIMIT)
      : Math.max(MIN_SOURCE_WINDOW, Math.floor(input.customTokenLimit));
  return Math.max(MIN_SOURCE_WINDOW, Math.min(safeLimit, configuredLimit));
}

export function suggestedOutputTokens(source: string, expansion = 1.5) {
  return Math.max(1_024, Math.ceil(estimateTextTokens(source) * expansion) + 256);
}

export function splitTextWindowsByTokens(content: string, tokenLimit: number) {
  if (!content) return [""];
  const limit = Math.max(1, Math.floor(tokenLimit));
  const windows: string[] = [];
  let offset = 0;

  while (offset < content.length) {
    let end = offset;
    let tokens = 0;
    let asciiCharacters = 0;
    while (end < content.length) {
      const codePoint = content.codePointAt(end)!;
      const width = codePoint > 0xffff ? 2 : 1;
      const nextTokens =
        codePoint <= 0x7f
          ? tokens + (Math.ceil((asciiCharacters + 1) / 4) - Math.ceil(asciiCharacters / 4))
          : tokens + 1;
      if (nextTokens > limit && end > offset) break;
      tokens = nextTokens;
      if (codePoint <= 0x7f) asciiCharacters += 1;
      end += width;
      if (tokens >= limit) break;
    }

    if (end < content.length) {
      const floor = offset + Math.floor((end - offset) * 0.55);
      const candidates = [
        content.lastIndexOf("\n\n", end),
        content.lastIndexOf("\n", end),
        Math.max(
          content.lastIndexOf("。", end),
          content.lastIndexOf("！", end),
          content.lastIndexOf("？", end),
          content.lastIndexOf(". ", end),
          content.lastIndexOf("! ", end),
          content.lastIndexOf("? ", end),
        ),
      ];
      const boundary = candidates.find((candidate) => candidate >= floor);
      if (boundary !== undefined) end = boundary + (content.startsWith("\n\n", boundary) ? 2 : 1);
    }

    windows.push(content.slice(offset, end));
    offset = end;
  }
  return windows;
}
