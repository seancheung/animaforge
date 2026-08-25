"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlignLeft,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  BookOpen,
  Boxes,
  ChartNoAxesColumnIncreasing,
  ClipboardPenLine,
  Coins,
  Database,
  Eye,
  Feather,
  FilePenLine,
  FileText,
  Hash,
  ListChecks,
  MessageCircle,
  NotebookTabs,
  PanelLeft,
  Pencil,
  Plus,
  Settings2,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AssistantPanelHeader } from "@/components/assistant-panel-header";
import { ChapterEditor } from "@/components/chapter-editor";
import { CharacterChatWorkspace } from "@/components/character-chat";
import { CreativeAssistant } from "@/components/creative-assistant";
import { EntityWorkspace } from "@/components/entity-workspace";
import { ProjectPreviewWorkspace } from "@/components/project-preview";
import { ProjectReviewWorkspace } from "@/components/project-review";
import { ProjectRevisionWorkspace } from "@/components/project-revision";
import { ResizablePanel } from "@/components/resizable-panel";
import { useSettingsDialog } from "@/components/settings-dialog-provider";
import {
  Button,
  ConfirmDialog,
  Input,
  Label,
  Modal,
  Select,
  Textarea,
  Tooltip,
} from "@/components/ui";
import { api } from "@/lib/client";
import type {
  AppSettings,
  AssistantProposalItem,
  Chapter,
  Entity,
  EntityRelation,
  EntityType,
  LlmService,
  Project,
  StyleFingerprint,
  TaskType,
  UsageReport,
} from "@/lib/types";
import { cn, formatCompactNumber, formatDollarAmount } from "@/lib/utils";

interface ProjectStats {
  chapterCount: number;
  entityCount: number;
  textBlockCount: number;
  checkpointCount: number;
  staleCheckpointCount: number;
  chaptersWithContent: number;
  proseCharacters: number;
  chatCount: number;
  chatSessionCount: number;
  chatMessageCount: number;
  reviewCount: number;
  completedReviewCount: number;
  failedReviewCount: number;
  revisionCount: number;
  completedRevisionCount: number;
  unfinishedRevisionCount: number;
}
interface ProjectDetail {
  project: Project;
  entities: Entity[];
  entityTypes: EntityType[];
  relations: EntityRelation[];
  chapters: Chapter[];
  stats: ProjectStats;
}
interface SettingsPayload {
  settings: AppSettings;
  services: LlmService[];
  styleFingerprints: StyleFingerprint[];
}
type DeleteTarget = { kind: "chapter"; id: string; name: string };
type ProjectDraft = Pick<
  Project,
  "name" | "synopsis" | "proseStyle" | "styleFingerprintId" | "language" | "modelOverrides"
>;
type ProjectView =
  | "overview"
  | "setup"
  | "entities"
  | "preview"
  | "chats"
  | "reviews"
  | "revisions";
type SetupSection = "basics" | "outline" | "models";

const emptyDraft: ProjectDraft = {
  name: "",
  synopsis: "",
  proseStyle: "",
  styleFingerprintId: null,
  language: "",
  modelOverrides: {},
};

