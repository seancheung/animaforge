export const MAX_BLUEPRINT_REDUCTION_LEVELS = 8;

export function blueprintInputBudget(
  contextTokens: number,
  outputTokens: number,
  requirementTokens: number,
) {
  if (!Number.isFinite(contextTokens) || contextTokens <= 0) return 0;
  return Math.floor(
    contextTokens - Math.max(2_048, contextTokens * 0.1) - outputTokens - requirementTokens - 4_096,
  );
}

// Include the separators sent to the final model when checking convergence.
export function blueprintReductionError(level: number, inputLength: number, outputLength: number) {
  if (level > 0 && outputLength >= inputLength) return "translationBlueprintReductionStalled";
  if (level >= MAX_BLUEPRINT_REDUCTION_LEVELS) return "translationBlueprintReductionLimit";
  return null;
}
