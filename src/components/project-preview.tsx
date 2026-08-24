"use client";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftFromLine, BookOpen, Download, FileText, ListTree } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Button, Modal, Tooltip } from "@/components/ui";
import { api } from "@/lib/client";
import type { Project } from "@/lib/types";
import { cn } from "@/lib/utils";

interface ProjectPreviewBlock {
  id: string;
  content: string;
}

interface ProjectPreviewChapter {
  id: string;
  title: string;
  blocks: ProjectPreviewBlock[];
}

interface ProjectPreview {
  chapters: ProjectPreviewChapter[];
}

type PreviewDownloadFormat = "markdown" | "txt";

export function ProjectPreviewWorkspace({
  projectId,
  project,
}: {
  projectId: string;
  project: Project;
}) {
  const t = useTranslations("Project");
  const [tocOpen, setTocOpen] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [downloadFormat, setDownloadFormat] = useState<PreviewDownloadFormat>("markdown");
  const contentRef = useRef<HTMLDivElement | null>(null);
  const preview = useQuery({
    queryKey: ["project-preview", projectId],
    queryFn: () => api<ProjectPreview>(`/api/projects/${projectId}/preview`),
  });
  const chapters = preview.data?.chapters ?? [];

  const jumpToChapter = (chapterId: string) => {
    const heading = contentRef.current?.querySelector<HTMLElement>(
      `[data-preview-chapter="${CSS.escape(chapterId)}"]`,
    );
    if (!heading) return;
    heading.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const openDownloadDialog = () => {
    setDownloadFormat("markdown");
    setDownloadOpen(true);
  };

  const downloadPreview = () => {
    if (!chapters.length) return;
    const content =
      downloadFormat === "markdown"
        ? previewMarkdown(project.name, chapters)
        : previewText(project.name, chapters);
    const extension = downloadFormat === "markdown" ? "md" : "txt";
    const blob = new Blob(["\uFEFF", content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeFileName(project.name)}.${extension}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setDownloadOpen(false);
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-white">
      <header className="flex h-14 shrink-0 items-center justify-between border-zinc-200 border-b px-6">
        <div className="min-w-0">
          <h1 className="truncate font-semibold text-sm">{t("preview")}</h1>
          <p className="mt-0.5 truncate text-[11px] text-zinc-400">{t("previewDescription")}</p>
        </div>
        <div className="flex items-center gap-2">
          {preview.data ? (
            <span className="text-xs text-zinc-400">
              {t("previewChapterCount", { count: chapters.length })}
            </span>
          ) : null}
          <Tooltip label={t("downloadPreview")}>
            <Button
              size="icon"
              variant="ghost"
              disabled={!chapters.length}
              onClick={openDownloadDialog}
              aria-label={t("downloadPreview")}
            >
              <Download className="size-4" />
            </Button>
          </Tooltip>
        </div>
      </header>
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
                      key={chapter.id}
                      type="button"
                      onClick={() => jumpToChapter(chapter.id)}
                      className="focus-ring flex w-full items-start gap-2 rounded-lg px-3 py-2.5 text-left text-sm text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950"
                    >
                      <span className="mt-0.5 w-6 shrink-0 font-mono text-[10px] text-zinc-400">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="min-w-0 flex-1 leading-5">{chapter.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            </motion.aside>
          ) : null}
        </AnimatePresence>
        <motion.div layout className="scrollbar-thin min-h-0 min-w-0 flex-1 overflow-y-auto">
          {preview.isLoading ? (
            <div className="flex min-h-72 items-center justify-center text-sm text-zinc-400">
              {t("previewLoading")}
            </div>
          ) : preview.isError ? (
            <div className="flex min-h-72 items-center justify-center text-red-500 text-sm">
              {preview.error.message}
            </div>
          ) : chapters.length ? (
            <div ref={contentRef} className="mx-auto max-w-4xl px-8 py-10">
              <article className="text-[15px] text-zinc-700 leading-8">
                <h1 className="mb-12 font-semibold text-3xl text-zinc-950 tracking-tight">
                  {project.name}
                </h1>
                {chapters.map((chapter) => {
                  const paragraphs = chapter.blocks.flatMap((block) =>
                    block.content
                      .split(/\r?\n/)
                      .map((line) => line.trim())
                      .filter(Boolean),
                  );
                  return (
                    <section
                      key={chapter.id}
                      data-preview-chapter={chapter.id}
                      className="mb-14 scroll-mt-6"
                    >
                      <h2 className="mb-7 font-semibold text-xl text-zinc-950 tracking-tight">
                        {chapter.title}
                      </h2>
                      {paragraphs.length ? (
                        <div className="space-y-4">
                          {paragraphs.map((paragraph, index) => (
                            <p
                              key={`${chapter.id}-${index}`}
                              className="whitespace-pre-wrap indent-[2em]"
                            >
                              {paragraph}
                            </p>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-zinc-300">{t("previewChapterEmpty")}</p>
                      )}
                    </section>
                  );
                })}
              </article>
            </div>
          ) : (
            <div className="flex min-h-72 flex-col items-center justify-center text-center">
              <span className="flex size-14 items-center justify-center rounded-2xl bg-zinc-100">
                <BookOpen className="size-6 text-zinc-400" />
              </span>
              <p className="mt-4 font-semibold text-sm text-zinc-700">{t("previewEmpty")}</p>
            </div>
          )}
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
      <Modal
        open={downloadOpen}
        onOpenChange={setDownloadOpen}
        title={t("downloadPreviewTitle")}
        description={t("downloadPreviewDescription")}
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
            {t("cancelDownload")}
          </Button>
          <Button onClick={downloadPreview}>
            <Download className="size-4" />
            {t("downloadPreview")}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function chapterContent(chapter: ProjectPreviewChapter) {
  return chapter.blocks
    .map((block) => block.content.trim())
    .filter(Boolean)
    .join("\n\n");
}

function previewMarkdown(projectName: string, chapters: ProjectPreviewChapter[]) {
  const body = chapters
    .map(
      (chapter) =>
        `## ${chapter.title}${chapterContent(chapter) ? `\n\n${chapterContent(chapter)}` : ""}`,
    )
    .join("\n\n");
  return `# ${projectName}\n\n${body}`.trim();
}

function previewText(projectName: string, chapters: ProjectPreviewChapter[]) {
  const body = chapters
    .map(
      (chapter) =>
        `${chapter.title}${chapterContent(chapter) ? `\n\n${chapterContent(chapter)}` : ""}`,
    )
    .join("\n\n");
  return `${projectName}\n\n${body}`.trim();
}

function safeFileName(value: string) {
  return (
    value
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
      .replace(/[. ]+$/g, "")
      .slice(0, 160) || "project"
  );
}
