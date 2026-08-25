"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardPenLine, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { MarkdownContent } from "@/components/markdown-content";
import { Button, ConfirmDialog, Label, Modal, Select, Tooltip } from "@/components/ui";
import { api } from "@/lib/client";
import type { AppSettings, Chapter, LlmService, Project, ProjectReview } from "@/lib/types";
import { cn } from "@/lib/utils";

interface SettingsPayload {
  settings: AppSettings;
  services: LlmService[];
}

export function ProjectReviewWorkspace({
  projectId,
  initialReviewId,
  project,
  chapters,
}: {
  projectId: string;
  initialReviewId: string | null;
  project: Project;
  chapters: Chapter[];
}) {
  const t = useTranslations("Review");
  const common = useTranslations("Common");
  const locale = useLocale();
  const router = useRouter();
  const client = useQueryClient();
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(initialReviewId);
  const [createOpen, setCreateOpen] = useState(false);
  const [reviewerId, setReviewerId] = useState("");
  const [modelId, setModelId] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectReview | null>(null);

  const reviews = useQuery({
    queryKey: ["project-reviews", projectId],
    queryFn: () => api<ProjectReview[]>(`/api/projects/${projectId}/reviews`),
  });
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<SettingsPayload>("/api/settings"),
  });
  const activeReviewId =
    selectedReviewId && reviews.data?.some((review) => review.id === selectedReviewId)
      ? selectedReviewId
      : initialReviewId && reviews.data?.some((review) => review.id === initialReviewId)
        ? initialReviewId
        : (reviews.data?.[0]?.id ?? null);
  const activeReview = reviews.data?.find((review) => review.id === activeReviewId) ?? null;
  const availableModels =
    settings.data?.services.flatMap((service) =>
      service.models.map((model) => ({
        value: model.id,
        label: model.displayName,
        description: `${service.name} · ${model.modelId}`,
      })),
    ) ?? [];
  const defaultModelId =
    project.modelOverrides.review ||
    settings.data?.settings.taskModels.review ||
    settings.data?.settings.globalDefaultModel ||
    "";
  const defaultModel = availableModels.find((model) => model.value === defaultModelId);
  const modelOptions = [
    {
      value: "",
      label: defaultModel
        ? t("defaultModelNamed", { name: defaultModel.label })
        : t("defaultModel"),
    },
    ...availableModels,
  ];
  const chapterOptions = [
    { value: "", label: t("allChapters") },
    ...chapters.map((chapter) => ({ value: chapter.id, label: chapter.title })),
  ];
  const reviewerOptions =
    settings.data?.settings.reviewerPrompts.map((reviewer) => ({
      value: reviewer.id,
      label: reviewer.name,
    })) ?? [];

  useEffect(() => {
    if (!activeReviewId || initialReviewId === activeReviewId) return;
    router.replace(`/projects/${projectId}/reviews?review=${encodeURIComponent(activeReviewId)}`, {
      scroll: false,
    });
  }, [activeReviewId, initialReviewId, projectId, router]);

  const selectReview = (id: string) => {
    setSelectedReviewId(id);
    router.push(`/projects/${projectId}/reviews?review=${encodeURIComponent(id)}`, {
      scroll: false,
    });
  };

  const openCreate = () => {
    setReviewerId(settings.data?.settings.reviewerPrompts[0]?.id ?? "");
    setModelId("");
    setChapterId("");
    setCreateOpen(true);
  };

  const generateReview = async (review: ProjectReview) => {
    if (generatingId) return;
    setGeneratingId(review.id);
    client.setQueryData<ProjectReview[]>(["project-reviews", projectId], (current) =>
      current?.map((item) =>
        item.id === review.id ? { ...item, status: "generating", content: "" } : item,
      ),
    );
    try {
      const response = await fetch(`/api/reviews/${review.id}/generate`, { method: "POST" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || t("generationFailedStatus", { status: response.status }));
      }
      if (!response.body) throw new Error(t("noModelStream"));
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let content = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        content += decoder.decode(value, { stream: true });
        client.setQueryData<ProjectReview[]>(["project-reviews", projectId], (current) =>
          current?.map((item) =>
            item.id === review.id ? { ...item, status: "generating", content } : item,
          ),
        );
      }
      if (!content.trim()) throw new Error(t("emptyModelResponse"));
      client.setQueryData<ProjectReview[]>(["project-reviews", projectId], (current) =>
        current?.map((item) =>
          item.id === review.id ? { ...item, status: "completed", content: content.trim() } : item,
        ),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("generationFailed"));
    } finally {
      setGeneratingId(null);
      await client.invalidateQueries({ queryKey: ["project-reviews", projectId] });
    }
  };

  const createReview = async () => {
    if (!reviewerId || generatingId) return;
    try {
      const review = await api<ProjectReview>(`/api/projects/${projectId}/reviews`, {
        method: "POST",
        body: JSON.stringify({
          reviewerId,
          modelId: modelId || null,
          chapterId: chapterId || null,
        }),
      });
      client.setQueryData<ProjectReview[]>(["project-reviews", projectId], (current) => [
        review,
        ...(current ?? []),
      ]);
      setCreateOpen(false);
      setSelectedReviewId(review.id);
      router.push(`/projects/${projectId}/reviews?review=${encodeURIComponent(review.id)}`, {
        scroll: false,
      });
      await generateReview(review);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("generationFailed"));
    }
  };

  const removeReview = useMutation({
    mutationFn: (review: ProjectReview) => api(`/api/reviews/${review.id}`, { method: "DELETE" }),
    onSuccess: (_result, review) => {
      const items = reviews.data ?? [];
      const index = items.findIndex((item) => item.id === review.id);
      const next = items[index + 1] ?? items[index - 1] ?? null;
      setSelectedReviewId(next?.id ?? null);
      setDeleteTarget(null);
      client.invalidateQueries({ queryKey: ["project-reviews", projectId] });
      if (next)
        router.replace(`/projects/${projectId}/reviews?review=${encodeURIComponent(next.id)}`, {
          scroll: false,
        });
      else router.replace(`/projects/${projectId}/reviews`, { scroll: false });
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <div className="flex h-full min-h-0 bg-zinc-50">
      <aside className="flex w-72 shrink-0 flex-col border-zinc-200 border-r bg-zinc-50/80">
        <div className="flex h-14 shrink-0 items-center justify-between border-zinc-200 border-b px-4">
          <div>
            <h1 className="font-semibold text-sm">{t("title")}</h1>
            <p className="mt-0.5 text-[11px] text-zinc-400">
              {t("reviewCount", { count: reviews.data?.length ?? 0 })}
            </p>
          </div>
          <Tooltip label={t("newReview")}>
            <Button size="icon" onClick={openCreate} disabled={Boolean(generatingId)}>
              <Plus className="size-4" />
            </Button>
          </Tooltip>
        </div>
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-2.5">
          {reviews.data?.map((review) => (
            <button
              key={review.id}
              type="button"
              onClick={() => selectReview(review.id)}
              className={cn(
                "mb-1 flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition",
                activeReviewId === review.id
                  ? "bg-white shadow-sm ring-1 ring-zinc-200"
                  : "hover:bg-white/70",
              )}
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-zinc-600">
                <ClipboardPenLine className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-sm">{review.reviewerName}</span>
                <span className="mt-1 flex items-center justify-between text-[11px] text-zinc-400">
                  <span>
                    {review.status === "generating" || review.status === "pending"
                      ? t("generating")
                      : review.status === "failed"
                        ? t("failed")
                        : t("completed")}
                  </span>
                  <span>{formatDate(review.createdAt, locale)}</span>
                </span>
              </span>
            </button>
          ))}
          {!reviews.isLoading && !reviews.data?.length ? (
            <div className="px-5 py-16 text-center">
              <ClipboardPenLine className="mx-auto size-6 text-zinc-300" />
              <p className="mt-3 text-xs text-zinc-400">{t("noReviews")}</p>
              <Button className="mt-4" size="sm" variant="secondary" onClick={openCreate}>
                {t("newReview")}
              </Button>
            </div>
          ) : null}
        </div>
      </aside>
      <section className="flex min-w-0 flex-1 flex-col bg-white">
        {activeReview ? (
          <>
            <header className="flex h-14 shrink-0 items-center justify-between border-zinc-200 border-b px-5">
              <div className="min-w-0">
                <h2 className="truncate font-semibold text-sm">{activeReview.reviewerName}</h2>
                <p className="mt-0.5 truncate text-[11px] text-zinc-400">
                  {activeReview.chapterTitle ?? t("allChapters")} ·{" "}
                  {formatDateTime(activeReview.createdAt, locale)}
                </p>
              </div>
              <Tooltip label={common("delete")}>
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={
                    activeReview.status === "pending" || activeReview.status === "generating"
                  }
                  onClick={() => setDeleteTarget(activeReview)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </Tooltip>
            </header>
            <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto max-w-4xl px-8 py-10">
                {activeReview.status === "failed" ? (
                  <EmptyState
                    title={t("generationFailedTitle")}
                    description={t("generationFailedDescription")}
                    action={
                      <Button
                        loading={generatingId === activeReview.id}
                        onClick={() => void generateReview(activeReview)}
                      >
                        <RotateCcw className="size-4" />
                        {t("retry")}
                      </Button>
                    }
                  />
                ) : activeReview.content ? (
                  <MarkdownContent content={activeReview.content} />
                ) : (
                  <div className="flex min-h-72 flex-col items-center justify-center text-center">
                    <span className="flex size-12 items-center justify-center rounded-2xl bg-zinc-100">
                      <span className="streaming-dot size-2 rounded-full bg-zinc-500" />
                    </span>
                    <h3 className="mt-4 font-medium text-sm">{t("generatingTitle")}</h3>
                    <p className="mt-1 text-xs text-zinc-400">{t("generatingDescription")}</p>
                  </div>
                )}
                {activeReview.id === generatingId && activeReview.content ? (
                  <span className="ml-0.5 inline-block h-5 w-0.5 animate-pulse bg-zinc-700" />
                ) : null}
              </div>
            </div>
          </>
        ) : (
          <EmptyState
            title={t("selectOrCreate")}
            description={t("selectOrCreateDescription")}
            action={
              <Button onClick={openCreate}>
                <Plus className="size-4" />
                {t("newReview")}
              </Button>
            }
          />
        )}
      </section>
      <Modal
        open={createOpen}
        onOpenChange={(open) => !generatingId && setCreateOpen(open)}
        title={t("createTitle")}
        width="max-w-lg"
      >
        <div className="scrollbar-thin max-h-[70vh] space-y-5 overflow-y-auto p-5">
          <div>
            <Label>{t("reviewer")}</Label>
            <Select value={reviewerId} onChange={setReviewerId} options={reviewerOptions} />
            {!settings.isLoading && !reviewerOptions.length ? (
              <p className="mt-2 text-amber-600 text-xs">{t("noReviewers")}</p>
            ) : null}
          </div>
          <div>
            <Label>{t("modelOverride")}</Label>
            <Select value={modelId} onChange={setModelId} options={modelOptions} />
          </div>
          <div>
            <Label>{t("chapterScope")}</Label>
            <Select value={chapterId} onChange={setChapterId} options={chapterOptions} />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-zinc-100 border-t p-3">
          <Button variant="secondary" onClick={() => setCreateOpen(false)}>
            {common("cancel")}
          </Button>
          <Button
            disabled={!reviewerId}
            loading={Boolean(generatingId)}
            onClick={() => void createReview()}
          >
            {t("createAndGenerate")}
          </Button>
        </div>
      </Modal>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t("deleteTitle")}
        description={t("deleteDescription", { name: deleteTarget?.reviewerName ?? "" })}
        onConfirm={() => deleteTarget && removeReview.mutate(deleteTarget)}
        loading={removeReview.isPending}
      />
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
        <ClipboardPenLine className="size-6 text-zinc-400" />
      </span>
      <h2 className="mt-4 font-semibold text-sm">{title}</h2>
      <p className="mt-1 max-w-sm text-xs text-zinc-400 leading-5">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
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
