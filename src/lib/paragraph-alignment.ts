export type AlignedParagraph = { left: string; right: string };

type AlignmentStep = { leftCount: number; rightCount: number };

export function splitParagraphs(text: string) {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.trim()) return [];
  return normalized
    .split(/\n[\t ]*\n+/)
    .map((paragraph) => paragraph.replace(/^\n+|\n+$/g, ""))
    .filter((paragraph) => paragraph.trim().length > 0);
}

function paragraphLength(paragraphs: string[], start: number, count: number) {
  let length = 0;
  for (let index = start; index < start + count; index += 1)
    length += Array.from(paragraphs[index]).length;
  return length;
}

function alignmentCost(
  leftLength: number,
  rightLength: number,
  ratio: number,
  leftCount: number,
  rightCount: number,
) {
  if (!leftCount || !rightCount) return 1.4 + Math.log1p(leftLength + rightLength) / 30;
  const expectedRightLength = leftLength * ratio;
  const lengthDifference = Math.abs(Math.log((rightLength + 1) / (expectedRightLength + 1)));
  return lengthDifference + (leftCount + rightCount - 2) * 0.22;
}

export function alignParagraphs(leftText: string, rightText: string): AlignedParagraph[] {
  const left = splitParagraphs(leftText);
  const right = splitParagraphs(rightText);
  if (!left.length) return right.map((paragraph) => ({ left: "", right: paragraph }));
  if (!right.length) return left.map((paragraph) => ({ left: paragraph, right: "" }));

  const leftLength = paragraphLength(left, 0, left.length);
  const rightLength = paragraphLength(right, 0, right.length);
  const ratio = Math.min(5, Math.max(0.2, rightLength / Math.max(1, leftLength)));
  const costs = Array.from({ length: left.length + 1 }, () =>
    new Array<number>(right.length + 1).fill(Number.POSITIVE_INFINITY),
  );
  const previous = Array.from({ length: left.length + 1 }, () =>
    new Array<AlignmentStep | null>(right.length + 1).fill(null),
  );
  const steps: AlignmentStep[] = [
    { leftCount: 1, rightCount: 1 },
    { leftCount: 2, rightCount: 1 },
    { leftCount: 1, rightCount: 2 },
    { leftCount: 3, rightCount: 1 },
    { leftCount: 1, rightCount: 3 },
    { leftCount: 1, rightCount: 0 },
    { leftCount: 0, rightCount: 1 },
  ];
  costs[0][0] = 0;

  for (let leftIndex = 0; leftIndex <= left.length; leftIndex += 1) {
    for (let rightIndex = 0; rightIndex <= right.length; rightIndex += 1) {
      if (!Number.isFinite(costs[leftIndex][rightIndex])) continue;
      for (const step of steps) {
        const nextLeft = leftIndex + step.leftCount;
        const nextRight = rightIndex + step.rightCount;
        if (nextLeft > left.length || nextRight > right.length) continue;
        const stepCost = alignmentCost(
          paragraphLength(left, leftIndex, step.leftCount),
          paragraphLength(right, rightIndex, step.rightCount),
          ratio,
          step.leftCount,
          step.rightCount,
        );
        if (costs[leftIndex][rightIndex] + stepCost >= costs[nextLeft][nextRight]) continue;
        costs[nextLeft][nextRight] = costs[leftIndex][rightIndex] + stepCost;
        previous[nextLeft][nextRight] = step;
      }
    }
  }

  const aligned: AlignedParagraph[] = [];
  let leftIndex = left.length;
  let rightIndex = right.length;
  while (leftIndex > 0 || rightIndex > 0) {
    const step = previous[leftIndex][rightIndex] ?? {
      leftCount: leftIndex ? 1 : 0,
      rightCount: rightIndex ? 1 : 0,
    };
    const leftStart = leftIndex - step.leftCount;
    const rightStart = rightIndex - step.rightCount;
    aligned.push({
      left: left.slice(leftStart, leftIndex).join("\n\n"),
      right: right.slice(rightStart, rightIndex).join("\n\n"),
    });
    leftIndex = leftStart;
    rightIndex = rightStart;
  }
  return aligned.reverse();
}
