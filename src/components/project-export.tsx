"use client";

import { Database, Download, FileText } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { ProjectTransferSelectionList } from "@/components/project-transfer-selection";
import { Button, Modal } from "@/components/ui";
import {
  allProjectTransferSections,
  hasProjectTransferSelection,
  type ProjectTransferSelection,
  selectedProjectTransferSections,
} from "@/lib/project-transfer-selection";
import { cn } from "@/lib/utils";

type TextExportFormat = "markdown" | "txt";

export function ProjectExport({
  projectId,
  projectName,
  hasManuscript,
}: {
  projectId: string;
  projectName: string;
  hasManuscript: boolean;
}) {
  const t = useTranslations("Project");
  const [projectOpen, setProjectOpen] = useState(false);
  const [textOpen, setTextOpen] = useState(false);
  const [textFormat, setTextFormat] = useState<TextExportFormat>("markdown");
  const [selection, setSelection] = useState<ProjectTransferSelection>({
    ...allProjectTransferSections,
  });
  const [downloading, setDownloading] = useState<"project" | "text" | null>(null);

  const showProjectDialog = () => {
    setSelection({ ...allProjectTransferSections });
    setProjectOpen(true);
  };

  const downloadProject = async () => {
    if (!hasProjectTransferSelection(selection)) return;
    setDownloading("project");
    try {
      const include = selectedProjectTransferSections(selection).join(",");
      const response = await fetch(
        `/api/projects/${projectId}/export?format=project&include=${encodeURIComponent(include)}`,
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Request failed (${response.status})`);
      }
      saveBlob(
        new Blob([JSON.stringify(await response.json(), null, 2)], {
          type: "application/json;charset=utf-8",
        }),
        `${safeFileName(projectName)}.project.json`,
      );
      setProjectOpen(false);
      toast.success(t("exportSuccess"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("exportFailed"));
    } finally {
      setDownloading(null);
    }
  };

  const showTextDialog = () => {
    setTextFormat("markdown");
    setTextOpen(true);
  };

  const downloadText = async () => {
    if (!hasManuscript) return;
    setDownloading("text");
    try {
      const response = await fetch(
        `/api/projects/${projectId}/export?format=${encodeURIComponent(textFormat)}`,
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Request failed (${response.status})`);
      }
      saveBlob(
        await response.blob(),
        `${safeFileName(projectName)}.${textFormat === "markdown" ? "md" : "txt"}`,
      );
      setTextOpen(false);
      toast.success(t("exportTextSuccess"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("exportTextFailed"));
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button variant="secondary" onClick={showProjectDialog}>
        <Database className="size-4" />
        {t("exportProject")}
      </Button>
      <Button onClick={showTextDialog}>
        <FileText className="size-4" />
        {t("exportText")}
      </Button>
      <Modal
        open={projectOpen}
        onOpenChange={(next) => downloading !== "project" && setProjectOpen(next)}
        title={t("exportProjectTitle")}
        description={t("exportProjectDescription")}
        width="max-w-2xl"
      >
        <div className="p-5">
          <ProjectTransferSelectionList
            value={selection}
            onChange={setSelection}
            disabled={downloading === "project"}
          />
        </div>
        <div className="flex justify-end gap-2 border-zinc-100 border-t p-3">
          <Button
            variant="secondary"
            disabled={downloading === "project"}
            onClick={() => setProjectOpen(false)}
          >
            {t("cancelDownload")}
          </Button>
          <Button
            loading={downloading === "project"}
            disabled={!hasProjectTransferSelection(selection)}
            onClick={() => void downloadProject()}
          >
            <Download className="size-4" />
            {t("exportProject")}
          </Button>
        </div>
      </Modal>
      <Modal
        open={textOpen}
        onOpenChange={(next) => downloading !== "text" && setTextOpen(next)}
        title={t("exportTextTitle")}
        description={t("exportTextDescription")}
        width="max-w-sm"
      >
        <div className="space-y-2 p-5" role="radiogroup" aria-label={t("downloadFormat")}>
          {(["markdown", "txt"] as const).map((option) => {
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={textFormat === option}
                disabled={!hasManuscript || downloading === "text"}
                onClick={() => setTextFormat(option)}
                className={cn(
                  "focus-ring flex w-full items-center gap-3 rounded-xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-45",
                  textFormat === option
                    ? "border-zinc-950 bg-zinc-50 ring-1 ring-zinc-950"
                    : "border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50",
                )}
              >
                <span
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-lg",
                    textFormat === option ? "bg-zinc-950 text-white" : "bg-zinc-100 text-zinc-500",
                  )}
                >
                  <FileText className="size-4" />
                </span>
                <span>
                  <span className="block font-medium text-sm text-zinc-900">
                    {t(option === "markdown" ? "formatMarkdown" : "formatText")}
                  </span>
                  <span className="mt-0.5 block text-xs text-zinc-400">
                    {t(hasManuscript ? "formatManuscriptDescription" : "formatManuscriptEmpty", {
                      extension: option === "markdown" ? "md" : "txt",
                    })}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex justify-end gap-2 border-zinc-100 border-t p-3">
          <Button
            variant="secondary"
            disabled={downloading === "text"}
            onClick={() => setTextOpen(false)}
          >
            {t("cancelDownload")}
          </Button>
          <Button
            loading={downloading === "text"}
            disabled={!hasManuscript}
            onClick={() => void downloadText()}
          >
            <Download className="size-4" />
            {t("exportText")}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function safeFileName(value: string) {
  return (
    value
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
      .replace(/[. ]+$/g, "")
      .slice(0, 160) || "project"
  );
}
