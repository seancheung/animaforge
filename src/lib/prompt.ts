import { ApiError } from "@/lib/api";
import { formatEntityRelation } from "@/lib/entity-relation";
import { mergeStyleInstructions } from "@/lib/style-fingerprint";
import { type Block, type Chapter, type ChapterDetail, getBlockContent } from "@/lib/types";

export interface GenerationOptions {
  mode: "content" | "checkpoint" | "blockSynopsis" | "chapterSynopsis";
  instructions?: string;
  includeBlockSynopsis?: boolean;
  includeChapterSynopsis?: boolean;
  chapterBlocks?: ContextSourceMode;
  adjacentBlocks?: AdjacentBlockMode;
  previousChapter?: ContextSourceMode;
  nextChapter?: ContextSourceMode;
  checkpointFullRebuild?: boolean;
}

export type ContextSourceMode = "ignore" | "synopsis" | "content";
export type AdjacentBlockMode = "inherit" | "synopsis" | "content";

export interface AdjacentChapterContext {
  chapter: Chapter;
  blocks: Block[];
}

export interface AdjacentChaptersContext {
  previous?: AdjacentChapterContext;
  next?: AdjacentChapterContext;
}

const xml = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const element = (name: string, value: string, attrs = "") =>
  value.trim() ? `<${name}${attrs}>${xml(value)}</${name}>` : "";

function blockContextValue(block: Block, mode: ContextSourceMode) {
  if (mode === "ignore") return null;
  if (mode === "synopsis")
    return block.synopsis.trim() ? { tag: "block_synopsis", value: block.synopsis } : null;
  const content = getBlockContent(block);
  if (content.trim()) return { tag: "block_content", value: content };
  if (block.synopsis.trim()) return { tag: "block_synopsis", value: block.synopsis };
  return null;
}

function adjacentChapterElements(
  tag: "previous_chapter" | "next_chapter",
  context: AdjacentChapterContext,
  mode: ContextSourceMode,
) {
  if (mode === "ignore") return [];
  const content = context.blocks
    .filter((block) => block.type === "text")
    .map(getBlockContent)
    .filter(Boolean)
    .join("\n\n");
  const selected =
    mode === "synopsis"
      ? context.chapter.synopsis.trim()
        ? { tag: "chapter_synopsis", value: context.chapter.synopsis }
        : null
      : content.trim()
        ? { tag: "chapter_content", value: content }
        : context.chapter.synopsis.trim()
          ? { tag: "chapter_synopsis", value: context.chapter.synopsis }
          : null;
  if (!selected) return [];
  return [
    `<${tag} id="${context.chapter.id}" sort="${context.chapter.sortOrder}">`,
    element("chapter_title", context.chapter.title),
    element(selected.tag, selected.value),
    `</${tag}>`,
  ];
}