export function ProjectClient({
  projectId,
  initialChapterId,
  initialChatId = null,
  initialReviewId = null,
  initialRevisionId = null,
  initialSetupSection = "basics",
  initialView = "overview",
}: {
  projectId: string;
  initialChapterId: string | null;
  initialChatId?: string | null;
  initialReviewId?: string | null;
  initialRevisionId?: string | null;
  initialSetupSection?: SetupSection;
  initialView?: ProjectView;
}) {
  const t = useTranslations("Project");
  const common = useTranslations("Common");
  const client = useQueryClient();
  const router = useRouter();
  const detail = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api<ProjectDetail>(`/api/projects/${projectId}`),
  });
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<SettingsPayload>("/api/settings"),
  });
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(initialChapterId);
  const [projectDraft, setProjectDraft] = useState<ProjectDraft>(emptyDraft);
  const [chapterOpen, setChapterOpen] = useState(false);
  const [chapterForm, setChapterForm] = useState({ title: "", synopsis: "" });
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [renamingChapterId, setRenamingChapterId] = useState<string | null>(null);
  const [chapterTitleDraft, setChapterTitleDraft] = useState("");
  const projectHydrated = useRef(false);
  const projectDirty = useRef(false);
  const projectVersion = useRef(0);

  const { mutate: persistProject } = useMutation({
    mutationFn: ({ value }: { value: ProjectDraft; version: number }) =>
      api<Project>(`/api/projects/${projectId}`, { method: "PATCH", body: JSON.stringify(value) }),
    onSuccess: (project, { version }) => {
      if (version !== projectVersion.current) return;
      client.setQueryData<ProjectDetail>(["project", projectId], (current) =>
        current ? { ...current, project } : current,
      );
    },
    onError: (error) => toast.error(t("autoSaveFailed", { message: error.message })),
  });

  const updateProjectDraft = (updater: (current: ProjectDraft) => ProjectDraft) => {
    projectDirty.current = true;
    projectVersion.current += 1;
    setProjectDraft(updater);
  };

  // The server snapshot seeds the autosaved form once; later list refreshes must not overwrite local edits.
  useEffect(() => {
    if (!detail.data || projectHydrated.current) return;
    projectHydrated.current = true;
    const project = detail.data.project;
    setProjectDraft({
      name: project.name,
      synopsis: project.synopsis,
      proseStyle: project.proseStyle,
      styleFingerprintId: project.styleFingerprintId,
      language: project.language,
      modelOverrides: project.modelOverrides,
    });
  }, [detail.data]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setSelectedChapterId(initialChapterId));
    return () => window.cancelAnimationFrame(frame);
  }, [initialChapterId]);

  useEffect(() => {
    if (!projectDirty.current) return;
    const version = projectVersion.current;
    const timer = window.setTimeout(() => {
      if (version !== projectVersion.current) return;
      projectDirty.current = false;
      persistProject({ value: projectDraft, version });
    }, 650);
    return () => window.clearTimeout(timer);
  }, [persistProject, projectDraft]);

  const refresh = () => client.invalidateQueries({ queryKey: ["project", projectId] });
  const modelOptions = useMemo(
    () =>
      (settings.data?.services ?? []).flatMap((service) =>
        service.models.map((model) => ({
          value: model.id,
          label: model.displayName,
          description: service.name,
        })),
      ),
    [settings.data],
  );

  const selectChapter = (chapterId: string) => {
    setSelectedChapterId(chapterId);
    router.push(`/projects/${projectId}?chapter=${encodeURIComponent(chapterId)}`, {
      scroll: false,
    });
  };

  const showInfo = () => {
    setSelectedChapterId(null);
    refresh();
    router.push(`/projects/${projectId}`, { scroll: false });
  };

  const showSetup = () => router.push(`/projects/${projectId}/setup`, { scroll: false });
  const showEntities = () => router.push(`/projects/${projectId}/entities`, { scroll: false });
  const showPreview = () => router.push(`/projects/${projectId}/preview`, { scroll: false });
  const showChats = () => router.push(`/projects/${projectId}/chats`, { scroll: false });
  const showReviews = () => router.push(`/projects/${projectId}/reviews`, { scroll: false });
  const showRevisions = () => router.push(`/projects/${projectId}/revisions`, { scroll: false });

  const createChapter = useMutation({
    mutationFn: () =>
      api<Chapter>(`/api/projects/${projectId}/chapters`, {
        method: "POST",
        body: JSON.stringify(chapterForm),
      }),
    onSuccess: (chapter) => {
      client.setQueryData<ProjectDetail>(["project", projectId], (current) =>
        current
          ? {
              ...current,
              chapters: [...current.chapters, chapter],
              stats: { ...current.stats, chapterCount: current.stats.chapterCount + 1 },
            }
          : current,
      );
      refresh();
      setChapterOpen(false);
      setChapterForm({ title: "", synopsis: "" });
      selectChapter(chapter.id);
    },
    onError: (error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: (target: DeleteTarget) =>
      api(`/api/chapters/${target.id}`, {
        method: "DELETE",
      }),
    onSuccess: (_result, target) => {
      refresh();
      client.removeQueries({ queryKey: ["chapter", target.id] });
      if (selectedChapterId === target.id) showInfo();
      setDeleteTarget(null);
    },
    onError: (error) => toast.error(error.message),
  });

  const renameChapter = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      api<Chapter>(`/api/chapters/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }),
    onSuccess: (chapter) => {
      refresh();
      client.invalidateQueries({ queryKey: ["chapter", chapter.id] });
      setRenamingChapterId(null);
    },
    onError: (error) => toast.error(error.message),
  });

  const moveChapter = useMutation({
    mutationFn: ({ id, move }: { id: string; move: "up" | "down" }) =>
      api<Chapter>(`/api/chapters/${id}`, { method: "PATCH", body: JSON.stringify({ move }) }),
    onSuccess: () => {
      refresh();
      client.invalidateQueries({ queryKey: ["chapter"] });
    },
    onError: (error) => toast.error(error.message),
  });

  const handleAssistantApplied = (item: AssistantProposalItem) => {
    if (item.action === "update_project_field") {
      const field = String(item.payload.field ?? "");
      const value = String(item.payload.value ?? "");
      if (
        field === "name" ||
        field === "synopsis" ||
        field === "proseStyle" ||
        field === "language"
      ) {
        projectDirty.current = false;
        projectVersion.current += 1;
        setProjectDraft((current) => ({ ...current, [field]: value }));
      }
    }
    refresh();
  };

  if (detail.isLoading)
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-50 text-sm text-zinc-500">
        {t("loading")}
      </div>
    );
  if (!detail.data)
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-50 text-sm text-zinc-500">
        {t("loadFailed")}
      </div>
    );

  const { project, chapters, entities, entityTypes, relations, stats } = detail.data;
  const characters = entities.filter((entity) => entity.type.systemKey === "character");
  const activeChapterId =
    initialView === "overview" && chapters.some((chapter) => chapter.id === selectedChapterId)
      ? selectedChapterId
      : null;

  return (
    <div className="flex h-screen overflow-hidden bg-zinc-50">
      <ProjectSidebar
        project={project}
        chapters={chapters}
        view={initialView}
        selectedChapterId={activeChapterId}
        renamingChapterId={renamingChapterId}
        chapterTitleDraft={chapterTitleDraft}
        onInfo={showInfo}
        onSetup={showSetup}
        onEntities={showEntities}
        onPreview={showPreview}
        onChats={showChats}
        onReviews={showReviews}
        onRevisions={showRevisions}
        onChapter={selectChapter}
        onCreateChapter={() => setChapterOpen(true)}
        onStartRename={(chapter) => {
          setRenamingChapterId(chapter.id);
          setChapterTitleDraft(chapter.title);
        }}
        onRenameDraft={setChapterTitleDraft}
        onFinishRename={(chapter) => {
          if (chapterTitleDraft.trim() && chapterTitleDraft.trim() !== chapter.title)
            renameChapter.mutate({ id: chapter.id, title: chapterTitleDraft });
          else setRenamingChapterId(null);
        }}
        onCancelRename={() => setRenamingChapterId(null)}
        onMove={(id, move) => moveChapter.mutate({ id, move })}
        onDelete={(chapter) =>
          setDeleteTarget({ kind: "chapter", id: chapter.id, name: chapter.title })
        }
      />
      <main className="min-w-0 flex-1 overflow-hidden">
        {initialView === "chats" ? (
          <CharacterChatWorkspace
            projectId={projectId}
            initialChatId={initialChatId}
            characters={characters}
            entities={entities}
            chapters={chapters}
          />
        ) : initialView === "reviews" ? (
          <ProjectReviewWorkspace
            projectId={projectId}
            initialReviewId={initialReviewId}
            project={project}
            chapters={chapters}
          />
        ) : initialView === "revisions" ? (
          <ProjectRevisionWorkspace
            projectId={projectId}
            initialRevisionId={initialRevisionId}
            project={project}
          />
        ) : initialView === "entities" ? (
          <EntityWorkspace
            projectId={projectId}
            entities={entities}
            entityTypes={entityTypes}
            relations={relations}
            onAssistantApplied={handleAssistantApplied}
          />
        ) : initialView === "preview" ? (
          <ProjectPreviewWorkspace projectId={projectId} project={project} />
        ) : initialView === "setup" ? (
          <SetupWorkspace
            projectId={projectId}
            initialSection={initialSetupSection}
            draft={projectDraft}
            settings={settings.data?.settings}
            styleFingerprints={settings.data?.styleFingerprints ?? []}
            modelOptions={modelOptions}
            chapters={chapters}
            onChange={updateProjectDraft}
            onAddChapter={() => setChapterOpen(true)}
            onOpenChapter={selectChapter}
            onAssistantApplied={handleAssistantApplied}
          />
        ) : activeChapterId ? (
          <ChapterEditor key={activeChapterId} chapterId={activeChapterId} />
        ) : (
          <ProjectOverview
            project={project}
            chapters={chapters}
            stats={stats}
            onOpenChapter={selectChapter}
          />
        )}
      </main>
      <Modal open={chapterOpen} onOpenChange={setChapterOpen} title={t("newChapter")}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            createChapter.mutate();
          }}
        >
          <div className="space-y-4 p-5">
            <div>
              <Label>{t("chapterTitle")}</Label>
              <Input
                autoFocus
                required
                value={chapterForm.title}
                onChange={(event) => setChapterForm({ ...chapterForm, title: event.target.value })}
                placeholder={t("chapterTitlePlaceholder")}
              />
            </div>
            <div>
              <Label>{t("chapterSynopsis")}</Label>
              <Textarea
                value={chapterForm.synopsis}
                onChange={(event) =>
                  setChapterForm({ ...chapterForm, synopsis: event.target.value })
                }
                placeholder={t("chapterSynopsisPlaceholder")}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 border-zinc-100 border-t p-3">
            <Button type="button" variant="secondary" onClick={() => setChapterOpen(false)}>
              {common("cancel")}
            </Button>
            <Button type="submit" loading={createChapter.isPending}>
              {t("createAndOpen")}
            </Button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t("deleteEntityTitle", { entity: t("chapter") })}
        description={t("deleteEntityDescription", { name: deleteTarget?.name ?? "" })}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget)}
        loading={remove.isPending}
      />
    </div>
  );
}

function ProjectSidebar({
  project,
  chapters,
  view,
  selectedChapterId,
  renamingChapterId,
  chapterTitleDraft,
  onInfo,
  onSetup,
  onEntities,
  onPreview,
  onChats,
  onReviews,
  onRevisions,
  onChapter,
  onCreateChapter,
  onStartRename,
  onRenameDraft,
  onFinishRename,
  onCancelRename,
  onMove,
  onDelete,
}: {
  project: Project;
  chapters: Chapter[];
  view: ProjectView;
  selectedChapterId: string | null;
  renamingChapterId: string | null;
  chapterTitleDraft: string;
  onInfo: () => void;
  onSetup: () => void;
  onEntities: () => void;
  onPreview: () => void;
  onChats: () => void;
  onReviews: () => void;
  onRevisions: () => void;
  onChapter: (id: string) => void;
  onCreateChapter: () => void;
  onStartRename: (chapter: Chapter) => void;
  onRenameDraft: (value: string) => void;
  onFinishRename: (chapter: Chapter) => void;
  onCancelRename: () => void;
  onMove: (id: string, move: "up" | "down") => void;
  onDelete: (chapter: Chapter) => void;
}) {
  const t = useTranslations("Project");
  const common = useTranslations("Common");
  const [collapsed, setCollapsed] = useState(false);
  const { openSettings } = useSettingsDialog();
  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 64 : 272 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="z-30 flex h-screen shrink-0 flex-col overflow-hidden border-zinc-200 border-r bg-white"
    >
      <div
        className={cn(
          "flex h-14 shrink-0 items-center border-zinc-100 border-b",
          collapsed ? "justify-center px-2" : "justify-between px-3",
        )}
      >
        {collapsed ? (
          <button
            type="button"
            aria-label={t("expandSidebar")}
            onClick={() => setCollapsed(false)}
            className="focus-ring group relative flex size-10 items-center justify-center rounded-lg border border-transparent hover:bg-zinc-100"
          >
            <span className="flex size-8 items-center justify-center rounded-lg bg-zinc-950 text-white transition-opacity group-hover:opacity-0">
              <Feather className="size-4" />
            </span>
            <PanelLeft className="absolute size-4 text-zinc-700 opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        ) : (
          <>
            <Link
              href="/"
              aria-label={t("backToProjects")}
              className="flex min-w-0 items-center gap-2.5"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-zinc-950 text-white">
                <Feather className="size-4" />
              </span>
              <span className="max-w-40 truncate font-semibold text-sm tracking-tight">
                {project.name}
              </span>
            </Link>
            <button
              type="button"
              aria-label={t("collapseSidebar")}
              onClick={() => setCollapsed(true)}
              className="focus-ring flex size-8 items-center justify-center rounded-lg border border-transparent text-zinc-500 hover:bg-zinc-100 hover:text-zinc-950"
            >
              <PanelLeft className="size-4" />
            </button>
          </>
        )}
      </div>
      <nav className="space-y-1 p-2.5">
        <SidebarButton
          collapsed={collapsed}
          active={view === "overview" && !selectedChapterId}
          label={t("info")}
          onClick={onInfo}
        >
          <ChartNoAxesColumnIncreasing className="size-4" />
        </SidebarButton>
        <SidebarButton
          collapsed={collapsed}
          active={view === "setup"}
          label={t("setup")}
          onClick={onSetup}
        >
          <NotebookTabs className="size-4" />
        </SidebarButton>
        <SidebarButton
          collapsed={collapsed}
          active={view === "entities"}
          label={t("entities")}
          onClick={onEntities}
        >
          <Boxes className="size-4" />
        </SidebarButton>
        <SidebarButton
          collapsed={collapsed}
          active={view === "preview"}
          label={t("preview")}
          onClick={onPreview}
        >
          <Eye className="size-4" />
        </SidebarButton>
        <SidebarButton
          collapsed={collapsed}
          active={view === "chats"}
          label={t("chats")}
          onClick={onChats}
        >
          <MessageCircle className="size-4" />
        </SidebarButton>
        <SidebarButton
          collapsed={collapsed}
          active={view === "reviews"}
          label={t("reviews")}
          onClick={onReviews}
        >
          <ClipboardPenLine className="size-4" />
        </SidebarButton>
        <SidebarButton
          collapsed={collapsed}
          active={view === "revisions"}
          label={t("revisions")}
          onClick={onRevisions}
        >
          <FilePenLine className="size-4" />
        </SidebarButton>
      </nav>
      {!collapsed ? (
        <div className="min-h-0 flex-1 border-zinc-100 border-t px-2.5 py-3">
          <div className="mb-2 flex items-center justify-between px-2">
            <span className="font-semibold text-[11px] text-zinc-400 uppercase tracking-[.14em]">
              {t("chapters")}
            </span>
            <button
              type="button"
              onClick={onCreateChapter}
              aria-label={t("addChapter")}
              className="focus-ring flex size-7 items-center justify-center rounded-md border border-transparent text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900"
            >
              <Plus className="size-3.5" />
            </button>
          </div>
          <div className="scrollbar-thin h-[calc(100%-32px)] overflow-y-auto">
            {chapters.map((chapter, index) => (
              <div
                key={chapter.id}
                className={cn(
                  "group relative mb-0.5 rounded-lg",
                  selectedChapterId === chapter.id ? "bg-zinc-100" : "hover:bg-zinc-50",
                )}
              >
                {renamingChapterId === chapter.id ? (
                  <input
                    autoFocus
                    value={chapterTitleDraft}
                    onChange={(event) => onRenameDraft(event.target.value)}
                    onBlur={() => onFinishRename(chapter)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                      if (event.key === "Escape") onCancelRename();
                    }}
                    className="focus-ring h-9 w-full rounded-lg border border-zinc-300 bg-white px-2.5 text-xs"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => onChapter(chapter.id)}
                    className="flex h-9 w-full items-center gap-2 overflow-hidden rounded-lg px-2.5 pr-24 text-left text-xs"
                  >
                    <FileText className="size-3.5 shrink-0 text-zinc-400" />
                    <span className="truncate">{chapter.title}</span>
                  </button>
                )}
                {renamingChapterId !== chapter.id ? (
                  <div className="absolute top-1 right-1 flex opacity-0 transition group-hover:opacity-100">
                    <ChapterAction label={t("rename")} onClick={() => onStartRename(chapter)}>
                      <Pencil className="size-3" />
                    </ChapterAction>
                    <ChapterAction
                      label={common("moveUp")}
                      disabled={index === 0}
                      onClick={() => onMove(chapter.id, "up")}
                    >
                      <ArrowUp className="size-3" />
                    </ChapterAction>
                    <ChapterAction
                      label={common("moveDown")}
                      disabled={index === chapters.length - 1}
                      onClick={() => onMove(chapter.id, "down")}
                    >
                      <ArrowDown className="size-3" />
                    </ChapterAction>
                    <ChapterAction
                      label={common("delete")}
                      danger
                      onClick={() => onDelete(chapter)}
                    >
                      <Trash2 className="size-3" />
                    </ChapterAction>
                  </div>
                ) : null}
              </div>
            ))}
            {!chapters.length ? (
              <button
                type="button"
                onClick={onCreateChapter}
                className="w-full rounded-lg border border-zinc-200 border-dashed px-3 py-8 text-center text-xs text-zinc-400 hover:bg-zinc-50"
              >
                {t("addFirstChapter")}
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex-1" />
      )}
      <div className="border-zinc-100 border-t p-2.5">
        <SidebarButton collapsed={collapsed} label={t("systemSettings")} onClick={openSettings}>
          <Settings2 className="size-4" />
        </SidebarButton>
      </div>
    </motion.aside>
  );
}

function SidebarButton({
  collapsed,
  active,
  label,
  onClick,
  children,
}: {
  collapsed: boolean;
  active?: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  const button = (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "focus-ring flex h-10 items-center rounded-lg border border-transparent font-medium text-sm transition-colors",
        collapsed ? "w-10 justify-center" : "w-full gap-3 px-3",
        active
          ? "bg-zinc-100 text-zinc-950"
          : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950",
      )}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">{children}</span>
      <AnimatePresence initial={false}>
        {!collapsed ? (
          <motion.span
            initial={{ opacity: 0, x: -5 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -5 }}
            transition={{ duration: 0.12 }}
            className="whitespace-nowrap"
          >
            {label}
          </motion.span>
        ) : null}
      </AnimatePresence>
    </button>
  );
  return collapsed ? (
    <div className="flex justify-center">
      <Tooltip label={label}>{button}</Tooltip>
    </div>
  ) : (
    button
  );
}

function ChapterAction({
  label,
  onClick,
  children,
  disabled,
  danger,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          onClick();
        }}
        className={cn(
          "flex size-7 items-center justify-center rounded-md bg-zinc-100 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-950 disabled:pointer-events-none disabled:opacity-30",
          danger && "hover:bg-red-50 hover:text-red-600",
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

function ProjectOverview({
  project,
  chapters,
  stats,
  onOpenChapter,
}: {
  project: Project;
  chapters: Chapter[];
  stats: ProjectStats;
  onOpenChapter: (id: string) => void;
}) {
  const t = useTranslations("Project");
  const locale = useLocale();
  const usage = useQuery({
    queryKey: ["usage", "creative", project.id, "all"],
    queryFn: () =>
      api<UsageReport>(
        `/api/usage?days=all&projectKind=creative&projectId=${encodeURIComponent(project.id)}`,
      ),
  });
  const exact = new Intl.NumberFormat(locale);
  const formatCost = (value: number | null) =>
    value == null
      ? t("usageUnpriced")
      : value > 0 && value < 0.0001
        ? "< $0.0001"
        : formatDollarAmount(value, locale);
  const featureLabels: Partial<Record<TaskType, string>> = {
    writing: t("writing"),
    summary: t("summary"),
    assistant: t("assistant"),
    chat: t("chats"),
    review: t("reviews"),
    revisionPlan: t("revisionPlan"),
    revisionExecution: t("revisionExecution"),
  };
  const coverage = stats.chapterCount
    ? Math.round((stats.chaptersWithContent / stats.chapterCount) * 100)
    : 0;
  return (
    <div className="flex h-full min-h-0 bg-zinc-50">
      <section className="scrollbar-thin min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl space-y-7 px-7 pt-7 pb-8">
          <div>
            <p className="font-medium text-xs text-zinc-400 uppercase tracking-[.14em]">
              {t("overview")}
            </p>
            <h1 className="mt-1 font-semibold text-2xl tracking-tight">{project.name}</h1>
            <p className="mt-2 text-sm text-zinc-500 leading-6">
              {project.synopsis || t("noProjectSynopsis")}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard
              icon={<BookOpen className="size-4" />}
              label={t("chapters")}
              value={stats.chapterCount.toLocaleString()}
            />
            <StatCard
              icon={<Users className="size-4" />}
              label={t("entities")}
              value={stats.entityCount.toLocaleString()}
            />
            <StatCard
              icon={<FileText className="size-4" />}
              label={t("textBlocks")}
              value={stats.textBlockCount.toLocaleString()}
            />
            <StatCard
              icon={<ListChecks className="size-4" />}
              label={t("checkpoint")}
              value={stats.checkpointCount.toLocaleString()}
              detail={
                <span
                  className={cn(
                    "text-xs",
                    stats.staleCheckpointCount ? "text-amber-600" : "text-zinc-400",
                  )}
                >
                  {stats.staleCheckpointCount
                    ? t("checkpointsStale", { count: stats.staleCheckpointCount })
                    : t("allCurrent")}
                </span>
              }
            />
            <StatCard
              icon={<AlignLeft className="size-4" />}
              label={t("proseCharacters")}
              value={stats.proseCharacters.toLocaleString()}
            />
          </div>
          <section className="space-y-3">
            <div>
              <h2 className="font-semibold text-sm">{t("projectUsage")}</h2>
              <p className="mt-1 text-xs text-zinc-500">{t("projectUsageDescription")}</p>
            </div>
            {usage.isLoading ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {[1, 2, 3, 4].map((item) => (
                  <div
                    key={item}
                    className="h-24 animate-pulse rounded-xl border border-zinc-200 bg-white"
                  />
                ))}
              </div>
            ) : null}
            {usage.data?.totals.calls ? (
              <>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <StatCard
                    icon={<Database className="size-4" />}
                    label={t("usageInputTokens")}
                    value={formatCompactNumber(usage.data.totals.input + usage.data.totals.cached)}
                  />
                  <StatCard
                    icon={<Sparkles className="size-4" />}
                    label={t("usageOutputTokens")}
                    value={formatCompactNumber(usage.data.totals.output)}
                  />
                  <StatCard
                    icon={<Hash className="size-4" />}
                    label={t("usageCalls")}
                    value={exact.format(usage.data.totals.calls)}
                  />
                  <StatCard
                    icon={<Coins className="size-4" />}
                    label={t("usageEstimatedCost")}
                    value={formatCost(usage.data.totals.cost)}
                    detail={
                      usage.data.totals.unpriced
                        ? t("usageUnpricedTokens", {
                            count: formatCompactNumber(usage.data.totals.unpriced),
                          })
                        : undefined
                    }
                  />
                </div>
                <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
                  <div className="border-zinc-100 border-b px-5 py-3.5 font-semibold text-xs text-zinc-600">
                    {t("usageByTask")}
                  </div>
                  <div className="divide-y divide-zinc-100">
                    {usage.data.byFeature.map((item) => (
                      <div
                        key={item.feature}
                        className="flex items-center justify-between gap-4 px-5 py-3"
                      >
                        <div>
                          <p className="font-medium text-sm">
                            {featureLabels[item.feature] ?? item.feature}
                          </p>
                          <p className="mt-0.5 text-[11px] text-zinc-400">
                            {t("usageTaskDetail", {
                              tokens: formatCompactNumber(item.input + item.cached + item.output),
                              calls: exact.format(item.calls),
                            })}
                          </p>
                        </div>
                        <span className="shrink-0 font-medium text-sm text-zinc-700">
                          {formatCost(item.cost)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : !usage.isLoading ? (
              <div className="rounded-xl border border-zinc-300 border-dashed bg-white px-5 py-10 text-center text-sm text-zinc-400">
                {t("usageEmpty")}
              </div>
            ) : null}
          </section>
          <section className="space-y-3">
            <div>
              <h2 className="font-semibold text-sm">{t("projectActivity")}</h2>
              <p className="mt-1 text-xs text-zinc-500">{t("projectActivityDescription")}</p>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <ActivityCard
                href={`/projects/${project.id}/chats`}
                icon={<MessageCircle className="size-4" />}
                label={t("chats")}
                value={stats.chatCount}
                metrics={[
                  t("chatSessionsCount", { count: stats.chatSessionCount }),
                  t("chatMessagesCount", { count: stats.chatMessageCount }),
                ]}
              />
              <ActivityCard
                href={`/projects/${project.id}/reviews`}
                icon={<ClipboardPenLine className="size-4" />}
                label={t("reviews")}
                value={stats.reviewCount}
                metrics={[
                  t("completedCount", { count: stats.completedReviewCount }),
                  t("failedCount", { count: stats.failedReviewCount }),
                ]}
              />
              <ActivityCard
                href={`/projects/${project.id}/revisions`}
                icon={<FilePenLine className="size-4" />}
                label={t("revisions")}
                value={stats.revisionCount}
                metrics={[
                  t("completedCount", { count: stats.completedRevisionCount }),
                  t("unfinishedCount", { count: stats.unfinishedRevisionCount }),
                ]}
              />
            </div>
          </section>
          <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-zinc-100 border-b px-5 py-4">
              <div>
                <h2 className="font-semibold text-sm">{t("chapterProgress")}</h2>
                <p className="mt-1 text-xs text-zinc-500">
                  {t("chaptersWithContent", {
                    completed: stats.chaptersWithContent,
                    total: stats.chapterCount,
                  })}
                </p>
              </div>
              <span className="font-semibold text-sm">{coverage}%</span>
            </div>
            <div className="mx-5 mt-4 h-1.5 overflow-hidden rounded-full bg-zinc-200">
              <div
                className="h-full rounded-full bg-zinc-950 transition-[width]"
                style={{ width: `${coverage}%` }}
              />
            </div>
            <div className="divide-y divide-zinc-100 px-5">
              {chapters.map((chapter, index) => (
                <button
                  key={chapter.id}
                  type="button"
                  onClick={() => onOpenChapter(chapter.id)}
                  className="flex w-full items-center gap-3 py-3 text-left hover:text-zinc-600"
                >
                  <span className="w-7 font-mono text-[10px] text-zinc-400">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium text-sm">
                    {chapter.title}
                  </span>
                  <span className="max-w-64 truncate text-xs text-zinc-400">
                    {chapter.synopsis || t("noSynopsis")}
                  </span>
                </button>
              ))}
              {!chapters.length ? (
                <p className="py-12 text-center text-sm text-zinc-400">{t("noChapters")}</p>
              ) : null}
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-5 py-4 shadow-sm">
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        {icon}
        {label}
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <p className="font-semibold text-2xl tracking-tight">{value}</p>
        {detail}
      </div>
    </div>
  );
}

function ActivityCard({
  href,
  icon,
  label,
  value,
  metrics,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  value: number;
  metrics: string[];
}) {
  return (
    <Link
      href={href}
      className="focus-ring group rounded-xl border border-zinc-200 bg-white px-5 py-4 shadow-sm transition hover:border-zinc-300 hover:shadow-md"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          {icon}
          {label}
        </div>
        <ArrowUpRight className="size-4 text-zinc-300 transition group-hover:text-zinc-600" />
      </div>
      <p className="mt-3 font-semibold text-2xl tracking-tight">{value.toLocaleString()}</p>
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500">
        {metrics.map((metric) => (
          <span key={metric}>{metric}</span>
        ))}
      </div>
    </Link>
  );
}

function SetupWorkspace({
  projectId,
  initialSection,
  draft,
  settings,
  styleFingerprints,
  modelOptions,
  chapters,
  onChange,
  onAddChapter,
  onOpenChapter,
  onAssistantApplied,
}: {
  projectId: string;
  initialSection: SetupSection;
  draft: ProjectDraft;
  settings?: AppSettings;
  styleFingerprints: StyleFingerprint[];
  modelOptions: { value: string; label: string; description?: string }[];
  chapters: Chapter[];
  onChange: (updater: (current: ProjectDraft) => ProjectDraft) => void;
  onAddChapter: () => void;
  onOpenChapter: (id: string) => void;
  onAssistantApplied: (item: AssistantProposalItem) => void;
}) {
  const t = useTranslations("Project");
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedSection = searchParams.get("section");
  const section: SetupSection =
    requestedSection === "outline" || requestedSection === "models" || requestedSection === "basics"
      ? requestedSection
      : initialSection;
  const selectSection = (next: SetupSection) => {
    router.push(`/projects/${projectId}/setup?section=${next}`, { scroll: false });
  };
  return (
    <div className="flex h-full min-h-0 bg-zinc-50">
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex h-14 shrink-0 items-center border-zinc-200 border-b bg-white px-5">
          <div className="flex rounded-lg bg-zinc-100 p-1">
            {(["basics", "outline", "models"] as SetupSection[]).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => selectSection(item)}
                className={cn(
                  "focus-ring rounded-md px-3 py-1.5 font-medium text-xs transition",
                  section === item
                    ? "bg-white text-zinc-950 shadow-sm"
                    : "text-zinc-500 hover:text-zinc-900",
                )}
              >
                {t(`setupSection.${item}`)}
              </button>
            ))}
          </div>
        </div>
        {section === "basics" ? (
          <ProjectSettingsForm
            draft={draft}
            settings={settings}
            styleFingerprints={styleFingerprints}
            onChange={onChange}
            title={t("setupBasicsTitle")}
            description={t("settingsDescription")}
          />
        ) : section === "outline" ? (
          <OutlineSetupSection chapters={chapters} onAdd={onAddChapter} onOpen={onOpenChapter} />
        ) : (
          <ModelOverridesSetupSection
            draft={draft}
            modelOptions={modelOptions}
            onChange={onChange}
          />
        )}
      </section>
      <ResizablePanel storageKey="project-assistant" className="flex flex-col">
        <AssistantPanelHeader title={t("assistant")} />
        <CreativeAssistant
          projectId={projectId}
          scope="project"
          embedded
          onApplied={onAssistantApplied}
        />
      </ResizablePanel>
    </div>
  );
}

function ProjectSettingsForm({
  draft,
  settings,
  styleFingerprints,
  onChange,
  title,
  description,
}: {
  draft: ProjectDraft;
  settings?: AppSettings;
  styleFingerprints: StyleFingerprint[];
  onChange: (updater: (current: ProjectDraft) => ProjectDraft) => void;
  title: string;
  description: string;
}) {
  const t = useTranslations("Project");
  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
      <div className="space-y-6 px-6 pt-7 pb-10">
        <div>
          <h1 className="font-semibold text-2xl tracking-tight">{title}</h1>
          <p className="mt-1.5 text-sm text-zinc-500">{description}</p>
        </div>
        <div className="space-y-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div>
            <Label>{t("projectName")}</Label>
            <Input
              className="font-semibold text-base"
              value={draft.name}
              onChange={(event) =>
                onChange((current) => ({ ...current, name: event.target.value }))
              }
            />
          </div>
          <div>
            <Label>{t("storySynopsis")}</Label>
            <Textarea
              className="min-h-40"
              value={draft.synopsis}
              onChange={(event) =>
                onChange((current) => ({ ...current, synopsis: event.target.value }))
              }
              placeholder={t("storySynopsisPlaceholder")}
            />
          </div>
          <div>
            <Label>{t("proseStyle")}</Label>
            <Select
              value={draft.styleFingerprintId ?? "none"}
              onChange={(value) =>
                onChange((current) => ({
                  ...current,
                  styleFingerprintId: value === "none" ? null : value,
                }))
              }
              options={[
                { value: "none", label: t("noStyleFingerprint") },
                ...styleFingerprints.map((fingerprint) => ({
                  value: fingerprint.id,
                  label: fingerprint.name,
                })),
              ]}
            />
            <Textarea
              className="mt-3 min-h-28"
              value={draft.proseStyle}
              onChange={(event) =>
                onChange((current) => ({ ...current, proseStyle: event.target.value }))
              }
              placeholder={t("proseStylePlaceholder")}
            />
          </div>
          <div>
            <Label>{t("outputLanguageOverride")}</Label>
            <Input
              value={draft.language}
              onChange={(event) =>
                onChange((current) => ({ ...current, language: event.target.value }))
              }
              placeholder={
                settings?.language
                  ? t("inheritLanguage", { language: settings.language })
                  : t("noOutputLanguage")
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function ModelOverridesSetupSection({
  draft,
  modelOptions,
  onChange,
}: {
  draft: ProjectDraft;
  modelOptions: { value: string; label: string; description?: string }[];
  onChange: (updater: (current: ProjectDraft) => ProjectDraft) => void;
}) {
  const t = useTranslations("Project");
  const common = useTranslations("Common");
  const taskLabels: Partial<Record<TaskType, string>> = {
    writing: t("writing"),
    summary: t("summary"),
    assistant: t("assistant"),
    chat: t("chats"),
    review: t("reviews"),
    revisionPlan: t("revisionPlan"),
    revisionExecution: t("revisionExecution"),
  };
  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-6 pt-7 pb-10">
      <div className="mb-6">
        <h1 className="font-semibold text-2xl tracking-tight">{t("modelOverrides")}</h1>
        <p className="mt-1.5 text-sm text-zinc-500">{t("modelOverridesDescription")}</p>
      </div>
      <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="space-y-3">
          {(
            [
              "writing",
              "summary",
              "assistant",
              "chat",
              "review",
              "revisionPlan",
              "revisionExecution",
            ] as TaskType[]
          ).map((task) => (
            <div key={task} className="flex items-center justify-between gap-6">
              <span className="font-medium text-xs text-zinc-700">{taskLabels[task]}</span>
              <div className="w-full max-w-sm">
                <Select
                  value={draft.modelOverrides[task] ?? "inherit"}
                  onChange={(value) =>
                    onChange((current) => ({
                      ...current,
                      modelOverrides: {
                        ...current.modelOverrides,
                        [task]: value === "inherit" ? null : value,
                      },
                    }))
                  }
                  options={[{ value: "inherit", label: common("inheritGlobal") }, ...modelOptions]}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function OutlineSetupSection({
  chapters,
  onAdd,
  onOpen,
}: {
  chapters: Chapter[];
  onAdd: () => void;
  onOpen: (id: string) => void;
}) {
  const t = useTranslations("Project");
  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-6 pt-7 pb-8">
      <div className="mb-6 flex items-start justify-between gap-5">
        <div>
          <h1 className="font-semibold text-2xl tracking-tight">{t("setupOutlineTitle")}</h1>
          <p className="mt-1.5 text-sm text-zinc-500">{t("setupOutlineDescription")}</p>
        </div>
        <Button size="sm" onClick={onAdd}>
          <Plus className="size-3.5" />
          {t("newChapter")}
        </Button>
      </div>
      {chapters.length ? (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
          <div className="divide-y divide-zinc-100">
            {chapters.map((chapter, index) => (
              <button
                key={chapter.id}
                type="button"
                onClick={() => onOpen(chapter.id)}
                className="focus-ring flex w-full items-start gap-4 px-5 py-4 text-left hover:bg-zinc-50"
              >
                <span className="mt-0.5 w-8 shrink-0 font-mono text-xs text-zinc-400">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-sm text-zinc-800">
                    {chapter.title}
                  </span>
                  <span className="mt-1 line-clamp-2 block text-xs text-zinc-500 leading-5">
                    {chapter.synopsis || t("noSynopsis")}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={onAdd}
          className="flex min-h-80 w-full flex-col items-center justify-center rounded-xl border border-zinc-200 border-dashed text-center hover:bg-zinc-50"
        >
          <BookOpen className="size-6 text-zinc-300" />
          <span className="mt-3 font-medium text-sm">{t("addFirstChapter")}</span>
          <span className="mt-1 text-xs text-zinc-400">{t("setupOutlineEmptyDescription")}</span>
        </button>
      )}
    </div>
  );
}
