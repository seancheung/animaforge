import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";

function inlineMarkdown(value: string): ReactNode[] {
  const parts = value.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**"))
      return (
        <strong key={index} className="font-semibold text-zinc-950">
          {part.slice(2, -2)}
        </strong>
      );
    if (part.startsWith("`") && part.endsWith("`"))
      return (
        <code
          key={index}
          className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[.9em] text-zinc-800"
        >
          {part.slice(1, -1)}
        </code>
      );
    if (part.startsWith("*") && part.endsWith("*")) return <em key={index}>{part.slice(1, -1)}</em>;
    const link = part.match(/^\[([^\]]+)]\(([^)]+)\)$/);
    if (link) {
      const href = /^(https?:|mailto:)/i.test(link[2]) ? link[2] : "#";
      return (
        <a
          key={index}
          href={href}
          target={href === "#" ? undefined : "_blank"}
          rel="noreferrer"
          className="font-medium text-sky-700 underline decoration-sky-300 underline-offset-2"
        >
          {link[1]}
        </a>
      );
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

type TableAlignment = "left" | "center" | "right";

function splitTableRow(line: string): string[] {
  let source = line.trim();
  if (source.startsWith("|")) source = source.slice(1);
  if (source.endsWith("|") && !source.endsWith("\\|")) source = source.slice(0, -1);

  const cells: string[] = [];
  let cell = "";
  let inCode = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\\" && source[index + 1] === "|") {
      cell += "|";
      index += 1;
      continue;
    }
    if (character === "`") {
      inCode = !inCode;
      cell += character;
      continue;
    }
    if (character === "|" && !inCode) {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += character;
  }

  cells.push(cell.trim());
  return cells;
}

function tableDelimiter(line: string): string[] | null {
  const cells = splitTableRow(line);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell)) ? cells : null;
}

function isTableStart(lines: string[], index: number): boolean {
  if (index + 1 >= lines.length) return false;
  const header = splitTableRow(lines[index]);
  const delimiter = tableDelimiter(lines[index + 1]);
  return header.length > 1 && delimiter !== null && header.length === delimiter.length;
}

function tableAlignment(delimiter: string): TableAlignment {
  if (delimiter.startsWith(":") && delimiter.endsWith(":")) return "center";
  if (delimiter.endsWith(":")) return "right";
  return "left";
}

function alignmentClassName(alignment: TableAlignment): string {
  if (alignment === "center") return "text-center";
  if (alignment === "right") return "text-right";
  return "text-left";
}

type MarkdownListItem = {
  content: string;
  children: MarkdownList[];
};

type MarkdownList = {
  ordered: boolean;
  items: MarkdownListItem[];
};

type ListLine = {
  indent: number;
  ordered: boolean;
  content: string;
};

function listLine(line: string): ListLine | null {
  const match = line.match(/^([ \t]*)([-*+]|\d+\.)[ \t]+(.+)$/);
  if (!match) return null;
  return {
    indent: match[1].replace(/\t/g, "    ").length,
    ordered: /^\d+\.$/.test(match[2]),
    content: match[3],
  };
}

function parseMarkdownList(
  lines: string[],
  startIndex: number,
): { list: MarkdownList; nextIndex: number } {
  const first = listLine(lines[startIndex])!;
  const baseIndent = first.indent;
  const list: MarkdownList = { ordered: first.ordered, items: [] };
  let index = startIndex;

  while (index < lines.length) {
    const current = listLine(lines[index]);
    if (!current || current.indent < baseIndent) break;

    if (current.indent > baseIndent) {
      const parent = list.items.at(-1);
      if (!parent) break;
      const nested = parseMarkdownList(lines, index);
      parent.children.push(nested.list);
      index = nested.nextIndex;
      continue;
    }

    if (current.ordered !== list.ordered) break;
    list.items.push({ content: current.content, children: [] });
    index += 1;
  }

  return { list, nextIndex: index };
}

function listStyleClassName(ordered: boolean, depth: number): string {
  if (ordered) {
    if (depth % 3 === 1) return "list-[lower-alpha]";
    if (depth % 3 === 2) return "list-[lower-roman]";
    return "list-decimal";
  }
  if (depth % 3 === 1) return "list-[circle]";
  if (depth % 3 === 2) return "list-[square]";
  return "list-disc";
}