export function buildPrompt(
  detail: ChapterDetail,
  blockId: string | undefined,
  options: GenerationOptions,
  adjacent: AdjacentChaptersContext = {},
) {
  const block = detail.blocks.find((item) => item.id === blockId);
  if (options.mode !== "chapterSynopsis" && !block) throw new ApiError("blockNotFound", 404);
  const outputLanguage = detail.project.language.trim() || detail.settings.language.trim();
  const entityNames = new Map(detail.entities.map((entity) => [entity.id, entity.name]));

  const project = [
    "<project>",
    element("project_name", detail.project.name),
    element("project_synopsis", detail.project.synopsis),
    element(
      "prose_style",
      mergeStyleInstructions(detail.styleFingerprint, detail.project.proseStyle),
    ),
    "<entities>",
    ...detail.entities.map((entity) =>
      [
        `<entity id="${entity.id}" type="${xml(entity.type.systemKey ?? entity.type.name)}">`,
        element("entity_name", entity.name),
        element("entity_description", entity.description),
        "</entity>",
      ].join("\n"),
    ),
    "</entities>",
    "<entity_relations>",
    ...detail.relations.map((relation) =>
      [
        `<relation id="${relation.id}" source_entity_id="${relation.sourceEntityId}" target_entity_id="${relation.targetEntityId}">`,
        element("relation_expression", relation.name),
        element(
          "relation_statement",
          formatEntityRelation(
            relation.name,
            entityNames.get(relation.sourceEntityId) ?? relation.sourceEntityId,
            entityNames.get(relation.targetEntityId) ?? relation.targetEntityId,
          ),
        ),
        element("relation_description", relation.description),
        "</relation>",
      ].join("\n"),
    ),
    "</entity_relations>",
  ];

  const adjacentElements: string[] = [];
  const previousChapterMode = options.previousChapter ?? "ignore";
  const nextChapterMode = options.nextChapter ?? "ignore";
  if (adjacent.previous)
    adjacentElements.push(
      ...adjacentChapterElements("previous_chapter", adjacent.previous, previousChapterMode),
    );
  if (adjacent.next)
    adjacentElements.push(
      ...adjacentChapterElements("next_chapter", adjacent.next, nextChapterMode),
    );
  if (adjacentElements.length)
    project.push("<adjacent_chapters>", ...adjacentElements, "</adjacent_chapters>");

  project.push(
    `<chapter id="${detail.chapter.id}" sort="${detail.chapter.sortOrder}">`,
    element("chapter_title", detail.chapter.title),
    options.includeChapterSynopsis !== false
      ? element("chapter_synopsis", detail.chapter.synopsis)
      : "",
  );

  if (options.mode === "checkpoint" && block) {
    const before = detail.blocks.filter((item) => item.sortOrder < block.sortOrder);
    const previousCheckpoint = [...before].reverse().find((item) => item.type === "checkpoint");
    if (previousCheckpoint?.stale && !options.checkpointFullRebuild) {
      throw new ApiError("previousCheckpointStale");
    }

    if (previousCheckpoint && !options.checkpointFullRebuild) {
      const contentSinceCheckpoint = before
        .filter((item) => item.type === "text" && item.sortOrder > previousCheckpoint.sortOrder)
        .map(getBlockContent)
        .filter(Boolean)
        .join("\n\n");
      project.push(
        element(
          "previous_checkpoint",
          getBlockContent(previousCheckpoint),
          ` id="${previousCheckpoint.id}"`,
        ),
        "<content_since_checkpoint>",
        xml(contentSinceCheckpoint),
        "</content_since_checkpoint>",
      );
    } else {
      const priorText = before
        .filter((item) => item.type === "text")
        .map(getBlockContent)
        .filter(Boolean)
        .join("\n\n");
      project.push("<content_to_summarize>", xml(priorText), "</content_to_summarize>");
    }
  } else if (options.mode === "chapterSynopsis") {
    const content = detail.blocks
      .filter((item) => item.type === "text")
      .map(getBlockContent)
      .filter(Boolean)
      .join("\n\n");
    project.push("<chapter_content>", xml(content), "</chapter_content>");
  } else if (block) {
    const chapterBlockMode = options.chapterBlocks ?? "synopsis";
    const adjacentBlockMode = options.adjacentBlocks ?? "content";
    let previousBlocks: string[] = [];
    let followingBlocks: string[] = [];
    if (chapterBlockMode !== "ignore" || adjacentBlockMode !== "inherit") {
      const before = detail.blocks.filter((item) => item.sortOrder < block.sortOrder);
      const after = detail.blocks.filter((item) => item.sortOrder > block.sortOrder);
      const previousAdjacentId = before.at(-1)?.id;
      const nextAdjacentId = after[0]?.id;
      const serializeBlock = (item: Block) => {
        const isAdjacent = item.id === previousAdjacentId || item.id === nextAdjacentId;
        const mode =
          isAdjacent && adjacentBlockMode !== "inherit" ? adjacentBlockMode : chapterBlockMode;
        const chosen = blockContextValue(item, mode);
        return chosen
          ? [
              `<block id="${item.id}" sort="${item.sortOrder}" type="${item.type}">`,
              element(chosen.tag, chosen.value),
              "</block>",
            ]
          : [];
      };
      previousBlocks = before.flatMap(serializeBlock);
      followingBlocks = after.flatMap(serializeBlock);
    }

    if (previousBlocks.length) {
      project.push(
        '<preceding_block_context purpose="established_context">',
        ...previousBlocks,
        "</preceding_block_context>",
      );
    }
    project.push(`<target_block id="${block.id}" sort="${block.sortOrder}" type="${block.type}">`);
    if (options.includeBlockSynopsis !== false)
      project.push(element("target_block_synopsis", block.synopsis));
    if (options.mode === "blockSynopsis")
      project.push(element("target_block_content", getBlockContent(block)));
    if (
      options.mode === "content" &&
      options.instructions?.trim() &&
      getBlockContent(block).trim()
    ) {
      project.push(element("old_block_content", getBlockContent(block)));
    }
    project.push("</target_block>");
    if (followingBlocks.length) {
      project.push(
        '<following_block_context purpose="future_boundary_do_not_write">',
        ...followingBlocks,
        "</following_block_context>",
      );
    }
  }

  project.push("</chapter>", "</project>");

  const oldBlockContent = block ? getBlockContent(block).trim() : "";
  const blockBoundaryInstruction =
    "Treat preceding_block_context as events and facts that have already happened; do not unnecessarily retell them. Treat following_block_context only as a future continuity boundary. Do not copy, paraphrase, foreshadow in detail, or enact events that belong to following_block_context. Write only target_block and end before the following blocks begin.";
  const tasks = {
    content: options.instructions?.trim()
      ? oldBlockContent
        ? `Rewrite only target_block according to the revision request. ${blockBoundaryInstruction} Return only the revised fiction prose, with no explanation.\n<revision_request>${xml(options.instructions)}</revision_request>`
        : `Write only target_block according to target_block_synopsis, the optional generation requirements, and the provided context. ${blockBoundaryInstruction} Return only the fiction prose, with no title, explanation, or XML tags.\n<generation_requirements>${xml(options.instructions)}</generation_requirements>`
      : `Write or regenerate only target_block using target_block_synopsis and the provided context. ${blockBoundaryInstruction} Return only the fiction prose, with no title, explanation, or XML tags.`,
    checkpoint:
      "Create an updated checkpoint summary. When previous_checkpoint is present, preserve its established facts and merge them with content_since_checkpoint. Otherwise summarize content_to_summarize. Preserve key events, character states, unresolved threads, and narrative setups. Return only a concise standalone summary.",
    blockSynopsis: `Create a concise plot synopsis only for target_block that states what happens and its narrative purpose. ${blockBoundaryInstruction} Do not merge future events from following_block_context into this synopsis. Return only the synopsis.`,
    chapterSynopsis:
      "Create or revise the chapter synopsis, covering the main plot progression, turning points, and outcome. Return only the synopsis.",
  };

  const languageRequirement = outputLanguage
    ? `\n\n<output_requirements>\n${element("output_language", outputLanguage)}\n</output_requirements>`
    : "";
  const languageInstruction = outputLanguage
    ? "\nWrite the response in the language specified by output_language."
    : "";

  return `${project.filter(Boolean).join("\n")}${languageRequirement}\n\n<task>\n${tasks[options.mode]}${languageInstruction}\n</task>`;
}
