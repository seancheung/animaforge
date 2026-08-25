"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftFromLine,
  Download,
  FilePenLine,
  FileText,
  ListChecks,
  ListTree,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { MarkdownContent } from "@/components/markdown-content";
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
  Chapter,
  LlmService,
  Project,
  ProjectReview,
  ProjectRevisionDetail,
  ProjectRevisionSource,
  ProjectRevisionSummary,
  ProjectRevisionWindow,
  StyleFingerprint,
} from "@/lib/types";
import { cn } from "@/lib/utils";

interface SettingsPayload {
  settings: AppSettings;
  services: LlmService[];
  styleFingerprints: StyleFingerprint[];
}
type ExecutionEvent =
  | {
      type: "execution_ready";
      windows: ProjectRevisionWindow[];
      resultMarkdown: string;
      windowTokens: number | null;
    }
  | { type: "window_start"; windowId: string }
  | { type: "delta"; windowId: string; text: string }
  | { type: "window_complete"; windowId: string; content: string; resultMarkdown: string }
  | { type: "complete"; resultMarkdown: string }
  | { type: "error"; message: string };
type RevisionDownloadFormat = "markdown" | "txt";

export function ProjectRevisionWorkspace({
  projectId,
  initialRevisionId,
  project,
  chapters,
}: {
  projectId: string;
  initialRevisionId: string | null;
  project: Project;
  chapters: Chapter[];
}) {
  const t = useTranslations("Revision");
  const common = useTranslations("Common");
  const locale = useLocale();
  const router = useRouter();
  const client = useQueryClient();
  const planController = useRef<AbortController | null>(null);
  const planPreviewRef = useRef<HTMLDivElement | null>(null);
  const planReasoningRef = useRef<HTMLPreElement | null>(null);
  const executionController = useRef<AbortController | null>(null);
  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(initialRevisionId);
  const [revisionView, setRevisionView] = useState<"blueprint" | "result">("result");
  const [createOpen, setCreateOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [executionOpen, setExecutionOpen] = useState(false);
  const [revisionSource, setRevisionSource] = useState<ProjectRevisionSource>("review");
  const [reviewId, setReviewId] = useState("");
  const [revisionName, setRevisionName] = useState("");
  const [createRequirements, setCreateRequirements] = useState("");
  const [createStyleFingerprintId, setCreateStyleFingerprintId] = useState("");
  const [createChapterId, setCreateChapterId] = useState("");
  const [planModelId, setPlanModelId] = useState("");
  const [executionModelId, setExecutionModelId] = useState("");
  const [requirements, setRequirements] = useState("");
  const [planPreview, setPlanPreview] = useState("");
  const [planReasoning, setPlanReasoning] = useState("");
  const [planGeneratingRevisionId, setPlanGeneratingRevisionId] = useState<string | null>(null);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [downloadFormat, setDownloadFormat] = useState<RevisionDownloadFormat>("markdown");
  const [deleteTarget, setDeleteTarget] = useState<ProjectRevisionSummary | null>(null);
  const [executing, setExecuting] = useState(false);

  const revisions = useQuery({
    queryKey: ["project-revisions", projectId],
    queryFn: () => api<ProjectRevisionSummary[]>(`/api/projects/${projectId}/revisions`),
  });
  const reviews = useQuery({
    queryKey: ["project-reviews", projectId],
    queryFn: () => api<ProjectReview[]>(`/api/projects/${projectId}/reviews`),
  });
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<SettingsPayload>("/api/settings"),
  });
  const activeRevisionId =
    selectedRevisionId && revisions.data?.some((revision) => revision.id === selectedRevisionId)
      ? selectedRevisionId
      : initialRevisionId && revisions.data?.some((revision) => revision.id === initialRevisionId)
        ? initialRevisionId
        : (revisions.data?.[0]?.id ?? null);
  const planGenerating = planGeneratingRevisionId === activeRevisionId;
  const detail = useQuery({
    queryKey: ["project-revision", activeRevisionId],
    queryFn: () => api<ProjectRevisionDetail>(`/api/revisions/${activeRevisionId}`),
    enabled: Boolean(activeRevisionId),
  });
  const activeRevision = detail.data ?? null;
  const completedReviews = reviews.data?.filter((review) => review.status === "completed") ?? [];
  const selectedCreateReview = completedReviews.find((review) => review.id === reviewId) ?? null;
  const chapterOptions = [
    { value: "", label: t("allChapters") },
    ...chapters.map((chapter) => ({ value: chapter.id, label: chapter.title })),
  ];
  const models = useMemo(
    () =>
      (settings.data?.services ?? []).flatMap((service) =>
        service.models.map((model) => ({
          value: model.id,
          label: model.displayName,
          description: `${service.name} · ${model.modelId}`,
        })),
      ),
    [settings.data],
  );
  const defaultPlanModelId =
    project.modelOverrides.revisionPlan ||
    settings.data?.settings.taskModels.revisionPlan ||
    settings.data?.settings.globalDefaultModel ||
    "";
  const defaultExecutionModelId =
    project.modelOverrides.revisionExecution ||
    settings.data?.settings.taskModels.revisionExecution ||
    settings.data?.settings.globalDefaultModel ||
    "";
  const modelOptions = (defaultId: string) => {
    const model = models.find((candidate) => candidate.value === defaultId);
    return [
      {
        value: "",
        label: model ? t("defaultModelNamed", { name: model.label }) : t("defaultModel"),
      },
      ...models,
    ];
  };

  useEffect(() => {
    if (!activeRevisionId || initialRevisionId === activeRevisionId) return;
    router.replace(
      `/projects/${projectId}/revisions?revision=${encodeURIComponent(activeRevisionId)}`,
      { scroll: false },
    );
  }, [activeRevisionId, initialRevisionId, projectId, router]);

  useEffect(
    () => () => {
      planController.current?.abort();
      executionController.current?.abort();
    },
    [],
  );

  // biome-ignore lint: correctness/useExhaustiveDependencies
  useEffect(() => {
    if (planPreviewRef.current)
      planPreviewRef.current.scrollTop = planPreviewRef.current.scrollHeight;
    if (planReasoningRef.current)
      planReasoningRef.current.scrollTop = planReasoningRef.current.scrollHeight;
  }, [planPreview, planReasoning]);

  const selectRevision = (id: string) => {
    setSelectedRevisionId(id);
    setRevisionView(
      revisions.data?.find((revision) => revision.id === id)?.status === "blueprint_ready"
        ? "blueprint"
        : "result",
    );
    router.push(`/projects/${projectId}/revisions?revision=${encodeURIComponent(id)}`, {
      scroll: false,
    });
  };

  const openCreate = () => {
    const review = completedReviews[0];
    setRevisionSource(review ? "review" : "custom");
    setReviewId(review?.id ?? "");
    setRevisionName(
      review ? t("defaultName", { reviewer: review.reviewerName }) : t("customDefaultName"),
    );
    setCreateRequirements("");
    setCreateStyleFingerprintId("");
    setCreateChapterId("");
    setCreateOpen(true);
  };

  const createRevision = useMutation({
    mutationFn: () =>
      api<ProjectRevisionDetail>(`/api/projects/${projectId}/revisions`, {
        method: "POST",
        body: JSON.stringify({
          sourceType: revisionSource,
          reviewId: revisionSource === "review" ? reviewId : null,
          name: revisionName,
          requirements: revisionSource === "review" ? "" : createRequirements,
          styleFingerprintId: revisionSource === "style" ? createStyleFingerprintId || null : null,
          chapterId: revisionSource === "review" ? null : createChapterId || null,
        }),
      }),
    onSuccess: async (revision) => {
      setCreateOpen(false);
      setSelectedRevisionId(revision.id);
      setRevisionView("blueprint");
      client.setQueryData(["project-revision", revision.id], revision);
      await client.invalidateQueries({ queryKey: ["project-revisions", projectId] });
      router.push(`/projects/${projectId}/revisions?revision=${encodeURIComponent(revision.id)}`, {
        scroll: false,
      });
    },
    onError: (error) => toast.error(error.message),
  });

  const openPlanDialog = () => {
    setPlanModelId(activeRevision?.planModelId ?? "");
    setRequirements(activeRevision?.requirements ?? "");
    setPlanPreview("");
    setPlanReasoning("");
    setPlanOpen(true);
  };

  const generatePlan = async () => {
    if (!activeRevisionId || planGeneratingRevisionId) return;
    const revisionId = activeRevisionId;
    const controller = new AbortController();
    planController.current = controller;
    setPlanOpen(false);
    setPlanPreview("");
    setPlanReasoning("");
    setPlanGeneratingRevisionId(revisionId);
    client.setQueryData<ProjectRevisionDetail>(["project-revision", revisionId], (current) =>
      current ? { ...current, status: "planning" } : current,
    );
    try {
      const response = await fetch(`/api/revisions/${revisionId}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId: planModelId || null, requirements }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || t("planFailedTitle"));
      }
      if (!response.body) throw new Error(t("noModelStream"));
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as
            | { type: "delta" | "reasoning_delta"; text: string }
            | { type: "complete" }
            | { type: "error"; message: string };
          if (event.type === "delta") setPlanPreview((current) => current + event.text);
          if (event.type === "reasoning_delta") setPlanReasoning((current) => current + event.text);
          if (event.type === "error") throw new Error(event.message);
        }
      }
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError"))
        toast.error(error instanceof Error ? error.message : t("planFailedTitle"));
    } finally {
      planController.current = null;
      setPlanGeneratingRevisionId((current) => (current === revisionId ? null : current));
      await Promise.all([
        client.invalidateQueries({ queryKey: ["project-revision", revisionId] }),
        client.invalidateQueries({ queryKey: ["project-revisions", projectId] }),
      ]);
    }
  };

  const stopPlanGeneration = () => planController.current?.abort();

  const removeRevision = useMutation({
    mutationFn: (revision: ProjectRevisionSummary) =>
      api(`/api/revisions/${revision.id}`, { method: "DELETE" }),
    onSuccess: async (_result, revision) => {
      const items = revisions.data ?? [];
      const index = items.findIndex((item) => item.id === revision.id);
      const next = items[index + 1] ?? items[index - 1] ?? null;
      setDeleteTarget(null);
      setSelectedRevisionId(next?.id ?? null);
      client.removeQueries({ queryKey: ["project-revision", revision.id] });
      await client.invalidateQueries({ queryKey: ["project-revisions", projectId] });
      router.replace(
        next
          ? `/projects/${projectId}/revisions?revision=${encodeURIComponent(next.id)}`
          : `/projects/${projectId}/revisions`,
        { scroll: false },
      );
    },
    onError: (error) => toast.error(error.message),
  });

  const applyExecutionEvent = (revisionId: string, event: ExecutionEvent) => {
    client.setQueryData<ProjectRevisionDetail>(["project-revision", revisionId], (current) => {
      if (!current) return current;
      if (event.type === "execution_ready")
        return {
          ...current,
          status: "executing",
          windows: event.windows,
          resultMarkdown: event.resultMarkdown,
          executionWindowTokens: event.windowTokens,
        };
      if (event.type === "window_start")
        return {
          ...current,
          status: "executing",
          windows: current.windows.map((window) =>
            window.id === event.windowId
              ? { ...window, status: "generating", outputContent: "" }
              : window,
          ),
        };
      if (event.type === "delta")
        return {
          ...current,
          windows: current.windows.map((window) =>
            window.id === event.windowId
              ? { ...window, outputContent: window.outputContent + event.text }
              : window,
          ),
        };
      if (event.type === "window_complete")
        return {
          ...current,
          resultMarkdown: event.resultMarkdown,
          windows: current.windows.map((window) =>
            window.id === event.windowId
              ? { ...window, status: "completed", outputContent: event.content }
              : window,
          ),
        };
      if (event.type === "complete")
        return { ...current, status: "completed", resultMarkdown: event.resultMarkdown };
      return current;
    });
  };

  const executeRevision = async (requestedModelId?: string | null) => {
    if (!activeRevisionId || executing) return;
    setExecutionOpen(false);
    setRevisionView("result");
    setExecuting(true);
    const controller = new AbortController();
    executionController.current = controller;
    try {
      const response = await fetch(`/api/revisions/${activeRevisionId}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId: requestedModelId || null }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || t("executionFailed"));
      }
      if (!response.body) throw new Error(t("noModelStream"));
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as ExecutionEvent;
          if (event.type === "error") throw new Error(event.message);
          applyExecutionEvent(activeRevisionId, event);
        }
      }
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError"))
        toast.error(error instanceof Error ? error.message : t("executionFailed"));
    } finally {
      executionController.current = null;
      setExecuting(false);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["project-revision", activeRevisionId] }),
        client.invalidateQueries({ queryKey: ["project-revisions", projectId] }),
      ]);
    }
  };

  const stopExecution = () => executionController.current?.abort();
  const openExecutionDialog = () => {
    setExecutionModelId("");
    setExecutionOpen(true);
  };
  const openDownloadDialog = () => {
    setDownloadFormat("markdown");
    setDownloadOpen(true);
  };
  const downloadRevision = () => {
    if (activeRevision?.status !== "completed" || !activeRevision.resultMarkdown.trim()) return;
    const content =
      downloadFormat === "markdown"
        ? activeRevision.resultMarkdown
        : markdownToPlainText(activeRevision.resultMarkdown);
    const extension = downloadFormat === "markdown" ? "md" : "txt";
    const blob = new Blob(["\uFEFF", content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeFileName(`${activeRevision.sourceProjectName}-${activeRevision.name}`)}.${extension}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setDownloadOpen(false);
  };

  return (
    <div className="flex h-full min-h-0 bg-zinc-50">
      <aside className="flex w-72 shrink-0 flex-col border-zinc-200 border-r bg-zinc-50/80">
        <div className="flex h-14 shrink-0 items-center justify-between border-zinc-200 border-b px-4">
          <div>
            <h1 className="font-semibold text-sm">{t("title")}</h1>
            <p className="mt-0.5 text-[11px] text-zinc-400">
              {t("revisionCount", { count: revisions.data?.length ?? 0 })}
            </p>
          </div>
          <Tooltip label={t("newRevision")}>
            <Button size="icon" onClick={openCreate}>
              <Plus className="size-4" />
            </Button>
          </Tooltip>
        </div>
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-2.5">
          {revisions.data?.map((revision) => (
            <button
              key={revision.id}
              type="button"
              onClick={() => selectRevision(revision.id)}
              className={cn(
                "mb-1 flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition",
                activeRevisionId === revision.id
                  ? "bg-white shadow-sm ring-1 ring-zinc-200"
                  : "hover:bg-white/70",
              )}
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-zinc-600">
                <FilePenLine className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-sm">{revision.name}</span>
                <span className="mt-1 flex items-center justify-between gap-2 text-[11px] text-zinc-400">
                  <span className="truncate">{statusLabel(t, revision.status)}</span>
                  <span className="shrink-0">{formatDate(revision.createdAt, locale)}</span>
                </span>
              </span>
            </button>
          ))}
          {!revisions.isLoading && !revisions.data?.length ? (
            <div className="px-5 py-16 text-center">
              <FilePenLine className="mx-auto size-6 text-zinc-300" />
              <p className="mt-3 text-xs text-zinc-400">{t("noRevisions")}</p>
              <Button className="mt-4" size="sm" variant="secondary" onClick={openCreate}>
                {t("newRevision")}
              </Button>
            </div>
          ) : null}
        </div>
      </aside>
      <section className="flex min-w-0 flex-1 flex-col bg-white">
        {activeRevision ? (
          <>
            <header className="flex h-14 shrink-0 items-center justify-between border-zinc-200 border-b px-5">
              <div className="min-w-0">
                <h2 className="truncate font-semibold text-sm">{activeRevision.name}</h2>
                <p className="mt-0.5 truncate text-[11px] text-zinc-400">
                  {activeRevision.sourceType === "review"
                    ? activeRevision.reviewerName
                    : activeRevision.sourceType === "style"
                      ? activeRevision.styleFingerprintName
                      : t("customRequirements")}{" "}
                  · {activeRevision.scopeChapterTitle ?? t("allChapters")} ·{" "}
                  {formatDateTime(activeRevision.createdAt, locale)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {activeRevision.activeBlueprint &&
                !["draft", "planning", "blueprint_failed", "blueprint_ready"].includes(
                  activeRevision.status,
                ) ? (
                  <div className="flex items-center rounded-lg bg-zinc-100 p-0.5">
                    <Button
                      size="sm"
                      variant={revisionView === "blueprint" ? "secondary" : "ghost"}
                      onClick={() => setRevisionView("blueprint")}
                    >
                      {t("viewBlueprint")}
                    </Button>
                    <Button
                      size="sm"
                      variant={revisionView === "result" ? "secondary" : "ghost"}
                      onClick={() => setRevisionView("result")}
                    >
                      {t("viewResult")}
                    </Button>
                  </div>
                ) : null}
                {activeRevision.status === "blueprint_ready" ? (
                  <>
                    <Button size="sm" variant="secondary" onClick={openPlanDialog}>
                      <RotateCcw className="size-3.5" />
                      {t("regeneratePlan")}
                    </Button>
                    <Button size="sm" onClick={openExecutionDialog}>
                      <Play className="size-3.5" />
                      {t("execute")}
                    </Button>
                  </>
                ) : null}
                {activeRevision.status === "executing" && executing ? (
                  <Button size="sm" variant="danger" onClick={stopExecution}>
                    <Pause className="size-3.5" />
                    {t("stop")}
                  </Button>
                ) : null}
                {(activeRevision.status === "paused" ||
                  activeRevision.status === "execution_failed") &&
                !executing ? (
                  <Button size="sm" onClick={() => void executeRevision(null)}>
                    <Play className="size-3.5" />
                    {t("continue")}
                  </Button>
                ) : null}
                <Tooltip label={t("download")}>
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={
                      activeRevision.status !== "completed" || !activeRevision.resultMarkdown.trim()
                    }
                    onClick={openDownloadDialog}
                    aria-label={t("download")}
                  >
                    <Download className="size-4" />
                  </Button>
                </Tooltip>
                <Tooltip label={common("delete")}>
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={
                      activeRevision.status === "planning" || activeRevision.status === "executing"
                    }
                    onClick={() => setDeleteTarget(activeRevision)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </Tooltip>
              </div>
            </header>
            <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
              {activeRevision.status === "draft" ? (
                <EmptyState
                  title={t("planRequiredTitle")}
                  description={t("planRequiredDescription")}
                  action={
                    <Button onClick={openPlanDialog}>
                      <ListChecks className="size-4" />
                      {t("generatePlan")}
                    </Button>
                  }
                />
              ) : activeRevision.status === "planning" || planGenerating ? (
                <PlanGenerationView
                  reasoning={planGenerating ? planReasoning : ""}
                  preview={planGenerating ? planPreview : ""}
                  generating={planGenerating}
                  reasoningRef={planReasoningRef}
                  previewRef={planPreviewRef}
                  onStop={stopPlanGeneration}
                />
              ) : activeRevision.status === "blueprint_failed" ? (
                <EmptyState
                  title={t("planFailedTitle")}
                  description={t("planFailedDescription")}
                  action={
                    <Button onClick={openPlanDialog}>
                      <RotateCcw className="size-4" />
                      {t("retryPlan")}
                    </Button>
                  }
                />
              ) : activeRevision.status === "blueprint_ready" || revisionView === "blueprint" ? (
                <BlueprintView revision={activeRevision} />
              ) : (
                <ResultView revision={activeRevision} />
              )}
            </div>
          </>
        ) : (
          <EmptyState
            title={t("selectOrCreate")}
            description={t("selectOrCreateDescription")}
            action={
              <Button onClick={openCreate}>
                <Plus className="size-4" />
                {t("newRevision")}
              </Button>
            }
          />
        )}
      </section>

      <Modal
        open={createOpen}
        onOpenChange={(open) => !createRevision.isPending && setCreateOpen(open)}
        title={t("createTitle")}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            createRevision.mutate();
          }}
        >
          <div className="space-y-4 p-5">
            <div>
              <Label>{t("sourceType")}</Label>
              <Select
                value={revisionSource}
                onChange={(value) => {
                  const source = value as ProjectRevisionSource;
                  setRevisionSource(source);
                  const fingerprint =
                    (settings.data?.styleFingerprints ?? []).find(
                      (candidate) => candidate.id === createStyleFingerprintId,
                    ) ?? settings.data?.styleFingerprints[0];
                  setRevisionName(
                    source === "custom"
                      ? t("customDefaultName")
                      : source === "style"
                        ? fingerprint
                          ? t("styleDefaultName", { fingerprint: fingerprint.name })
                          : t("styleDefaultNameFallback")
                        : completedReviews[0]
                          ? t("defaultName", { reviewer: completedReviews[0].reviewerName })
                          : "",
                  );
                  if (source === "review" && !reviewId) setReviewId(completedReviews[0]?.id ?? "");
                  if (source === "style" && !createStyleFingerprintId)
                    setCreateStyleFingerprintId(fingerprint?.id ?? "");
                }}
                options={[
                  { value: "review", label: t("sourceReview") },
                  { value: "style", label: t("sourceStyle") },
                  { value: "custom", label: t("sourceCustom") },
                ]}
              />
            </div>
            {revisionSource === "review" ? (
              <div>
                <Label>{t("sourceReview")}</Label>
                <Select
                  value={reviewId}
                  onChange={(value) => {
                    setReviewId(value);
                    const review = completedReviews.find((candidate) => candidate.id === value);
                    if (review)
                      setRevisionName(t("defaultName", { reviewer: review.reviewerName }));
                  }}
                  options={completedReviews.map((review) => ({
                    value: review.id,
                    label: review.reviewerName,
                    description: review.chapterTitle ?? t("allChapters"),
                  }))}
                  placeholder={t("selectReview")}
                />
                {!reviews.isLoading && !completedReviews.length ? (
                  <p className="mt-2 text-amber-600 text-xs">{t("noCompletedReviews")}</p>
                ) : null}
              </div>
            ) : revisionSource === "style" ? (
              <div className="space-y-4">
                <div>
                  <Label>{t("styleFingerprint")}</Label>
                  <Select
                    value={createStyleFingerprintId}
                    onChange={(value) => {
                      setCreateStyleFingerprintId(value);
                      const fingerprint = settings.data?.styleFingerprints.find(
                        (candidate) => candidate.id === value,
                      );
                      if (fingerprint)
                        setRevisionName(t("styleDefaultName", { fingerprint: fingerprint.name }));
                    }}
                    options={(settings.data?.styleFingerprints ?? []).map((fingerprint) => ({
                      value: fingerprint.id,
                      label: fingerprint.name,
                    }))}
                    placeholder={t("selectStyleFingerprint")}
                  />
                </div>
                <div>
                  <Label>{t("styleRewriteInstructions")}</Label>
                  <Textarea
                    autoFocus
                    className="min-h-28"
                    value={createRequirements}
                    onChange={(event) => setCreateRequirements(event.target.value)}
                    placeholder={t("styleRewriteInstructionsPlaceholder")}
                  />
                </div>
              </div>
            ) : (
              <div>
                <Label>{t("customRequirements")}</Label>
                <Textarea
                  autoFocus
                  required
                  className="min-h-32"
                  value={createRequirements}
                  onChange={(event) => setCreateRequirements(event.target.value)}
                  placeholder={t("customRequirementsPlaceholder")}
                />
              </div>
            )}
            <div>
              <Label>{t("revisionScope")}</Label>
              {revisionSource === "review" ? (
                <>
                  <div className="flex h-9 items-center rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-700">
                    {selectedCreateReview?.chapterTitle ?? t("allChapters")}
                  </div>
                  <p className="mt-1.5 text-[11px] text-zinc-400 leading-5">
                    {t("scopeFollowsReview")}
                  </p>
                </>
              ) : (
                <Select
                  value={createChapterId}
                  onChange={setCreateChapterId}
                  options={chapterOptions}
                />
              )}
            </div>
            <div>
              <Label>{t("name")}</Label>
              <Input
                required
                value={revisionName}
                onChange={(event) => setRevisionName(event.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 border-zinc-100 border-t p-3">
            <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>
              {common("cancel")}
            </Button>
            <Button
              type="submit"
              disabled={
                !revisionName.trim() ||
                (revisionSource === "review"
                  ? !reviewId
                  : revisionSource === "style"
                    ? !createStyleFingerprintId
                    : !createRequirements.trim())
              }
              loading={createRevision.isPending}
            >
              {t("create")}
            </Button>
          </div>
        </form>
      </Modal>
      <Modal
        open={planOpen}
        onOpenChange={setPlanOpen}
        title={activeRevision?.activeBlueprint ? t("regeneratePlanTitle") : t("generatePlanTitle")}
        width="max-w-2xl"
      >
        <div className="space-y-4 p-5">
          <div>
            <Label>{t("planModel")}</Label>
            <Select
              value={planModelId}
              onChange={setPlanModelId}
              options={modelOptions(defaultPlanModelId)}
            />
          </div>
          <div>
            <Label>{t("requirements")}</Label>
            <Textarea
              className="min-h-32"
              value={requirements}
              onChange={(event) => setRequirements(event.target.value)}
              placeholder={t("requirementsPlaceholder")}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-zinc-100 border-t p-3">
          <Button variant="secondary" onClick={() => setPlanOpen(false)}>
            {common("cancel")}
          </Button>
          <Button onClick={() => void generatePlan()}>
            {activeRevision?.activeBlueprint
              ? t("regeneratePlan")
              : activeRevision?.status === "blueprint_failed"
                ? t("retryPlan")
                : t("generatePlan")}
          </Button>
        </div>
      </Modal>
      <Modal
        open={executionOpen}
        onOpenChange={setExecutionOpen}
        title={t("executeTitle")}
        description={t("executeDescription")}
      >
        <div className="p-5">
          <Label>{t("executionModel")}</Label>
          <Select
            value={executionModelId}
            onChange={setExecutionModelId}
            options={modelOptions(defaultExecutionModelId)}
          />
        </div>
        <div className="flex justify-end gap-2 border-zinc-100 border-t p-3">
          <Button variant="secondary" onClick={() => setExecutionOpen(false)}>
            {common("cancel")}
          </Button>
          <Button onClick={() => void executeRevision(executionModelId)}>
            <Play className="size-4" />
            {t("startExecution")}
          </Button>
        </div>
      </Modal>
      <Modal
        open={downloadOpen}
        onOpenChange={setDownloadOpen}
        title={t("downloadTitle")}
        description={t("downloadDescription")}
        width="max-w-sm"
      >
        <div className="space-y-2 p-5" role="radiogroup" aria-label={t("downloadFormat")}>
          {(["markdown", "txt"] as const).map((format) => (
            <button
              key={format}
              type="button"
              role="radio"
              aria-checked={downloadFormat === format}
              onClick={() => setDownloadFormat(format)}
              className={cn(
                "focus-ring flex w-full items-center gap-3 rounded-xl border p-3 text-left transition",
                downloadFormat === format
                  ? "border-zinc-950 bg-zinc-50 ring-1 ring-zinc-950"
                  : "border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50",
              )}
            >
              <span
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-lg",
                  downloadFormat === format
                    ? "bg-zinc-950 text-white"
                    : "bg-zinc-100 text-zinc-500",
                )}
              >
                <FileText className="size-4" />
              </span>
              <span>
                <span className="block font-medium text-sm text-zinc-900">
                  {t(format === "markdown" ? "formatMarkdown" : "formatText")}
                </span>
                <span className="mt-0.5 block text-xs text-zinc-400">
                  .{format === "markdown" ? "md" : "txt"}
                </span>
              </span>
            </button>
          ))}
        </div>
        <div className="flex justify-end gap-2 border-zinc-100 border-t p-3">
          <Button variant="secondary" onClick={() => setDownloadOpen(false)}>
            {common("cancel")}
          </Button>
          <Button onClick={downloadRevision}>
            <Download className="size-4" />
            {t("download")}
          </Button>
        </div>
      </Modal>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t("deleteTitle")}
        description={t("deleteDescription", { name: deleteTarget?.name ?? "" })}
        onConfirm={() => deleteTarget && removeRevision.mutate(deleteTarget)}
        loading={removeRevision.isPending}
      />
    </div>
  );
}