function renderMarkdownList(list: MarkdownList, key: number | string, depth = 0): ReactNode {
  const items = list.items.map((item, itemIndex) => (
    <li key={itemIndex}>
      {inlineMarkdown(item.content)}
      {item.children.map((child, childIndex) => renderMarkdownList(child, childIndex, depth + 1))}
    </li>
  ));
  const listClassName = cn(
    "ml-5 space-y-1.5",
    depth > 0 && "mt-1.5",
    listStyleClassName(list.ordered, depth),
  );
  return list.ordered ? (
    <ol key={key} className={listClassName}>
      {items}
    </ol>
  ) : (
    <ul key={key} className={listClassName}>
      {items}
    </ul>
  );
}

const blockStart = (line: string) =>
  /^(#{1,4})\s+|^```|^>\s?|^\s*[-*+]\s+|^\s*\d+\.\s+|^\s*(---+|___+)\s*$/.test(line);

export function MarkdownContent({ content, className }: { content: string; className?: string }) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(
        <pre
          key={blocks.length}
          className="overflow-x-auto rounded-xl bg-zinc-950 p-4 text-xs text-zinc-100 leading-6"
        >
          <code data-language={language || undefined}>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    if (isTableStart(lines, index)) {
      const headers = splitTableRow(line);
      const delimiter = tableDelimiter(lines[index + 1])!;
      const alignments = delimiter.map(tableAlignment);
      const rows: string[][] = [];
      index += 2;

      while (index < lines.length && lines[index].trim()) {
        const row = splitTableRow(lines[index]);
        if (row.length <= 1 || tableDelimiter(lines[index])) break;
        rows.push(headers.map((_, cellIndex) => row[cellIndex] ?? ""));
        index += 1;
      }

      blocks.push(
        <div key={blocks.length} className="overflow-x-auto rounded-xl border border-zinc-200">
          <table className="w-full min-w-[36rem] border-collapse text-sm">
            <thead className="bg-zinc-50 text-zinc-950">
              <tr>
                {headers.map((header, cellIndex) => (
                  <th
                    key={cellIndex}
                    className={cn(
                      "border-zinc-200 border-b px-4 py-2.5 font-semibold",
                      alignmentClassName(alignments[cellIndex]),
                    )}
                  >
                    {inlineMarkdown(header)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="even:bg-zinc-50/50">
                  {row.map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      className={cn(
                        "px-4 py-2.5 align-top",
                        alignmentClassName(alignments[cellIndex]),
                      )}
                    >
                      {inlineMarkdown(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const classes =
        level === 1
          ? "mt-8 text-2xl"
          : level === 2
            ? "mt-7 text-xl"
            : level === 3
              ? "mt-6 text-base"
              : "mt-5 text-sm";
      const children = inlineMarkdown(heading[2]);
      blocks.push(
        level === 1 ? (
          <h1
            key={blocks.length}
            className={cn("font-semibold text-zinc-950 tracking-tight", classes)}
          >
            {children}
          </h1>
        ) : level === 2 ? (
          <h2
            key={blocks.length}
            className={cn("font-semibold text-zinc-950 tracking-tight", classes)}
          >
            {children}
          </h2>
        ) : level === 3 ? (
          <h3 key={blocks.length} className={cn("font-semibold text-zinc-950", classes)}>
            {children}
          </h3>
        ) : (
          <h4 key={blocks.length} className={cn("font-semibold text-zinc-900", classes)}>
            {children}
          </h4>
        ),
      );
      index += 1;
      continue;
    }

    if (/^\s*(---+|___+)\s*$/.test(line)) {
      blocks.push(<hr key={blocks.length} className="my-6 border-zinc-200" />);
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(
        <blockquote key={blocks.length} className="border-zinc-300 border-l-2 pl-4 text-zinc-600">
          {inlineMarkdown(quote.join(" "))}
        </blockquote>,
      );
      continue;
    }

    if (listLine(line)) {
      const parsed = parseMarkdownList(lines, index);
      blocks.push(renderMarkdownList(parsed.list, blocks.length));
      index = parsed.nextIndex;
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !blockStart(lines[index]) &&
      !isTableStart(lines, index)
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push(<p key={blocks.length}>{inlineMarkdown(paragraph.join(" "))}</p>);
  }

  return (
    <article
      className={cn(
        "space-y-4 text-[15px] text-zinc-700 leading-7 [&>:first-child]:mt-0",
        className,
      )}
    >
      {blocks}
    </article>
  );
}
