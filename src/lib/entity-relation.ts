export const sourceEntityPlaceholder = "{source}";
export const targetEntityPlaceholder = "{target}";

export function formatEntityRelation(expression: string, sourceName: string, targetName: string) {
  return expression
    .replaceAll(sourceEntityPlaceholder, sourceName)
    .replaceAll(targetEntityPlaceholder, targetName);
}
