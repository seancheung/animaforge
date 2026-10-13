/** Remove model-added wrappers while preserving the synopsis text itself. */
export function cleanSynopsisOutput(output: string): string {
  let text = output.trim();
  while (true) {
    const previous = text;
    const fence = text.match(/^```(?:xml|plaintext|text)?\s*\n([\s\S]*?)\n?```$/i);
    if (fence) text = fence[1].trim();
    const wrapper = text.match(
      /^<(block_synopsis|target_block_synopsis|chapter_synopsis|synopsis)>\s*([\s\S]*?)\s*<\/\1>$/i,
    );
    if (wrapper) text = wrapper[2].trim();
    if (text === previous) return text;
  }
}
