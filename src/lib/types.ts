export type LlmServiceType = "openai" | "anthropic";
export type TaskType =
  | "writing"
  | "summary"
  | "assistant"
  | "chat"
  | "review"
  | "revisionPlan"
  | "revisionExecution"
  | "translationBlueprint"
  | "translationDraft"
  | "translationProofread"
  | "translationFidelity"
  | "translationPolish";
export type BlockType = "text" | "checkpoint";
export type AssistantScope = "setup" | "chapter";
export type AssistantDecision = "pending" | "accepted" | "rejected" | "superseded";
export type AssistantAction =
  | "update_project_field"
  | "create_character"
  | "update_character"
  | "create_chapter"
  | "update_chapter_synopsis"
  | "create_text_block"
  | "update_block_synopsis";
export type AssistantResourceType = "project" | "chapter" | "block" | "character" | "attachment";
export type UiLocale = "en" | "zh-CN";

export interface Project {
  id: string;
  name: string;
  synopsis: string;
  proseStyle: string;
  language: string;
  modelOverrides: Partial<Record<TaskType, string | null>>;
  createdAt: string;
  updatedAt: string;
  chapterCount?: number;
  characterCount?: number;
}

export interface Character {
  id: string;
  projectId: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface Chapter {
  id: string;
  projectId: string;
  title: string;
  synopsis: string;
  sortOrder: number;
  characterMode: "all" | "selected";
  characterIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Swipe {
  id: string;
  blockId: string;
  content: string;
  createdAt: string;
}

interface BlockBase {
  id: string;
  chapterId: string;
  synopsis: string;
  sortOrder: number;
  currentSwipeId: string;
  stale: boolean;
  swipes: Swipe[];
  createdAt: string;
  updatedAt: string;
}

export interface TextBlock extends BlockBase {
  type: "text";
}

export interface CheckpointBlock extends BlockBase {
  type: "checkpoint";
}

export type Block = TextBlock | CheckpointBlock;

export interface LlmModel {
  id: string;
  serviceId: string;
  modelId: string;
  displayName: string;
  /** Context capacity in thousands of tokens: 128 = 128K, 1000 = 1M. */
  contextWindowK: number;
  customBody: string;
  inputPrice: number | null;
  cacheReadPrice: number | null;
  cacheWritePrice: number | null;
  outputPrice: number | null;
}

export interface UsageBreakdown {
  input: number;
  cached: number;
  output: number;
  calls: number;
  cost: number | null;
}

export interface UsageReport {
  totals: UsageBreakdown & { unpriced: number };
  byFeature: Array<UsageBreakdown & { feature: TaskType }>;
  byModel: Array<UsageBreakdown & { service: string; model: string }>;
  byDay: Array<UsageBreakdown & { day: string }>;
}

export interface LlmService {
  id: string;
  name: string;
  type: LlmServiceType;
  baseUrl: string;
  apiKey: string;
  models: LlmModel[];
}

export interface AppSettings {
  uiLanguage: UiLocale | null;
  language: string;
  globalDefaultModel: string | null;
  taskModels: Partial<Record<TaskType, string | null>>;
  replyCaps: Partial<Record<TaskType, number | null>>;
  characterChatMaxConsecutiveReplies: number;
  translationConcurrency: number;
  /** Global source-window ceiling for translation execution; null is automatic. */
  translationWindowTokenLimit: number | null;
  /** Global source-window ceiling for novel revision execution; null is automatic. */
  revisionWindowTokenLimit: number | null;
  reviewerPrompts: ReviewerPrompt[];
}

export type TranslationStage = "draft" | "proofread" | "fidelity" | "polish";
export type TranslationBlueprintStatus =
  | "queued"
  | "generating"
  | "generation_failed"
  | "ready"
  | "executing"
  | "paused"
  | "execution_failed"
  | "completed"
  | "cancelled";
export type BackgroundJobStatus =
  | "queued"
  | "running"
  | "paused"
  | "failed"
  | "completed"
  | "cancelled";

export interface TranslationStageConfig {
  stage: TranslationStage;
  enabled: boolean;
  modelId: string | null;
}

export interface TranslationProjectSummary {
  id: string;
  name: string;
  sourceFileName: string;
  sourceFormat: "txt" | "md";
  sourceLanguage: string;
  sourceCharacterCount: number;
  sourceLockedAt: string | null;
  blueprintCount: number;
  activeJobCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TranslationJob {
  id: string;
  kind: "blueprint_generation" | "translation_execution";
  status: BackgroundJobStatus;
  progressCurrent: number;
  progressTotal: number;
  message: string;
  error: string;
  createdAt: string;
  updatedAt: string;
}

export interface TranslationBlueprint {
  id: string;
  projectId: string;
  ordinal: number;
  name: string;
  targetLanguage: string;
  sourceLanguage: string;
  instructions: string;
  content: string;
  generationModelId: string | null;
  stageConfig: TranslationStageConfig[];
  /** System window ceiling captured when translation execution started. */
  windowTokenLimit: number | null;
  /** Effective source-window size selected when execution started. */
  executionWindowTokens: number | null;
  status: TranslationBlueprintStatus;
  clonedFromBlueprintId: string | null;
  lockedAt: string | null;
  completedStages: TranslationStage[];
  availableStages: TranslationStage[];
  job: TranslationJob | null;
  createdAt: string;
  updatedAt: string;
}

export interface TranslationProjectDetail extends TranslationProjectSummary {
  sourceContent: string;
  sourceHasBom: boolean;
  sourceLineEnding: "lf" | "crlf" | "cr";
  blueprints: TranslationBlueprint[];
}

export interface TranslationOutput {
  stage: TranslationStage;
  content: string;
  partialContent: string;
  completedWindowCount: number;
  totalWindowCount: number;
}

export interface ReviewerPrompt {
  id: string;
  name: string;
  prompt: string;
}

export interface ProjectReview {
  id: string;
  projectId: string;
  reviewerId: string;
  reviewerName: string;
  reviewerPrompt: string;
  modelId: string | null;
  chapterId: string | null;
  chapterTitle: string | null;
  content: string;
  status: "pending" | "generating" | "completed" | "failed";
  createdAt: string;
  updatedAt: string;
}

export type ProjectRevisionStatus =
  | "draft"
  | "planning"
  | "blueprint_ready"
  | "blueprint_failed"
  | "executing"
  | "paused"
  | "execution_failed"
  | "completed";
export type ProjectRevisionWindowStatus = "pending" | "generating" | "completed" | "failed";

export interface ProjectRevisionBlueprint {
  id: string;
  revisionId: string;
  version: number;
  modelId: string;
  requirements: string;
  status: "generating" | "completed" | "failed";
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectRevisionSourceChapter {
  id: string;
  revisionId: string;
  sourceChapterId: string;
  title: string;
  sortOrder: number;
  sourceContent: string;
}

export interface ProjectRevisionWindow {
  id: string;
  revisionId: string;
  blueprintId: string;
  sourceChapterSnapshotId: string;
  sourceChapterNumber: number;
  sourceChapterTitle: string;
  chapterWindowIndex: number;
  chapterWindowCount: number;
  documentWindowIndex: number;
  documentWindowCount: number;
  mode: "copy" | "generate";
  sourceContent: string;
  outputContent: string;
  status: ProjectRevisionWindowStatus;
}

export interface ProjectRevisionSummary {
  id: string;
  projectId: string;
  reviewId: string | null;
  name: string;
  sourceProjectName: string;
  reviewerName: string;
  reviewChapterId: string | null;
  reviewChapterTitle: string | null;
  requirements: string;
  planModelId: string | null;
  executionModelId: string | null;
  /** System window ceiling captured when revision execution first started. */
  windowTokenLimit: number | null;
  /** Effective source-window size selected when execution first started. */
  executionWindowTokens: number | null;
  status: ProjectRevisionStatus;
  sourceChapterCount: number;
  windowCount: number;
  completedWindowCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectRevisionDetail extends ProjectRevisionSummary {
  reviewContent: string;
  activeBlueprint: ProjectRevisionBlueprint | null;
  sourceChapters: ProjectRevisionSourceChapter[];
  windows: ProjectRevisionWindow[];
  resultMarkdown: string;
}

export interface CharacterChatContextSettings {
  includeStorySynopsis: boolean;
  chapterIds: string[];
  characterIds: string[];
  preferChapterSynopsis: boolean;
  allowCharacterMentions: boolean;
}

export interface CharacterChatSession {
  id: string;
  chatId: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CharacterChatMessage {
  id: string;
  sessionId: string;
  role: "author" | "character";
  characterId: string | null;
  content: string;
  createdAt: string;
}

export interface CharacterChatSummary {
  id: string;
  projectId: string;
  members: Character[];
  userCharacter: Character | null;
  contextSettings: CharacterChatContextSettings;
  sessionCount: number;
  updatedAt: string;
}

export interface CharacterChatDetail extends CharacterChatSummary {
  sessions: CharacterChatSession[];
  activeSessionId: string | null;
  messages: CharacterChatMessage[];
}

export interface ChapterDetail {
  chapter: Chapter;
  project: Project;
  characters: Character[];
  allCharacters: Character[];
  blocks: Block[];
  settings: AppSettings;
  services: LlmService[];
}

export interface AssistantProposalItem {
  id: string;
  proposalId: string;
  action: AssistantAction;
  label: string;
  payload: Record<string, unknown>;
  decision: AssistantDecision;
  appliedEntityId: string | null;
  supersedesItemId: string | null;
  supersededByItemId: string | null;
  sortOrder: number;
  updatedAt: string;
}

export interface AssistantProposal {
  id: string;
  messageId: string;
  title: string;
  description: string;
  supersedesProposalId: string | null;
  supersededByProposalId: string | null;
  createdAt: string;
  items: AssistantProposalItem[];
}

export interface AssistantMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  scope: AssistantScope;
  createdAt: string;
  proposals: AssistantProposal[];
  references: AssistantResourceRef[];
  activities: AssistantToolActivity[];
}

export interface AssistantResourceRef {
  type: AssistantResourceType;
  id: string;
  label: string;
  description?: string;
}

export interface AssistantToolActivity {
  toolName: string;
  label: string;
}

export interface AssistantAttachment {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface AssistantConversation {
  id: string | null;
  projectId: string;
  scope: AssistantScope;
  contextId: string | null;
  messages: AssistantMessage[];
  attachments: AssistantAttachment[];
}

export const getBlockContent = (block: Block) =>
  block.swipes.find((swipe) => swipe.id === block.currentSwipeId)?.content ?? "";