function BlueprintView({ revision }: { revision: ProjectRevisionDetail }) {
  const t = useTranslations("Revision");
  if (!revision.activeBlueprint?.content) return null;
  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <div className="mb-7 flex items-center gap-2 font-medium text-xs text-zinc-400 uppercase tracking-[.14em]">
        <ListChecks className="size-4" />
        {t("revisionBlueprint")}
      </div>
      <section className="mb-8 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
        <h3 className="font-semibold text-xs text-zinc-700">{t("requirements")}</h3>
        <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-600 leading-6">
          {revision.requirements.trim() || t("noRequirements")}
        </p>
        {revision.styleFingerprintConfig ? (
          <div className="mt-4 border-zinc-200 border-t pt-4">
            <h3 className="font-semibold text-xs text-zinc-700">
              {t("styleRewrite")} · {revision.styleFingerprintName}
            </h3>
            <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-600 leading-6">
              {revision.styleFingerprintConfig}
            </p>
          </div>
        ) : null}
      </section>
      <MarkdownContent content={revision.activeBlueprint.content} />
    </div>
  );
}

function PlanGenerationView({
  reasoning,
  preview,
  generating,
  reasoningRef,
  previewRef,
  onStop,
}: {
  reasoning: string;
  preview: string;
  generating: boolean;
  reasoningRef: React.RefObject<HTMLPreElement | null>;
  previewRef: React.RefObject<HTMLDivElement | null>;
  onStop: () => void;
}) {
  const t = useTranslations("Revision");
  return (
    <div className="min-h-full">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-zinc-100 border-b bg-white/95 px-8 py-4 backdrop-blur">
        <div>
          <h3 className="font-semibold text-sm">{t("generatingPlan")}</h3>
          <p className="mt-0.5 text-xs text-zinc-400">{t("generatingPlanDescription")}</p>
        </div>
        {generating ? (
          <Button size="sm" variant="danger" onClick={onStop}>
            <Pause className="size-3.5" />
            {t("stopPlanGeneration")}
          </Button>
        ) : null}
      </div>
      <div className="mx-auto max-w-4xl space-y-6 px-8 py-8">
        <section>
          <Label>{t("reasoningProcess")}</Label>
          <pre
            ref={reasoningRef}
            className="scrollbar-thin mt-2 max-h-56 min-h-24 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-zinc-200 bg-zinc-50 p-4 font-mono text-xs text-zinc-500 leading-5"
          >
            {reasoning || t("waitingForReasoning")}
            {generating && !preview ? (
              <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-zinc-400" />
            ) : null}
          </pre>
        </section>
        <section>
          <Label>{t("planStreamPreview")}</Label>
          <div
            ref={previewRef}
            className="scrollbar-thin mt-2 max-h-[60vh] min-h-64 overflow-y-auto rounded-xl border border-zinc-200 bg-white px-7 py-6"
          >
            {preview ? (
              <>
                <MarkdownContent content={preview} />
                {generating ? (
                  <span className="ml-0.5 inline-block h-5 w-0.5 animate-pulse bg-zinc-700" />
                ) : null}
              </>
            ) : (
              <div className="flex min-h-52 items-center justify-center text-sm text-zinc-400">
                {t("waitingForPlanOutput")}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function ResultView({ revision }: { revision: ProjectRevisionDetail }) {
  const t = useTranslations("Revision");
  const [tocOpen, setTocOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const completed = revision.windows.filter((window) => window.status === "completed").length;
  const generating = revision.windows.find((window) => window.status === "generating");
  const liveFragments = revision.windows
    .filter(
      (window) =>
        (window.status === "completed" || window.status === "generating") &&
        window.outputContent.trim(),
    )
    .sort((left, right) => left.documentWindowIndex - right.documentWindowIndex)
    .map((window) => window.outputContent.trim());
  const liveMarkdown = liveFragments.length
    ? `# ${revision.sourceProjectName}\n\n${liveFragments.join("\n\n")}`
    : revision.resultMarkdown;
  const chapters = useMemo(
    () =>
      [...liveMarkdown.matchAll(/^##\s+(.+)$/gm)].map((match) =>
        match[1]
          .trim()
          .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
          .replace(/[*_`~]/g, ""),
      ),
    [liveMarkdown],
  );
  const jumpToChapter = (index: number) => {
    const heading = contentRef.current?.querySelectorAll("h2").item(index) as
      | HTMLElement
      | undefined;
    if (!heading) return;
    heading.style.scrollMarginTop = "5rem";
    heading.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="z-10 shrink-0 border-zinc-100 border-b bg-white/95 px-8 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-4">
          <p className="truncate text-xs text-zinc-400">
            {t("executionProgress", { completed, total: revision.windows.length })}
            {revision.executionWindowTokens
              ? ` · ${t("effectiveWindowSize", { count: Number((revision.executionWindowTokens / 1_000).toFixed(2)) })}`
              : ""}
          </p>
          {generating ? (
            <p className="shrink-0 text-xs text-zinc-500">
              {t("currentWindow", {
                chapter: generating.sourceChapterNumber,
                current: generating.chapterWindowIndex + 1,
                total: generating.chapterWindowCount,
              })}
            </p>
          ) : null}
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
          <div
            className="h-full rounded-full bg-zinc-900 transition-[width]"
            style={{
              width: `${revision.windows.length ? (completed / revision.windows.length) * 100 : 0}%`,
            }}
          />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <AnimatePresence initial={false}>
          {tocOpen && chapters.length ? (
            <motion.aside
              layout
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 288, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="shrink-0 overflow-hidden border-zinc-200 border-r bg-zinc-50/70"
            >
              <div className="flex h-full w-72 flex-col">
                <div className="flex h-12 shrink-0 items-center justify-between border-zinc-100 border-b pr-2 pl-4 font-semibold text-xs text-zinc-700">
                  <span>{t("chapterDirectory")}</span>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setTocOpen(false)}
                    aria-label={t("collapseDirectory")}
                  >
                    <ArrowLeftFromLine className="size-4" />
                  </Button>
                </div>
                <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-2">
                  {chapters.map((chapter, index) => (
                    <button
                      key={`${chapter}-${index}`}
                      type="button"
                      onClick={() => jumpToChapter(index)}
                      className="focus-ring flex w-full items-start gap-2 rounded-lg px-3 py-2.5 text-left text-sm text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950"
                    >
                      <span className="mt-0.5 w-6 shrink-0 font-mono text-[10px] text-zinc-400">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="min-w-0 flex-1 leading-5">{chapter}</span>
                    </button>
                  ))}
                </div>
              </div>
            </motion.aside>
          ) : null}
        </AnimatePresence>
        <motion.div
          layout
          ref={contentRef}
          className="scrollbar-thin min-h-0 min-w-0 flex-1 overflow-y-auto"
        >
          <div className="mx-auto max-w-4xl px-8 py-10">
            {liveMarkdown ? (
              <>
                <MarkdownContent content={liveMarkdown} className="[&>p]:indent-[2em]" />
                {generating ? (
                  <span className="ml-0.5 inline-block h-5 w-0.5 animate-pulse bg-zinc-700" />
                ) : null}
              </>
            ) : (
              <div className="flex min-h-72 items-center justify-center text-sm text-zinc-400">
                {revision.status === "executing" ? t("generatingProse") : t("waitingForContent")}
              </div>
            )}
          </div>
        </motion.div>
      </div>
      {!tocOpen && chapters.length ? (
        <button
          type="button"
          onClick={() => setTocOpen(true)}
          aria-label={t("tableOfContents")}
          aria-expanded={false}
          className="focus-ring absolute bottom-6 left-6 z-40 flex size-10 items-center justify-center rounded-full bg-zinc-950 text-white shadow-lg transition hover:bg-zinc-800"
        >
          <ListTree className="size-4" />
        </button>
      ) : null}
    </div>
  );
}

function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-72 flex-col items-center justify-center px-8 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-zinc-100">
        <FilePenLine className="size-6 text-zinc-400" />
      </span>
      <h2 className="mt-4 font-semibold text-sm">{title}</h2>
      <p className="mt-1 max-w-sm text-xs text-zinc-400 leading-5">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

function statusLabel(
  t: ReturnType<typeof useTranslations<"Revision">>,
  status: ProjectRevisionSummary["status"],
) {
  return t(`status.${status}`);
}

function formatDate(value: string, locale: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric" }).format(date);
}

function formatDateTime(value: string, locale: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function markdownToPlainText(markdown: string) {
  return markdown
    .replace(/\r\n?/g, "\n")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/_([^_\n]+)_/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*(?:---+|___+)\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function safeFileName(value: string) {
  return (
    value
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
      .replace(/[. ]+$/g, "")
      .slice(0, 160) || "revision"
  );
}
