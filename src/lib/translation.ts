import type { Knex } from "knex";
import { ApiError } from "@/lib/api";
import { abortBackgroundJob } from "@/lib/background-registry";
import { loadServices, loadSettings } from "@/lib/data";
import { getDb, newId, parseJson } from "@/lib/db";
import { calculateSourceWindowTokens, splitTextWindowsByTokens } from "@/lib/token-windows";
import type {
  BackgroundJobStatus,
  TranslationBlueprint,
  TranslationBlueprintStatus,
  TranslationJob,
  TranslationOutput,
  TranslationProjectDetail,
  TranslationProjectSummary,
  TranslationStage,
  TranslationStageConfig,
} from "@/lib/types";

type Row = Record<string, unknown>;

export const TRANSLATION_STAGES: TranslationStage[] = ["draft", "proofread", "fidelity", "polish"];

const blueprintStatuses = new Set<TranslationBlueprintStatus>([
  "queued",
  "generating",
  "generation_failed",
  "ready",
  "executing",
  "paused",
  "execution_failed",
  "completed",
  "cancelled",
]);
const jobStatuses = new Set<BackgroundJobStatus>([
  "queued",
  "running",
  "paused",
  "failed",
  "completed",
  "cancelled",
]);

export function normalizeStageConfig(value: unknown): TranslationStageConfig[] {
  const rows = Array.isArray(value) ? value : [];
  const mapped = new Map<TranslationStage, TranslationStageConfig>();
  for (const item of rows) {
    if (!item || typeof item !== "object") continue;
    const input = item as Partial<TranslationStageConfig>;
    if (!TRANSLATION_STAGES.includes(input.stage as TranslationStage)) continue;
    mapped.set(input.stage as TranslationStage, {
      stage: input.stage as TranslationStage,
      enabled: input.stage === "draft" ? true : input.enabled !== false,
      modelId:
        typeof input.modelId === "string" && input.modelId.trim() ? input.modelId.trim() : null,
    });
  }
  return TRANSLATION_STAGES.map(
    (stage) => mapped.get(stage) ?? { stage, enabled: true, modelId: null },
  );
}

