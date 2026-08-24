export type TextDiffLine = {
  type: "same" | "added" | "removed" | "omitted";
  text: string;
  oldLine: number | null;
  newLine: number | null;
  segments?: TextDiffSegment[];
};

export type TextDiffSegment = { type: "same" | "added" | "removed"; text: string };

type DiffOperation = { type: "same" | "added" | "removed"; text: string };
type Anchor = { oldIndex: number; newIndex: number };

function splitLines(text: string) {
  if (!text) return [];
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function patienceAnchors(
  before: string[],
  after: string[],
  oldStart: number,
  oldEnd: number,
  newStart: number,
  newEnd: number,
) {
  const oldEntries = new Map<string, { count: number; index: number }>();
  const newEntries = new Map<string, { count: number; index: number }>();
  for (let index = oldStart; index < oldEnd; index += 1) {
    const current = oldEntries.get(before[index]);
    oldEntries.set(before[index], { count: (current?.count ?? 0) + 1, index });
  }
  for (let index = newStart; index < newEnd; index += 1) {
    const current = newEntries.get(after[index]);
    newEntries.set(after[index], { count: (current?.count ?? 0) + 1, index });
  }

  const candidates: Anchor[] = [];
  for (const [line, oldEntry] of oldEntries) {
    const newEntry = newEntries.get(line);
    if (oldEntry.count === 1 && newEntry?.count === 1)
      candidates.push({ oldIndex: oldEntry.index, newIndex: newEntry.index });
  }
  candidates.sort((left, right) => left.oldIndex - right.oldIndex);
  if (!candidates.length) return [];

  const tails: number[] = [];
  const previous = new Array<number>(candidates.length).fill(-1);
  for (let index = 0; index < candidates.length; index += 1) {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (candidates[tails[middle]].newIndex < candidates[index].newIndex) low = middle + 1;
      else high = middle;
    }
    if (low > 0) previous[index] = tails[low - 1];
    tails[low] = index;
  }

  const result: Anchor[] = [];
  let cursor = tails.at(-1) ?? -1;
  while (cursor >= 0) {
    result.push(candidates[cursor]);
    cursor = previous[cursor];
  }
  return result.reverse();
}

function diffRange(
  before: string[],
  after: string[],
  oldStart: number,
  oldEnd: number,
  newStart: number,
  newEnd: number,
  output: DiffOperation[],
) {
  while (oldStart < oldEnd && newStart < newEnd && before[oldStart] === after[newStart]) {
    output.push({ type: "same", text: before[oldStart] });
    oldStart += 1;
    newStart += 1;
  }

  const suffix: string[] = [];
  while (oldStart < oldEnd && newStart < newEnd && before[oldEnd - 1] === after[newEnd - 1]) {
    suffix.push(before[oldEnd - 1]);
    oldEnd -= 1;
    newEnd -= 1;
  }

  if (oldStart === oldEnd) {
    for (let index = newStart; index < newEnd; index += 1)
      output.push({ type: "added", text: after[index] });
  } else if (newStart === newEnd) {
    for (let index = oldStart; index < oldEnd; index += 1)
      output.push({ type: "removed", text: before[index] });
  } else {
    const anchors = patienceAnchors(before, after, oldStart, oldEnd, newStart, newEnd);
    if (!anchors.length) {
      for (let index = oldStart; index < oldEnd; index += 1)
        output.push({ type: "removed", text: before[index] });
      for (let index = newStart; index < newEnd; index += 1)
        output.push({ type: "added", text: after[index] });
    } else {
      let oldCursor = oldStart;
      let newCursor = newStart;
      for (const anchor of anchors) {
        diffRange(before, after, oldCursor, anchor.oldIndex, newCursor, anchor.newIndex, output);
        output.push({ type: "same", text: before[anchor.oldIndex] });
        oldCursor = anchor.oldIndex + 1;
        newCursor = anchor.newIndex + 1;
      }
      diffRange(before, after, oldCursor, oldEnd, newCursor, newEnd, output);
    }
  }

  for (let index = suffix.length - 1; index >= 0; index -= 1)
    output.push({ type: "same", text: suffix[index] });
}

function numberOperations(operations: DiffOperation[]) {
  let oldLine = 1;
  let newLine = 1;
  return operations.map<TextDiffLine>((operation) => {
    const line: TextDiffLine = {
      ...operation,
      oldLine: operation.type === "added" ? null : oldLine,
      newLine: operation.type === "removed" ? null : newLine,
    };
    if (operation.type !== "added") oldLine += 1;
    if (operation.type !== "removed") newLine += 1;
    return line;
  });
}

function compactUnchanged(lines: TextDiffLine[], context = 3) {
  const compacted: TextDiffLine[] = [];
  let index = 0;
  while (index < lines.length) {
    if (lines[index].type !== "same") {
      compacted.push(lines[index]);
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < lines.length && lines[end].type === "same") end += 1;
    const count = end - index;
    if (count <= context * 2 + 2) compacted.push(...lines.slice(index, end));
    else {
      compacted.push(...lines.slice(index, index + context));
      compacted.push({
        type: "omitted",
        text: String(count - context * 2),
        oldLine: null,
        newLine: null,
      });
      compacted.push(...lines.slice(end - context, end));
    }
    index = end;
  }
  return compacted;
}

