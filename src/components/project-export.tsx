"use client";

import { Database, Download, FileText } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button, Modal } from "@/components/ui";
import { cn } from "@/lib/utils";

type ProjectExportFormat = "project" | "markdown" | "txt";

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
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<ProjectExportFormat>("project");
  const [downloading, setDownloading] = useState(false);

  const showDialog = () => {
    setFormat("project");
    setOpen(true);
  };

  const downloadExport = async () => {
    if (format !== "project" && !hasManuscript) return;
    setDownloading(true);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/export?format=${encodeURIComponent(format)}`,
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Request failed (${response.status})`);
      }
      const extension =
        format === "project" ? "project.json" : format === "markdown" ? "md" : "txt";
      const blob =
        format === "project"
          ? new Blob([JSON.stringify(await response.json(), null, 2)], {
              type: "application/json;charset=utf-8",
            })
          : await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${safeFileName(projectName)}.${extension}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setOpen(false);
      toast.success(t("exportSuccess"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("exportFailed"));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
      <Button variant="secondary" onClick={showDialog}>
        <Download className="size-4" />
        {t("exportProject")}
      </Button>
      <Modal
        open={open}
        onOpenChange={(next) => !downloading && setOpen(next)}
        title={t("exportProjectTitle")}
        description={t("exportProjectDescription")}
        width="max-w-sm"
      >
        <div className="space-y-2 p-5" role="radiogroup" aria-label={t("downloadFormat")}>
          {(["project", "markdown", "txt"] as const).map((option) => {
            const disabled = option !== "project" && !hasManuscript;
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={format === option}
                disabled={disabled}
                onClick={() => !disabled && setFormat(option)}
                className={cn(
                  "focus-ring flex w-full items-center gap-3 rounded-xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-45",
                  format === option
                    ? "border-zinc-950 bg-zinc-50 ring-1 ring-zinc-950"
                    : "border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50",
                )}
              >
                <span
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-lg",
                    format === option ? "bg-zinc-950 text-white" : "bg-zinc-100 text-zinc-500",
                  )}
                >
                  {option === "project" ? (
                    <Database className="size-4" />
                  ) : (
                    <FileText className="size-4" />
                  )}
                </span>
                <span>
                  <span className="block font-medium text-sm text-zinc-900">
                    {t(
                      option === "project"
                        ? "formatProject"
                        : option === "markdown"
                          ? "formatMarkdown"
                          : "formatText",
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs text-zinc-400">
                    {t(
                      option === "project"
                        ? "formatProjectDescription"
                        : hasManuscript
                          ? "formatManuscriptDescription"
                          : "formatManuscriptEmpty",
                      option === "project"
                        ? undefined
                        : { extension: option === "markdown" ? "md" : "txt" },
                    )}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex justify-end gap-2 border-zinc-100 border-t p-3">
          <Button variant="secondary" disabled={downloading} onClick={() => setOpen(false)}>
            {t("cancelDownload")}
          </Button>
          <Button loading={downloading} onClick={() => void downloadExport()}>
            <Download className="size-4" />
            {t("exportProject")}
          </Button>
        </div>
      </Modal>
    </>
  );
}

function safeFileName(value: string) {
  return (
    value
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
      .replace(/[. ]+$/g, "")
      .slice(0, 160) || "project"
  );
}
