import type { StyleFingerprint } from "@/lib/types";

export function mergeStyleInstructions(
  fingerprint: Pick<StyleFingerprint, "name" | "config"> | null | undefined,
  manualInstructions: string,
) {
  const sections = [
    fingerprint?.config.trim()
      ? `Style fingerprint (${fingerprint.name.trim() || "selected"}):\n${fingerprint.config.trim()}`
      : "",
    manualInstructions.trim()
      ? `Additional user style instructions:\n${manualInstructions.trim()}`
      : "",
  ].filter(Boolean);
  return sections.join("\n\n");
}