function mergeSegments(segments: TextDiffSegment[]) {
  const merged: TextDiffSegment[] = [];
  for (const segment of segments) {
    if (!segment.text) continue;
    const previous = merged.at(-1);
    if (previous?.type === segment.type) previous.text += segment.text;
    else merged.push({ ...segment });
  }
  return merged;
}

function fallbackCharacterDiff(before: string[], after: string[]) {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix])
    prefix += 1;
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  )
    suffix += 1;
  return mergeSegments([
    { type: "same", text: before.slice(0, prefix).join("") },
    { type: "removed", text: before.slice(prefix, before.length - suffix).join("") },
    { type: "added", text: after.slice(prefix, after.length - suffix).join("") },
    { type: "same", text: suffix ? before.slice(before.length - suffix).join("") : "" },
  ]);
}

export function buildCharacterDiff(beforeText: string, afterText: string, maxEditDistance = 600) {
  const before = Array.from(beforeText);
  const after = Array.from(afterText);
  if (!before.length || !after.length) return fallbackCharacterDiff(before, after);
  const maximum = Math.min(before.length + after.length, maxEditDistance);
  let frontier = new Map<number, number>([[1, 0]]);
  const trace: Map<number, number>[] = [];

  for (let distance = 0; distance <= maximum; distance += 1) {
    trace.push(new Map(frontier));
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      const down = frontier.get(diagonal + 1) ?? -1;
      const right = frontier.get(diagonal - 1) ?? -1;
      let oldIndex =
        diagonal === -distance || (diagonal !== distance && right < down) ? down : right + 1;
      if (oldIndex < 0) oldIndex = 0;
      let newIndex = oldIndex - diagonal;
      while (
        oldIndex < before.length &&
        newIndex < after.length &&
        before[oldIndex] === after[newIndex]
      ) {
        oldIndex += 1;
        newIndex += 1;
      }
      frontier.set(diagonal, oldIndex);
      if (oldIndex < before.length || newIndex < after.length) continue;

      const operations: TextDiffSegment[] = [];
      let oldCursor = before.length;
      let newCursor = after.length;
      for (let step = trace.length - 1; step >= 0; step -= 1) {
        const snapshot = trace[step];
        const currentDiagonal = oldCursor - newCursor;
        const snapshotDown = snapshot.get(currentDiagonal + 1) ?? -1;
        const snapshotRight = snapshot.get(currentDiagonal - 1) ?? -1;
        const previousDiagonal =
          currentDiagonal === -step || (currentDiagonal !== step && snapshotRight < snapshotDown)
            ? currentDiagonal + 1
            : currentDiagonal - 1;
        const previousOld = Math.max(0, snapshot.get(previousDiagonal) ?? 0);
        const previousNew = previousOld - previousDiagonal;
        while (oldCursor > previousOld && newCursor > previousNew) {
          operations.push({ type: "same", text: before[oldCursor - 1] });
          oldCursor -= 1;
          newCursor -= 1;
        }
        if (step === 0) break;
        if (oldCursor === previousOld) {
          operations.push({ type: "added", text: after[newCursor - 1] });
          newCursor -= 1;
        } else {
          operations.push({ type: "removed", text: before[oldCursor - 1] });
          oldCursor -= 1;
        }
      }
      return mergeSegments(operations.reverse());
    }
    frontier = new Map(frontier);
  }

  return fallbackCharacterDiff(before, after);
}

function addCharacterSegments(lines: TextDiffLine[]) {
  let index = 0;
  while (index < lines.length) {
    if (lines[index].type === "same" || lines[index].type === "omitted") {
      index += 1;
      continue;
    }
    let end = index;
    while (end < lines.length && lines[end].type !== "same" && lines[end].type !== "omitted")
      end += 1;
    const removed = lines.slice(index, end).filter((line) => line.type === "removed");
    const added = lines.slice(index, end).filter((line) => line.type === "added");
    const pairs = Math.max(removed.length, added.length);
    for (let pair = 0; pair < pairs; pair += 1) {
      const oldLine = removed[pair];
      const newLine = added[pair];
      const segments = buildCharacterDiff(oldLine?.text ?? "", newLine?.text ?? "");
      if (oldLine) oldLine.segments = segments.filter((segment) => segment.type !== "added");
      if (newLine) newLine.segments = segments.filter((segment) => segment.type !== "removed");
    }
    index = end;
  }
  return lines;
}

export function buildLineDiff(beforeText: string, afterText: string) {
  const before = splitLines(beforeText);
  const after = splitLines(afterText);
  const operations: DiffOperation[] = [];
  diffRange(before, after, 0, before.length, 0, after.length, operations);
  return addCharacterSegments(compactUnchanged(numberOperations(operations)));
}
