"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, BookOpen, Plus, Search, Trash2, Upload, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { HomeSidebar } from "@/components/home-sidebar";
import { Button, ConfirmDialog, Input, Label, Modal, Textarea } from "@/components/ui";
import { api } from "@/lib/client";
import type { Project } from "@/lib/types";
import { formatDate } from "@/lib/utils";

interface ProjectImportCandidate {
  data: unknown;
  fileName: string;
  projectName: string;
  chapters: number;
  entities: number;
  blocks: number;
  chats: number;
  reviews: number;
  revisions: number;
}

interface ProjectImportResult {
  project: Project;
  summary: {
    chapters: number;
    entities: number;
    relations: number;
    blocks: number;
    chats: number;
    reviews: number;
    revisions: number;
  };
}

export function HomeClient() {
  const t = useTranslations("Home");
  const common = useTranslations("Common");
  const locale = useLocale();
  const client = useQueryClient();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [importCandidate, setImportCandidate] = useState<ProjectImportCandidate | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);
  const [deleteProject, setDeleteProject] = useState<Project | null>(null);
  const [form, setForm] = useState({ name: "", synopsis: "", proseStyle: "", language: "" });
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => api<Project[]>("/api/projects"),
  });
  const create = useMutation({
    mutationFn: () => api<Project>("/api/projects", { method: "POST", body: JSON.stringify(form) }),
    onSuccess: (project) => {
      client.invalidateQueries({ queryKey: ["projects"] });
      setCreateOpen(false);
      router.push(`/projects/${project.id}`);
    },
    onError: (error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/projects/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["projects"] });
      setDeleteProject(null);
    },
    onError: (error) => toast.error(error.message),
  });
  const importProject = useMutation({
    mutationFn: (candidate: ProjectImportCandidate) =>
      api<ProjectImportResult>("/api/projects/import", {
        method: "POST",
        body: JSON.stringify(candidate.data),
      }),
    onSuccess: (result) => {
      client.invalidateQueries({ queryKey: ["projects"] });
      setImportCandidate(null);
      if (importFileRef.current) importFileRef.current.value = "";
      toast.success(
        t("importSuccess", {
          chapters: result.summary.chapters,
          entities: result.summary.entities,
        }),
      );
      router.push(`/projects/${result.project.id}`);
    },
    onError: (error) => toast.error(error.message),
  });

  const selectProjectImport = async (file: File) => {
    if (file.size > 50_000_000) {
      toast.error(t("importTooLarge"));
      if (importFileRef.current) importFileRef.current.value = "";
      return;
    }
    try {
      const data = JSON.parse(await file.text()) as Record<string, unknown>;
      const project = data.project as Record<string, unknown> | undefined;
      if (
        data.kind !== "anima-forge-project" ||
        data.version !== 1 ||
        !project ||
        typeof project.name !== "string"
      ) {
        throw new Error("invalid");
      }
      const chapters = Array.isArray(project.chapters) ? project.chapters : [];
      const entities = Array.isArray(project.entities) ? project.entities : [];
      const chats = Array.isArray(project.chats) ? project.chats : [];
      const reviews = Array.isArray(project.completedReviews) ? project.completedReviews : [];
      const revisions = Array.isArray(project.completedRevisions) ? project.completedRevisions : [];
      const blocks = chapters.reduce(
        (count, chapter) =>
          count +
          (typeof chapter === "object" &&
          chapter !== null &&
          Array.isArray((chapter as { blocks?: unknown }).blocks)
            ? (chapter as { blocks: unknown[] }).blocks.length
            : 0),
        0,
      );
      setImportCandidate({
        data,
        fileName: file.name,
        projectName: project.name,
        chapters: chapters.length,
        entities: entities.length,
        blocks,
        chats: chats.length,
        reviews: reviews.length,
        revisions: revisions.length,
      });
    } catch {
      toast.error(t("invalidImportFile"));
      if (importFileRef.current) importFileRef.current.value = "";
    }
  };
  const filtered = useMemo(
    () =>
      (projects.data ?? []).filter((project) =>
        `${project.name} ${project.synopsis}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [projects.data, query],
  );

  return (
    <div className="flex min-h-screen bg-zinc-50">
      <HomeSidebar />
      <div className="min-w-0 flex-1">
        <main className="mx-auto w-full max-w-[1500px] px-5 py-8 lg:px-8">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
            <div>
              <p className="mb-1 font-medium text-xs text-zinc-400 uppercase tracking-[0.16em]">
                {t("workspace")}
              </p>
              <h1 className="font-semibold text-2xl text-zinc-950 tracking-tight">{t("title")}</h1>
              <p className="mt-2 text-sm text-zinc-500">{t("description")}</p>
            </div>
            <div className="flex items-center gap-2">
              <input
                ref={importFileRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void selectProjectImport(file);
                }}
              />
              <Button variant="secondary" onClick={() => importFileRef.current?.click()}>
                <Upload className="size-4" />
                {t("importProject")}
              </Button>
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" />
                {t("newProject")}
              </Button>
            </div>
          </div>
          <div className="mt-7 flex items-center justify-between gap-3 border-zinc-200 border-y py-3">
            <div className="relative w-full max-w-sm">
              <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-zinc-400" />
              <Input
                className="pl-9"
                placeholder={t("searchPlaceholder")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
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
              onClick={() => setCreateOpen(true)}
              className="mt-6 flex min-h-72 w-full flex-col items-center justify-center rounded-xl border border-zinc-300 border-dashed bg-white text-center transition hover:border-zinc-400 hover:bg-zinc-50"
            >
              <span className="mb-4 flex size-10 items-center justify-center rounded-xl border border-zinc-200 bg-white shadow-sm">
                <Plus className="size-4" />
              </span>
              <span className="font-medium text-sm">{t("emptyTitle")}</span>
              <span className="mt-1 text-xs text-zinc-500">{t("emptyDescription")}</span>
            </button>
          ) : null}
          <div className="grid grid-cols-1 gap-4 pt-6 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((project) => (
              <article
                key={project.id}
                className="group relative flex min-h-56 cursor-pointer flex-col rounded-xl border border-zinc-200 bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,.03)] transition focus-within:border-zinc-400 focus-within:ring-4 focus-within:ring-zinc-950/5 hover:border-zinc-300 hover:shadow-md"
              >
                <Link
                  href={`/projects/${project.id}`}
                  aria-label={`${t("open")}: ${project.name}`}
                  className="absolute inset-0 rounded-xl outline-none"
                />
                <div className="flex items-start justify-between gap-4">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-zinc-100 text-zinc-700">
                    <BookOpen className="size-4.5" />
                  </div>
                  <Button
                    className="relative z-10"
                    variant="ghost"
                    size="icon"
                    onClick={() => setDeleteProject(project)}
                    aria-label={t("deleteProject")}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
                <h2 className="mt-5 truncate font-semibold text-base text-zinc-950">
                  {project.name}
                </h2>
                <p className="mt-2 line-clamp-3 flex-1 text-sm text-zinc-500 leading-6">
                  {project.synopsis || t("noSynopsis")}
                </p>
                <div className="mt-5 flex items-center justify-between border-zinc-100 border-t pt-4">
                  <div className="flex items-center gap-3 text-xs text-zinc-400">
                    <span className="flex items-center gap-1">
                      <BookOpen className="size-3.5" />
                      {project.chapterCount ?? 0}
                    </span>
                    <span className="flex items-center gap-1">
                      <Users className="size-3.5" />
                      {project.entityCount ?? 0}
                    </span>
                    <span>{formatDate(project.updatedAt, locale, t("justNow"))}</span>
                  </div>
                  <span className="flex items-center gap-1 font-medium text-xs text-zinc-700 transition group-hover:text-zinc-950">
                    {t("open")}
                    <ArrowUpRight className="size-3.5" />
                  </span>
                </div>
              </article>
            ))}
          </div>
        </main>
      </div>
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
          <div className="space-y-4 px-5 py-5">
            <div>
              <Label>{t("projectName")}</Label>
              <Input
                autoFocus
                required
                placeholder={t("projectNamePlaceholder")}
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </div>
            <div>
              <Label>{t("synopsis")}</Label>
              <Textarea
                placeholder={t("synopsisPlaceholder")}
                value={form.synopsis}
                onChange={(event) => setForm({ ...form, synopsis: event.target.value })}
              />
            </div>
            <div>
              <Label>{t("proseStyle")}</Label>
              <Textarea
                className="min-h-20"
                placeholder={t("proseStylePlaceholder")}
                value={form.proseStyle}
                onChange={(event) => setForm({ ...form, proseStyle: event.target.value })}
              />
            </div>
            <div>
              <Label>{t("outputLanguageOptional")}</Label>
              <Input
                value={form.language}
                onChange={(event) => setForm({ ...form, language: event.target.value })}
                placeholder={t("outputLanguagePlaceholder")}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 border-zinc-100 border-t px-5 py-3">
            <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>
              {common("cancel")}
            </Button>
            <Button type="submit" loading={create.isPending}>
              {t("createProject")}
            </Button>
          </div>
        </form>
      </Modal>
      <Modal
        open={Boolean(importCandidate)}
        onOpenChange={(open) => {
          if (!open && !importProject.isPending) {
            setImportCandidate(null);
            if (importFileRef.current) importFileRef.current.value = "";
          }
        }}
        title={t("confirmImportTitle")}
        description={t("confirmImportDescription")}
        width="max-w-md"
      >
        <div className="space-y-3 p-5">
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
            <p className="truncate font-semibold text-sm text-zinc-900">
              {importCandidate?.projectName}
            </p>
            <p className="mt-1 truncate text-[11px] text-zinc-400">{importCandidate?.fileName}</p>
            <p className="mt-3 text-xs text-zinc-500 leading-5">
              {t("importSummary", {
                chapters: importCandidate?.chapters ?? 0,
                entities: importCandidate?.entities ?? 0,
                blocks: importCandidate?.blocks ?? 0,
                chats: importCandidate?.chats ?? 0,
                reviews: importCandidate?.reviews ?? 0,
                revisions: importCandidate?.revisions ?? 0,
              })}
            </p>
          </div>
          <p className="text-xs text-zinc-500 leading-5">{t("importCreatesCopy")}</p>
        </div>
        <div className="flex justify-end gap-2 border-zinc-100 border-t p-3">
          <Button
            variant="secondary"
            disabled={importProject.isPending}
            onClick={() => {
              setImportCandidate(null);
              if (importFileRef.current) importFileRef.current.value = "";
            }}
          >
            {common("cancel")}
          </Button>
          <Button
            loading={importProject.isPending}
            onClick={() => importCandidate && importProject.mutate(importCandidate)}
          >
            <Upload className="size-4" />
            {t("confirmImport")}
          </Button>
        </div>
      </Modal>
      <ConfirmDialog
        open={Boolean(deleteProject)}
        onOpenChange={(open) => !open && setDeleteProject(null)}
        title={t("deleteTitle")}
        description={t("deleteDescription", { name: deleteProject?.name ?? "" })}
        onConfirm={() => deleteProject && remove.mutate(deleteProject.id)}
        loading={remove.isPending}
      />
    </div>
  );
}
