import { ApiError } from "@/lib/api";
import { loadBlocks, loadServices, loadSettings, mapProject } from "@/lib/data";
import { getDb, newId } from "@/lib/db";
import {
  getBlockContent,
  type LlmModel,
  type LlmService,
  type Project,
  type ProjectReview,
} from "@/lib/types";

type Row = Record<string, unknown>;

function mapReview(row: Row): ProjectReview {
  const status =
    row.status === "completed" || row.status === "failed" || row.status === "generating"
      ? row.status
      : "pending";
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    reviewerId: String(row.reviewer_id),
    reviewerName: String(row.reviewer_name),
    reviewerPrompt: String(row.reviewer_prompt),
    modelId: row.model_id ? String(row.model_id) : null,
    chapterId: row.chapter_id ? String(row.chapter_id) : null,
    chapterTitle: row.chapter_title ? String(row.chapter_title) : null,
    content: String(row.content ?? ""),
    status,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

function escapeXml(value: unknown) {
  return String(value ?? "").replace(
    /[<>&"']/g,
    (character) =>
      ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[character] ??
      character,
  );
}

export async function loadProjectReviews(projectId: string): Promise<ProjectReview[]> {
  const conn = await getDb();
  const rows = (await conn("project_reviews")
    .where({ project_id: projectId })
    .orderBy("created_at", "desc")) as Row[];
  return rows.map(mapReview);
}

export async function loadProjectReview(reviewId: string): Promise<ProjectReview> {
  const conn = await getDb();
  const row = (await conn("project_reviews").where({ id: reviewId }).first()) as Row | undefined;
  if (!row) throw new ApiError("reviewNotFound", 404);
  return mapReview(row);
}

export async function createProjectReview(
  projectId: string,
  reviewerId: string,
  modelId?: string | null,
  chapterId?: string | null,
): Promise<ProjectReview> {
  const conn = await getDb();
  if (!(await conn("projects").where({ id: projectId }).first()))
    throw new ApiError("projectNotFound", 404);
  const settings = await loadSettings();
  const reviewer = settings.reviewerPrompts.find((candidate) => candidate.id === reviewerId);
  if (!reviewer) throw new ApiError("reviewerNotFound", 404);
  const selectedModelId = modelId?.trim() || null;
  if (selectedModelId && !(await conn("llm_models").where({ id: selectedModelId }).first()))
    throw new ApiError("configuredModelMissing");
  const selectedChapterId = chapterId?.trim() || null;
  const chapterRow = selectedChapterId
    ? ((await conn("chapters").where({ id: selectedChapterId, project_id: projectId }).first()) as
        | Row
        | undefined)
    : undefined;
  if (selectedChapterId && !chapterRow) throw new ApiError("chapterNotFound", 404);
  const id = newId();
  await conn("project_reviews").insert({
    id,
    project_id: projectId,
    reviewer_id: reviewer.id,
    reviewer_name: reviewer.name,
    reviewer_prompt: reviewer.prompt,
    model_id: selectedModelId,
    chapter_id: selectedChapterId,
    chapter_title: chapterRow ? String(chapterRow.title) : null,
    content: "",
    status: "pending",
  });
  return loadProjectReview(id);
}

export async function deleteProjectReview(reviewId: string): Promise<void> {
  const conn = await getDb();
  if (!(await conn("project_reviews").where({ id: reviewId }).delete()))
    throw new ApiError("reviewNotFound", 404);
}

interface ReviewGeneration {
  review: ProjectReview;
  project: Project;
  service: LlmService;
  model: LlmModel;
  maxTokens?: number;
  system: string;
  prompt: string;
}

export async function prepareProjectReviewGeneration(reviewId: string): Promise<ReviewGeneration> {
  const conn = await getDb();
  const claimed = await conn("project_reviews")
    .where({ id: reviewId })
    .whereIn("status", ["pending", "failed"])
    .update({ content: "", status: "generating", updated_at: conn.fn.now() });
  if (!claimed) {
    const existing = await conn("project_reviews").where({ id: reviewId }).first();
    if (!existing) throw new ApiError("reviewNotFound", 404);
    throw new ApiError("reviewAlreadyGenerated", 409);
  }

  try {
    const review = await loadProjectReview(reviewId);
    const projectRow = (await conn("projects").where({ id: review.projectId }).first()) as
      | Row
      | undefined;
    if (!projectRow) throw new ApiError("projectNotFound", 404);
    const project = mapProject(projectRow);
    const chapterQuery = conn("chapters")
      .where({ project_id: review.projectId })
      .orderBy("sort_order", "asc");
    if (review.chapterId) chapterQuery.andWhere({ id: review.chapterId });
    const [settings, services, chapterRows] = await Promise.all([
      loadSettings(),
      loadServices(),
      chapterQuery as Promise<Row[]>,
    ]);
    if (review.chapterId && !chapterRows.length) throw new ApiError("chapterNotFound", 404);
    const configuredModel =
      review.modelId ||
      project.modelOverrides.review ||
      settings.taskModels.review ||
      settings.globalDefaultModel;
    if (!configuredModel) throw new ApiError("reviewModelNotConfigured");
    const service = services.find((candidate) =>
      candidate.models.some((model) => model.id === configuredModel),
    );
    const model = service?.models.find((candidate) => candidate.id === configuredModel);
    if (!service || !model) throw new ApiError("configuredModelMissing");

    const chapters = await Promise.all(
      chapterRows.map(async (chapter) => {
        const blocks = await loadBlocks(String(chapter.id));
        const textBlocks = blocks
          .filter((block) => block.type === "text")
          .map(getBlockContent)
          .map((content) => content.trim())
          .filter(Boolean);
        return `  <chapter>\n    <title>${escapeXml(chapter.title)}</title>\n    <text_blocks>\n${textBlocks.map((content) => `      <text_block>${escapeXml(content)}</text_block>`).join("\n")}\n    </text_blocks>\n  </chapter>`;
      }),
    );
    const outputLanguage = project.language.trim() || settings.language.trim();
    const system = `You are the reviewer "${review.reviewerName}". Follow this reviewer perspective exactly:\n${review.reviewerPrompt}\n\nWrite a substantive, candid, and constructive evaluation. Return Markdown only, with useful headings and concrete examples from the supplied work. Do not use tools.${outputLanguage ? ` Write the evaluation in ${outputLanguage}.` : ""}`;
    const prompt = `<manuscript>\n  <project_name>${escapeXml(project.name)}</project_name>\n${chapters.join("\n")}\n</manuscript>\n\n${review.chapterId ? "Evaluate only the supplied chapter" : "Evaluate all supplied chapters"} from your assigned perspective. Base the evaluation only on the manuscript text above.`;
    return {
      review,
      project,
      service,
      model,
      maxTokens: settings.replyCaps.review ?? undefined,
      system,
      prompt,
    };
  } catch (error) {
    await finishProjectReviewGeneration(reviewId, "", "failed");
    throw error;
  }
}

export async function finishProjectReviewGeneration(
  reviewId: string,
  content: string,
  status: "completed" | "failed",
) {
  const conn = await getDb();
  await conn("project_reviews")
    .where({ id: reviewId })
    .update({ content, status, updated_at: conn.fn.now() });
}
