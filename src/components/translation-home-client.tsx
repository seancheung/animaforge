"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, FileText, Languages, LockKeyhole, Plus, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { HomeSidebar } from "@/components/home-sidebar";
import { Button, ConfirmDialog, Input, Label, Modal } from "@/components/ui";
import { api } from "@/lib/client";
import type { TranslationProjectDetail, TranslationProjectSummary } from "@/lib/types";
import { formatDate } from "@/lib/utils";

export function TranslationHomeClient() {
  const t = useTranslations("TranslationHome");
  const common = useTranslations("Common");
  const locale = useLocale();
  const router = useRouter();
  const client = useQueryClient();
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TranslationProjectSummary | null>(null);
  const [name, setName] = useState("");
  const [sourceLanguage, setSourceLanguage] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const projects = useQuery({
    queryKey: ["translation-projects"],
    queryFn: () => api<TranslationProjectSummary[]>("/api/translations"),
    refetchInterval: (query) =>
      query.state.data?.some((project) => project.activeJobCount > 0) ? 2_000 : false,
  });
  const filtered = useMemo(
    () =>
      (projects.data ?? []).filter((project) =>
        `${project.name} ${project.sourceFileName} ${project.sourceLanguage}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [projects.data, query],
  );
  const create = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error(t("fileRequired"));
      const form = new FormData();
      form.set("file", file);
      form.set("name", name);
      form.set("sourceLanguage", sourceLanguage);
      const response = await fetch("/api/translations", { method: "POST", body: form });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || t("createFailed"));
      return body as TranslationProjectDetail;
    },
    onSuccess: (project) => {
      void client.invalidateQueries({ queryKey: ["translation-projects"] });
      setCreateOpen(false);
      setName("");
      setSourceLanguage("");
      setFile(null);
      router.push(`/translations/${project.id}`);
    },
    onError: (error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/translations/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["translation-projects"] });
      setDeleteTarget(null);
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <div className="flex min-h-screen bg-zinc-50">
      <HomeSidebar />
      <main className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-[1500px] px-5 py-8 lg:px-8">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
            <div>
              <p className="mb-1 font-medium text-xs text-zinc-400 uppercase tracking-[0.16em]">
                {t("workspace")}
              </p>
              <h1 className="font-semibold text-2xl tracking-tight">{t("title")}</h1>
              <p className="mt-2 text-sm text-zinc-500">{t("description")}</p>
            </div>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              {t("newProject")}
            </Button>
          </div>
          <div className="mt-7 flex items-center justify-between gap-3 border-zinc-200 border-y py-3">
            <div className="relative w-full max-w-sm">
              <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-zinc-400" />
              <Input
                className="pl-9"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("searchPlaceholder")}
              />
            </div>
            <span className="whitespace-nowrap text-xs text-zinc-400">
              {t("projectCount", { count: filtered.length })}
            </span>
          </div>
          {projects.isLoading ? (
            <div className="grid grid-cols-1 gap-4 pt-6 md:grid-cols-2 xl:grid-cols-3">
              {[1, 2, 3].map((item) => (
                <div
                  key={item}
                  className="h-56 animate-pulse rounded-xl border border-zinc-200 bg-white"
                />
              ))}
            </div>
          ) : null}
          {!projects.isLoading && !filtered.length ? (
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="mt-6 flex min-h-72 w-full flex-col items-center justify-center rounded-xl border border-zinc-300 border-dashed bg-white text-center transition hover:border-zinc-400 hover:bg-zinc-50"
            >
              <span className="mb-4 flex size-10 items-center justify-center rounded-xl border border-zinc-200">
                <Languages className="size-4" />
              </span>
              <span className="font-medium text-sm">{t("emptyTitle")}</span>
              <span className="mt-1 text-xs text-zinc-500">{t("emptyDescription")}</span>
            </button>
          ) : null}
          <div className="grid grid-cols-1 gap-4 pt-6 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((project) => (
              <article
                key={project.id}
                className="group relative flex min-h-56 cursor-pointer flex-col rounded-xl border border-zinc-200 bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,.03)] transition hover:border-zinc-300 hover:shadow-md"
              >
                <Link
                  href={`/translations/${project.id}`}
                  aria-label={`${t("open")}: ${project.name}`}
                  className="absolute inset-0 rounded-xl outline-none"
                />
                <div className="flex items-start justify-between">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-zinc-100 text-zinc-700">
                    <Languages className="size-4.5" />
                  </span>
                  <Button
                    className="relative z-10"
                    variant="ghost"
                    size="icon"
                    onClick={() => setDeleteTarget(project)}
                    aria-label={common("delete")}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
                <h2 className="mt-5 truncate font-semibold text-base">{project.name}</h2>
                <p className="mt-2 truncate text-sm text-zinc-500">{project.sourceFileName}</p>
                <p className="mt-1 flex-1 text-xs text-zinc-400">
                  {project.sourceLanguage || t("autoDetect")} ·{" "}
                  {t("characterCount", { count: project.sourceCharacterCount })}
                </p>
                <div className="mt-5 flex items-center justify-between border-zinc-100 border-t pt-4">
                  <div className="flex items-center gap-3 text-xs text-zinc-400">
                    <span className="flex items-center gap-1">
                      <FileText className="size-3.5" />
                      {project.blueprintCount}
                    </span>
                    {project.sourceLockedAt ? <LockKeyhole className="size-3.5" /> : null}
                    {project.activeJobCount ? (
                      <span className="flex items-center gap-1 text-amber-600">
                        <span className="streaming-dot size-1.5 rounded-full bg-amber-500" />
                        {t("running", { count: project.activeJobCount })}
                      </span>
                    ) : (
                      <span>{formatDate(project.updatedAt, locale, t("justNow"))}</span>
                    )}
                  </div>
                  <span className="flex items-center gap-1 font-medium text-xs">
                    {t("open")}
                    <ArrowUpRight className="size-3.5" />
                  </span>
                </div>
              </article>
            ))}
          </div>
        </div>
      </main>
      <Modal
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={t("createTitle")}
        description={t("createDescription")}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <div className="space-y-4 p-5">
            <div>
              <Label>{t("sourceFile")}</Label>
              <input
                type="file"
                accept=".txt,.md,.markdown,text/plain,text/markdown"
                required
                onChange={(event) => {
                  const next = event.target.files?.[0] ?? null;
                  setFile(next);
                  if (next && !name) setName(next.name.replace(/\.(?:txt|md|markdown)$/i, ""));
                }}
                className="mt-1.5 block w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-zinc-100 file:px-3 file:py-1.5 file:font-medium file:text-xs"
              />
              <p className="mt-1.5 text-xs text-zinc-400">{t("fileHint")}</p>
            </div>
            <div>
              <Label>{t("name")}</Label>
              <Input required value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <div>
              <Label>{t("sourceLanguage")}</Label>
              <Input
                value={sourceLanguage}
                onChange={(event) => setSourceLanguage(event.target.value)}
                placeholder={t("sourceLanguagePlaceholder")}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 border-zinc-100 border-t p-3">
            <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>
              {common("cancel")}
            </Button>
            <Button type="submit" disabled={!file || !name.trim()} loading={create.isPending}>
              {t("create")}
            </Button>
          </div>
        </form>
      </Modal>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t("deleteTitle")}
        description={t("deleteDescription", { name: deleteTarget?.name ?? "" })}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget.id)}
        loading={remove.isPending}
      />
    </div>
  );
}