function mapJob(row?: Row): TranslationJob | null {
  if (!row) return null;
  const status = String(row.status);
  return {
    id: String(row.id),
    kind: row.kind === "blueprint_generation" ? "blueprint_generation" : "translation_execution",
    status: jobStatuses.has(status as BackgroundJobStatus)
      ? (status as BackgroundJobStatus)
      : "failed",
    progressCurrent: Number(row.progress_current ?? 0),
    progressTotal: Number(row.progress_total ?? 0),
    message: String(row.message ?? ""),
    error: String(row.error ?? ""),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapBlueprint(row: Row, job: Row | undefined, outputRows: Row[]): TranslationBlueprint {
  const status = String(row.status);
  const availableStages = TRANSLATION_STAGES.filter((stage) =>
    outputRows.some((output) => output.stage === stage),
  );
  const completedStages = TRANSLATION_STAGES.filter((stage) => {
    const rows = outputRows.filter((output) => output.stage === stage);
    return rows.length > 0 && rows.every((output) => output.status === "completed");
  });
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    ordinal: Number(row.ordinal),
    name: String(row.name),
    targetLanguage: String(row.target_language),
    sourceLanguage: String(row.source_language ?? ""),
    instructions: String(row.instructions ?? ""),
    content: String(row.content ?? ""),
    generationModelId: row.generation_model_id ? String(row.generation_model_id) : null,
    stageConfig: normalizeStageConfig(parseJson(String(row.stage_config ?? "[]"), [])),
    windowTokenLimit: row.window_token_limit == null ? null : Number(row.window_token_limit),
    executionWindowTokens:
      row.execution_window_tokens == null ? null : Number(row.execution_window_tokens),
    status: blueprintStatuses.has(status as TranslationBlueprintStatus)
      ? (status as TranslationBlueprintStatus)
      : "generation_failed",
    clonedFromBlueprintId: row.cloned_from_blueprint_id
      ? String(row.cloned_from_blueprint_id)
      : null,
    lockedAt: row.locked_at ? String(row.locked_at) : null,
    completedStages,
    availableStages,
    job: mapJob(job),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapProject(row: Row): TranslationProjectSummary {
  return {
    id: String(row.id),
    name: String(row.name),
    sourceFileName: String(row.source_file_name),
    sourceFormat: row.source_format === "md" ? "md" : "txt",
    sourceLanguage: String(row.source_language ?? ""),
    sourceCharacterCount: Number(
      row.source_character_count ?? String(row.source_content ?? "").length,
    ),
    sourceLockedAt: row.source_locked_at ? String(row.source_locked_at) : null,
    blueprintCount: Number(row.blueprint_count ?? 0),
    activeJobCount: Number(row.active_job_count ?? 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function loadTranslationProjects(): Promise<TranslationProjectSummary[]> {
  const conn = await getDb();
  const rows = (await conn("translation_projects as projects")
    .select("projects.*")
    .select(conn.raw("length(projects.source_content) as source_character_count"))
    .select(
      conn.raw(
        "(select count(*) from translation_blueprints where translation_blueprints.project_id = projects.id) as blueprint_count",
      ),
    )
    .select(
      conn.raw(
        "(select count(*) from background_jobs where background_jobs.translation_project_id = projects.id and background_jobs.status in ('queued','running')) as active_job_count",
      ),
    )
    .orderBy("projects.updated_at", "desc")) as Row[];
  return rows.map(mapProject);
}

async function loadBlueprintRelations(conn: Knex, blueprintRows: Row[]) {
  const ids = blueprintRows.map((row) => String(row.id));
  if (!ids.length) return { jobs: [] as Row[], outputs: [] as Row[] };
  const [jobs, outputs] = await Promise.all([
    conn("background_jobs")
      .whereIn("translation_blueprint_id", ids)
      .orderBy("created_at", "desc") as Promise<Row[]>,
    conn("translation_window_outputs")
      .whereIn("blueprint_id", ids)
      .select("blueprint_id", "stage", "status") as Promise<Row[]>,
  ]);
  return { jobs, outputs };
}

export async function loadTranslationProject(
  projectId: string,
  includeSource = true,
): Promise<TranslationProjectDetail> {
  const conn = await getDb();
  const row = (await conn("translation_projects").where({ id: projectId }).first()) as
    | Row
    | undefined;
  if (!row) throw new ApiError("translationProjectNotFound", 404);
  const blueprintRows = (await conn("translation_blueprints")
    .where({ project_id: projectId })
    .orderBy("ordinal", "desc")) as Row[];
  const { jobs, outputs } = await loadBlueprintRelations(conn, blueprintRows);
  return {
    ...mapProject({
      ...row,
      blueprint_count: blueprintRows.length,
      active_job_count: jobs.filter((job) => job.status === "queued" || job.status === "running")
        .length,
    }),
    sourceContent: includeSource ? String(row.source_content) : "",
    sourceHasBom: Boolean(row.source_has_bom),
    sourceLineEnding:
      row.source_line_ending === "crlf" || row.source_line_ending === "cr"
        ? row.source_line_ending
        : "lf",
    blueprints: blueprintRows.map((blueprint) =>
      mapBlueprint(
        blueprint,
        jobs.find((job) => job.translation_blueprint_id === blueprint.id),
        outputs.filter((output) => output.blueprint_id === blueprint.id),
      ),
    ),
  };
}

export async function loadTranslationSourceContent(projectId: string) {
  const conn = await getDb();
  const row = (await conn("translation_projects")
    .where({ id: projectId })
    .select("source_content")
    .first()) as Row | undefined;
  if (!row) throw new ApiError("translationProjectNotFound", 404);
  return String(row.source_content ?? "");
}

export async function loadTranslationBlueprint(blueprintId: string): Promise<TranslationBlueprint> {
  const conn = await getDb();
  const row = (await conn("translation_blueprints").where({ id: blueprintId }).first()) as
    | Row
    | undefined;
  if (!row) throw new ApiError("translationBlueprintNotFound", 404);
  const { jobs, outputs } = await loadBlueprintRelations(conn, [row]);
  return mapBlueprint(row, jobs[0], outputs);
}

export async function createTranslationProject(input: {
  name: string;
  sourceFileName: string;
  sourceFormat: "txt" | "md";
  sourceLanguage: string;
  sourceContent: string;
  sourceHasBom: boolean;
  sourceLineEnding: "lf" | "crlf" | "cr";
}) {
  const conn = await getDb();
  const id = newId();
  await conn("translation_projects").insert({
    id,
    name:
      input.name.trim() ||
      input.sourceFileName.replace(/\.(?:txt|md|markdown)$/i, "") ||
      "Translation",
    source_file_name: input.sourceFileName,
    source_format: input.sourceFormat,
    source_language: input.sourceLanguage.trim(),
    source_content: input.sourceContent,
    source_has_bom: input.sourceHasBom ? 1 : 0,
    source_line_ending: input.sourceLineEnding,
  });
  return loadTranslationProject(id, false);
}

export async function updateTranslationProject(projectId: string, name: string) {
  const conn = await getDb();
  if (
    !(await conn("translation_projects")
      .where({ id: projectId })
      .update({ name: name.trim() || "Translation", updated_at: conn.fn.now() }))
  )
    throw new ApiError("translationProjectNotFound", 404);
  return loadTranslationProject(projectId, false);
}

export async function deleteTranslationProject(projectId: string) {
  const conn = await getDb();
  const active = await conn("background_jobs")
    .where({ translation_project_id: projectId })
    .whereIn("status", ["queued", "running"])
    .first();
  if (active) throw new ApiError("translationProjectBusy", 409);
  if (!(await conn("translation_projects").where({ id: projectId }).delete()))
    throw new ApiError("translationProjectNotFound", 404);
}

async function nextBlueprintOrdinal(trx: Knex.Transaction, projectId: string) {
  const row = (await trx("translation_blueprints")
    .where({ project_id: projectId })
    .max({ ordinal: "ordinal" })
    .first()) as { ordinal?: number | string } | undefined;
  return Number(row?.ordinal ?? 0) + 1;
}

export async function createGeneratedBlueprint(
  projectId: string,
  input: {
    name?: string;
    targetLanguage: string;
    instructions?: string;
    generationModelId?: string | null;
    stageConfig?: unknown;
  },
) {
  const targetLanguage = input.targetLanguage.trim();
  if (!targetLanguage) throw new ApiError("translationTargetLanguageRequired", 400);
  const conn = await getDb();
  const project = (await conn("translation_projects").where({ id: projectId }).first()) as
    | Row
    | undefined;
  if (!project) throw new ApiError("translationProjectNotFound", 404);
  const id = newId();
  const jobId = newId();
  await conn.transaction(async (trx) => {
    const ordinal = await nextBlueprintOrdinal(trx, projectId);
    await trx("translation_blueprints").insert({
      id,
      project_id: projectId,
      ordinal,
      name: input.name?.trim() || `Blueprint ${ordinal}`,
      target_language: targetLanguage,
      source_language: String(project.source_language ?? ""),
      instructions: input.instructions?.trim() || "",
      generation_model_id: input.generationModelId?.trim() || null,
      stage_config: JSON.stringify(normalizeStageConfig(input.stageConfig)),
      status: "queued",
    });
    await trx("background_jobs").insert({
      id: jobId,
      kind: "blueprint_generation",
      translation_project_id: projectId,
      translation_blueprint_id: id,
      status: "queued",
      message: "Waiting to analyze source",
    });
    await trx("translation_projects")
      .where({ id: projectId })
      .update({
        source_locked_at: project.source_locked_at ?? trx.fn.now(),
        updated_at: trx.fn.now(),
      });
  });
  return loadTranslationBlueprint(id);
}

export async function cloneTranslationBlueprint(blueprintId: string, name?: string) {
  const conn = await getDb();
  const source = (await conn("translation_blueprints").where({ id: blueprintId }).first()) as
    | Row
    | undefined;
  if (!source) throw new ApiError("translationBlueprintNotFound", 404);
  if (!String(source.content ?? "").trim()) throw new ApiError("translationBlueprintEmpty", 409);
  const id = newId();
  await conn.transaction(async (trx) => {
    const ordinal = await nextBlueprintOrdinal(trx, String(source.project_id));
    await trx("translation_blueprints").insert({
      id,
      project_id: source.project_id,
      ordinal,
      name: name?.trim() || `${String(source.name)} Copy`,
      target_language: source.target_language,
      source_language: source.source_language,
      instructions: source.instructions,
      content: source.content,
      generation_model_id: source.generation_model_id,
      stage_config: source.stage_config,
      status: "ready",
      cloned_from_blueprint_id: source.id,
    });
  });
  return loadTranslationBlueprint(id);
}

export async function updateTranslationBlueprint(
  blueprintId: string,
  input: {
    name?: string;
    targetLanguage?: string;
    instructions?: string;
    content?: string;
    generationModelId?: string | null;
    stageConfig?: unknown;
  },
) {
  const conn = await getDb();
  const row = (await conn("translation_blueprints").where({ id: blueprintId }).first()) as
    | Row
    | undefined;
  if (!row) throw new ApiError("translationBlueprintNotFound", 404);
  if (row.locked_at) throw new ApiError("translationBlueprintLocked", 409);
  const active = await conn("background_jobs")
    .where({ translation_blueprint_id: blueprintId })
    .whereIn("status", ["queued", "running", "paused"])
    .first();
  if (active) throw new ApiError("translationBlueprintBusy", 409);
  const update: Record<string, unknown> = { updated_at: conn.fn.now() };
  if (input.name !== undefined) update.name = input.name.trim() || String(row.name);
  if (input.targetLanguage !== undefined) {
    if (!input.targetLanguage.trim()) throw new ApiError("translationTargetLanguageRequired", 400);
    update.target_language = input.targetLanguage.trim();
  }
  if (input.instructions !== undefined) update.instructions = input.instructions;
  if (input.content !== undefined) {
    update.content = input.content;
    update.status = input.content.trim() ? "ready" : "generation_failed";
  }
  if (input.generationModelId !== undefined)
    update.generation_model_id = input.generationModelId?.trim() || null;
  if (input.stageConfig !== undefined)
    update.stage_config = JSON.stringify(normalizeStageConfig(input.stageConfig));
  await conn("translation_blueprints").where({ id: blueprintId }).update(update);
  return loadTranslationBlueprint(blueprintId);
}

export async function deleteTranslationBlueprint(blueprintId: string) {
  const conn = await getDb();
  const row = (await conn("translation_blueprints").where({ id: blueprintId }).first()) as
    | Row
    | undefined;
  if (!row) throw new ApiError("translationBlueprintNotFound", 404);
  if (row.locked_at) throw new ApiError("translationBlueprintLocked", 409);
  const active = await conn("background_jobs")
    .where({ translation_blueprint_id: blueprintId })
    .whereIn("status", ["queued", "running", "paused"])
    .first();
  if (active) throw new ApiError("translationBlueprintBusy", 409);
  await conn("translation_blueprints").where({ id: blueprintId }).delete();
}

export function splitTranslationWindows(content: string, limit = 3500) {
  if (!content) return [""];
  const windows: string[] = [];
  let offset = 0;
  while (offset < content.length) {
    let end = Math.min(content.length, offset + limit);
    if (end < content.length) {
      const floor = offset + Math.floor(limit * 0.55);
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

export async function startTranslationExecution(blueprintId: string) {
  const conn = await getDb();
  const blueprint = (await conn("translation_blueprints").where({ id: blueprintId }).first()) as
    | Row
    | undefined;
  if (!blueprint) throw new ApiError("translationBlueprintNotFound", 404);
  if (blueprint.locked_at) throw new ApiError("translationBlueprintLocked", 409);
  if (!String(blueprint.content ?? "").trim()) throw new ApiError("translationBlueprintEmpty", 409);
  const project = (await conn("translation_projects")
    .where({ id: blueprint.project_id })
    .first()) as Row | undefined;
  if (!project) throw new ApiError("translationProjectNotFound", 404);
  const config = normalizeStageConfig(parseJson(String(blueprint.stage_config ?? "[]"), []));
  const enabled = config.filter((stage) => stage.enabled);
  if (!enabled.length) throw new ApiError("translationStagesRequired", 400);
  const [settings, services] = await Promise.all([loadSettings(), loadServices()]);
  const models = services.flatMap((service) => service.models);
  const stageBudgets = enabled.map((stage) => {
    const task = (
      {
        draft: "translationDraft",
        proofread: "translationProofread",
        fidelity: "translationFidelity",
        polish: "translationPolish",
      } as const
    )[stage.stage];
    const modelId = stage.modelId || settings.taskModels[task] || settings.globalDefaultModel;
    const model = models.find((candidate) => candidate.id === modelId);
    if (!model)
      throw new ApiError(modelId ? "configuredModelMissing" : "translationModelNotConfigured");
    return {
      stage: stage.stage,
      contextWindowTokens: model.contextWindowK * 1_000,
      replyTokenLimit: settings.replyCaps[task],
    };
  });
  let windowTokens: number | null = null;
  for (const stage of stageBudgets) {
    const stageWindowTokens = calculateSourceWindowTokens({
      contextWindowTokens: stage.contextWindowTokens,
      fixedContent: `${String(blueprint.content)}\n${String(blueprint.instructions ?? "")}`,
      fixedPromptOverhead: 4_500,
      inputExpansion: stage.stage === "draft" ? 1 : 2.5,
      outputExpansion: 1.5,
      replyTokenLimit: stage.replyTokenLimit,
      customTokenLimit: settings.translationWindowTokenLimit,
    });
    if (stageWindowTokens == null) {
      windowTokens = null;
      break;
    }
    windowTokens =
      windowTokens == null ? stageWindowTokens : Math.min(windowTokens, stageWindowTokens);
  }
  if (!windowTokens) throw new ApiError("translationContextWindowTooSmall", 409);
  const windows = splitTextWindowsByTokens(String(project.source_content), windowTokens);
  const jobId = newId();
  await conn.transaction(async (trx) => {
    const sourceRows = windows.map((sourceContent, index) => ({
      id: newId(),
      blueprint_id: blueprintId,
      window_index: index,
      window_count: windows.length,
      source_content: sourceContent,
    }));
    await trx("translation_source_windows").insert(sourceRows);
    await trx("translation_window_outputs").insert(
      enabled.flatMap((stage) =>
        sourceRows.map((window) => ({
          id: newId(),
          blueprint_id: blueprintId,
          source_window_id: window.id,
          stage: stage.stage,
          window_index: window.window_index,
          status: "pending",
        })),
      ),
    );
    await trx("translation_blueprints").where({ id: blueprintId }).update({
      status: "executing",
      window_token_limit: settings.translationWindowTokenLimit,
      execution_window_tokens: windowTokens,
      locked_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    });
    await trx("background_jobs").insert({
      id: jobId,
      kind: "translation_execution",
      translation_project_id: blueprint.project_id,
      translation_blueprint_id: blueprintId,
      status: "queued",
      progress_total: sourceRows.length * enabled.length,
      message: "Waiting to translate",
    });
  });
  return loadTranslationBlueprint(blueprintId);
}

export async function controlTranslationJob(
  blueprintId: string,
  action: "pause" | "resume" | "cancel",
) {
  const conn = await getDb();
  const job = (await conn("background_jobs")
    .where({ translation_blueprint_id: blueprintId })
    .orderBy("created_at", "desc")
    .first()) as Row | undefined;
  if (!job) throw new ApiError("translationJobNotFound", 404);
  const status = String(job.status);
  if (action === "pause") {
    if (status === "queued") {
      await conn("background_jobs").where({ id: job.id }).update({
        status: "paused",
        pause_requested: 0,
        retry_count: 0,
        error: "",
        message: "Paused",
        updated_at: conn.fn.now(),
      });
      await conn("translation_blueprints")
        .where({ id: blueprintId })
        .update({ status: "paused", updated_at: conn.fn.now() });
    } else if (status === "running") {
      await conn("background_jobs")
        .where({ id: job.id })
        .update({ pause_requested: 1, message: "Pausing", updated_at: conn.fn.now() });
      abortBackgroundJob(String(job.id));
    }
  } else if (action === "resume") {
    if (!new Set(["paused", "failed"]).has(status))
      throw new ApiError("translationJobControlInvalid", 409);
    await conn("background_jobs").where({ id: job.id }).update({
      status: "queued",
      pause_requested: 0,
      cancel_requested: 0,
      retry_count: 0,
      error: "",
      message: "Queued to continue",
      available_at: conn.fn.now(),
      updated_at: conn.fn.now(),
    });
    await conn("translation_blueprints")
      .where({ id: blueprintId })
      .update({
        status: job.kind === "blueprint_generation" ? "queued" : "executing",
        updated_at: conn.fn.now(),
      });
  } else {
    if (status === "running") {
      await conn("background_jobs")
        .where({ id: job.id })
        .update({ cancel_requested: 1, message: "Cancelling", updated_at: conn.fn.now() });
      abortBackgroundJob(String(job.id));
    } else if (status === "queued" || status === "paused" || status === "failed") {
      await conn("background_jobs").where({ id: job.id }).update({
        status: "cancelled",
        cancel_requested: 0,
        retry_count: 0,
        error: "",
        message: "Cancelled",
        finished_at: conn.fn.now(),
        updated_at: conn.fn.now(),
      });
      await conn("translation_blueprints")
        .where({ id: blueprintId })
        .update({ status: "cancelled", updated_at: conn.fn.now() });
    }
  }
  return loadTranslationBlueprint(blueprintId);
}

export async function loadTranslationOutput(
  blueprintId: string,
  stage: TranslationStage,
): Promise<TranslationOutput> {
  if (!TRANSLATION_STAGES.includes(stage)) throw new ApiError("translationStageInvalid", 400);
  const conn = await getDb();
  if (!(await conn("translation_blueprints").where({ id: blueprintId }).first()))
    throw new ApiError("translationBlueprintNotFound", 404);
  const rows = (await conn("translation_window_outputs")
    .where({ blueprint_id: blueprintId, stage })
    .orderBy("window_index", "asc")) as Row[];
  return {
    stage,
    content: rows
      .filter((row) => row.status === "completed")
      .map((row) => String(row.content ?? ""))
      .join(""),
    partialContent: rows.find((row) => row.status === "generating")
      ? String(rows.find((row) => row.status === "generating")?.partial_content ?? "")
      : "",
    completedWindowCount: rows.filter((row) => row.status === "completed").length,
    totalWindowCount: rows.length,
  };
}
