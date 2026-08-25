"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChartNoAxesColumnIncreasing,
  Coins,
  Copy,
  Database,
  Download,
  Feather,
  FileCheck2,
  FileSearch,
  FileText,
  Hash,
  Languages,
  NotebookTabs,
  PanelLeft,
  Pause,
  Play,
  Save,
  Settings2,
  Sparkles,
  Square,
  Trash2,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { type ReactNode, useMemo, useState } from "react";
import { toast } from "sonner";
import { MarkdownContent } from "@/components/markdown-content";
import { useSettingsDialog } from "@/components/settings-dialog-provider";
import {
  Button,
  ConfirmDialog,
  Input,
  Label,
  Modal,
  Select,
  type StepItem,
  Steps,
  Textarea,
  Tooltip,
} from "@/components/ui";
import { api } from "@/lib/client";
import { alignParagraphs, splitParagraphs } from "@/lib/paragraph-alignment";
import { buildLineDiff } from "@/lib/text-diff";
import type {
  AppSettings,
  LlmService,
  TaskType,
  TranslationBlueprint,
  TranslationOutput,
  TranslationProjectDetail,
  TranslationStage,
  TranslationStageConfig,
  UsageReport,
} from "@/lib/types";
import { cn, formatCompactNumber, formatDollarAmount } from "@/lib/utils";

interface SettingsPayload {
  settings: AppSettings;
  services: LlmService[];
}
type View = "insights" | "source" | "blueprint" | TranslationStage;
type BlueprintForm = {
  name: string;
  targetLanguage: string;
  instructions: string;
  generationModelId: string;
  stageConfig: TranslationStageConfig[];
};

const stages: TranslationStage[] = ["draft", "proofread", "fidelity", "polish"];
const taskForStage = {
  draft: "translationDraft",
  proofread: "translationProofread",
  fidelity: "translationFidelity",
  polish: "translationPolish",
} as const;

function defaultStageConfig(settings?: AppSettings): TranslationStageConfig[] {
  return stages.map((stage) => ({
    stage,
    enabled: true,
    modelId: settings?.taskModels[taskForStage[stage]] || settings?.globalDefaultModel || null,
  }));
}

export function TranslationProjectClient({ projectId }: { projectId: string }) {
  const t = useTranslations("Translation");
  const errors = useTranslations("Errors");
  const common = useTranslations("Common");
  const client = useQueryClient();
  const project = useQuery({
    queryKey: ["translation-project", projectId],
    queryFn: () => api<TranslationProjectDetail>(`/api/translations/${projectId}`),
    refetchInterval: (query) =>
      query.state.data?.blueprints.some(
        (blueprint) => blueprint.job?.status === "queued" || blueprint.job?.status === "running",
      )
        ? 1_500
        : false,
  });
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<SettingsPayload>("/api/settings"),
  });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [view, setView] = useState<View>("insights");
  const source = useQuery({
    queryKey: ["translation-source", projectId],
    queryFn: () => api<{ content: string }>(`/api/translations/${projectId}/source`),
    enabled: view === "source",
    staleTime: Infinity,
  });
  const [blueprintMode, setBlueprintMode] = useState<"preview" | "edit">("preview");
  const [createOpen, setCreateOpen] = useState(false);
  const [configureOpen, setConfigureOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TranslationBlueprint | null>(null);
  const [cancelTarget, setCancelTarget] = useState<TranslationBlueprint | null>(null);
  const [form, setForm] = useState<BlueprintForm>({
    name: "",
    targetLanguage: "",
    instructions: "",
    generationModelId: "",
    stageConfig: defaultStageConfig(),
  });
  const [contentEdits, setContentEdits] = useState<Record<string, string>>({});
  const active =
    project.data?.blueprints.find((blueprint) => blueprint.id === activeId) ??
    project.data?.blueprints[0] ??
    null;
  const contentDraft = active ? (contentEdits[active.id] ?? active.content) : "";
  const modelOptions = useMemo(
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
  const output = useQuery({
    queryKey: ["translation-output", active?.id, view],
    queryFn: () =>
      api<TranslationOutput>(`/api/translation-blueprints/${active!.id}/outputs/${view}`),
    enabled: Boolean(
      active &&
        stages.includes(view as TranslationStage) &&
        active.availableStages.includes(view as TranslationStage),
    ),
    refetchInterval:
      active?.job?.status === "running" || active?.job?.status === "queued" ? 1_500 : false,
  });

  const refresh = async (blueprint?: TranslationBlueprint) => {
    if (blueprint) setActiveId(blueprint.id);
    await Promise.all([
      client.invalidateQueries({ queryKey: ["translation-project", projectId] }),
      client.invalidateQueries({ queryKey: ["translation-projects"] }),
      client.invalidateQueries({ queryKey: ["translation-output", blueprint?.id ?? active?.id] }),
    ]);
  };
  const openCreate = () => {
    const ordinal = (project.data?.blueprints.length ?? 0) + 1;
    setForm({
      name: t("defaultBlueprintName", { ordinal }),
      targetLanguage: "",
      instructions: "",
      generationModelId:
        settings.data?.settings.taskModels.translationBlueprint ||
        settings.data?.settings.globalDefaultModel ||
        "",
      stageConfig: defaultStageConfig(settings.data?.settings),
    });
    setCreateOpen(true);
  };
  const openConfigure = () => {
    if (!active) return;
    setForm({
      name: active.name,
      targetLanguage: active.targetLanguage,
      instructions: active.instructions,
      generationModelId: active.generationModelId ?? "",
      stageConfig: active.stageConfig,
    });
    setConfigureOpen(true);
  };

  const create = useMutation({
    mutationFn: () =>
      api<TranslationBlueprint>(`/api/translations/${projectId}/blueprints`, {
        method: "POST",
        body: JSON.stringify({ ...form, generationModelId: form.generationModelId || null }),
      }),
    onSuccess: async (blueprint) => {
      setCreateOpen(false);
      setView("insights");
      await refresh(blueprint);
    },
    onError: (error) => toast.error(error.message),
  });
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<TranslationBlueprint>(`/api/translation-blueprints/${active!.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: async (blueprint) => {
      setConfigureOpen(false);
      setContentEdits((current) => {
        const next = { ...current };
        delete next[blueprint.id];
        return next;
      });
      toast.success(t("saved"));
      await refresh(blueprint);
    },
    onError: (error) => toast.error(error.message),
  });
  const clone = useMutation({
    mutationFn: () =>
      api<TranslationBlueprint>(`/api/translation-blueprints/${active!.id}/clone`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: async (blueprint) => {
      toast.success(t("cloned"));
      await refresh(blueprint);
    },
    onError: (error) => toast.error(error.message),
  });
  const execute = useMutation({
    mutationFn: () =>
      api<TranslationBlueprint>(`/api/translation-blueprints/${active!.id}/execute`, {
        method: "POST",
      }),
    onSuccess: async (blueprint) => {
      setView("insights");
      await refresh(blueprint);
    },
    onError: (error) => toast.error(error.message),
  });
  const control = useMutation({
    mutationFn: (action: "pause" | "resume" | "cancel") =>
      api<TranslationBlueprint>(`/api/translation-blueprints/${active!.id}/control`, {
        method: "POST",
        body: JSON.stringify({ action }),
      }),
    onSuccess: async (blueprint, action) => {
      if (action === "cancel") setCancelTarget(null);
      await refresh(blueprint);
    },
    onError: (error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: () => api(`/api/translation-blueprints/${deleteTarget!.id}`, { method: "DELETE" }),
    onSuccess: async () => {
      setDeleteTarget(null);
      setActiveId(null);
      await refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  if (project.isLoading)
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-50 text-sm text-zinc-400">
        {common("loading")}
      </div>
    );
  if (!project.data)
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-50 text-sm text-zinc-500">
        {t("notFound")}
      </div>
    );
  const data = project.data;
  const isActiveJob = active?.job?.status === "queued" || active?.job?.status === "running";
  const isResumable = active?.job?.status === "paused" || active?.job?.status === "failed";
  const editable = Boolean(
    active &&
      !active.lockedAt &&
      (!active.job || active.job.status === "completed" || active.job.status === "cancelled"),
  );
  const stageView = stages.includes(view as TranslationStage) ? (view as TranslationStage) : null;
  const taskActions = active ? (
    <>
      {isActiveJob ? (
        <Button size="sm" variant="secondary" onClick={() => control.mutate("pause")}>
          <Pause className="size-3.5" />
          {t("pause")}
        </Button>
      ) : null}
      {isResumable ? (
        <Button size="sm" onClick={() => control.mutate("resume")}>
          <Play className="size-3.5" />
          {t("resume")}
        </Button>
      ) : null}
      {active.job && !["completed", "cancelled"].includes(active.job.status) ? (
        <Button size="sm" variant="danger" onClick={() => setCancelTarget(active)}>
          <Square className="size-3.5" />
          {t("terminate")}
        </Button>
      ) : null}
    </>
  ) : null;
  const blueprintActions = active ? (
    <>
      {editable ? (
        <Button size="sm" variant="secondary" onClick={openConfigure}>
          <Settings2 className="size-3.5" />
          {t("configure")}
        </Button>
      ) : null}
      {active.content.trim() ? (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => clone.mutate()}
          loading={clone.isPending}
        >
          <Copy className="size-3.5" />
          {t("clone")}
        </Button>
      ) : null}
      {editable ? (
        <Button
          size="sm"
          onClick={() => execute.mutate()}
          loading={execute.isPending}
          disabled={!active.content.trim()}
        >
          <Play className="size-3.5" />
          {t("start")}
        </Button>
      ) : null}
      {!active.lockedAt && !isActiveJob ? (
        <Button size="icon" variant="ghost" onClick={() => setDeleteTarget(active)}>
          <Trash2 className="size-4" />
        </Button>
      ) : null}
    </>
  ) : null;

  const workspace =
    view === "source" ? (
      <SourceWorkspace
        project={data}
        content={source.data?.content}
        loading={source.isLoading}
        error={source.error?.message}
        t={t}
      />
    ) : !active ? (
      <WorkspaceEmpty
        title={t(`nav.${view}`)}
        emptyTitle={t("selectBlueprint")}
        emptyDescription={t("selectBlueprintDescription")}
      />
    ) : view === "insights" ? (
      <InsightsWorkspace
        project={data}
        blueprint={active}
        actions={taskActions}
        t={t}
        errors={errors}
      />
    ) : view === "blueprint" ? (
      <BlueprintWorkspace
        blueprint={active}
        editable={editable}
        mode={blueprintMode}
        content={contentDraft}
        actions={blueprintActions}
        saving={save.isPending}
        onModeChange={setBlueprintMode}
        onContentChange={(content) =>
          setContentEdits((current) => ({ ...current, [active.id]: content }))
        }
        onSave={() => save.mutate({ content: contentDraft })}
        t={t}
        common={common}
      />
    ) : stageView ? (
      <StageWorkspace
        key={`${active.id}-${stageView}`}
        blueprint={active}
        stage={stageView}
        output={output.data}
        loading={output.isLoading}
        t={t}
      />
    ) : null;

  return (
    <div className="flex h-screen min-h-0 bg-zinc-50">
      <TranslationSidebar
        project={data}
        active={active}
        view={view}
        onViewChange={setView}
        onBlueprintChange={(id) => {
          setActiveId(id);
          setView("insights");
          setBlueprintMode("preview");
        }}
        onCreateBlueprint={openCreate}
      />
      <main className="min-w-0 flex-1 bg-white">{workspace}</main>

      <Modal
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={t("createBlueprintTitle")}
        description={t("createBlueprintDescription")}
        width="max-w-3xl"
        scrollable={false}
      >
        <BlueprintFormFields form={form} setForm={setForm} models={modelOptions} t={t} />
        <div className="flex shrink-0 justify-end gap-2 border-zinc-100 border-t p-3">
          <Button variant="secondary" onClick={() => setCreateOpen(false)}>
            {common("cancel")}
          </Button>
          <Button
            disabled={!form.targetLanguage.trim() || !form.generationModelId}
            onClick={() => create.mutate()}
            loading={create.isPending}
          >
            {t("generateBlueprint")}
          </Button>
        </div>
      </Modal>
      <Modal
        open={configureOpen}
        onOpenChange={setConfigureOpen}
        title={t("configureBlueprint")}
        width="max-w-3xl"
        scrollable={false}
      >
        <BlueprintFormFields form={form} setForm={setForm} models={modelOptions} t={t} />
        <div className="flex shrink-0 justify-end gap-2 border-zinc-100 border-t p-3">
          <Button variant="secondary" onClick={() => setConfigureOpen(false)}>
            {common("cancel")}
          </Button>
          <Button
            onClick={() =>
              save.mutate({ ...form, generationModelId: form.generationModelId || null })
            }
            loading={save.isPending}
          >
            {common("save")}
          </Button>
        </div>
      </Modal>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t("deleteBlueprintTitle")}
        description={t("deleteBlueprintDescription", { name: deleteTarget?.name ?? "" })}
        onConfirm={() => remove.mutate()}
        loading={remove.isPending}
      />
      <ConfirmDialog
        open={Boolean(cancelTarget)}
        onOpenChange={(open) => !open && setCancelTarget(null)}
        title={t("terminateTitle")}
        description={t("terminateDescription")}
        onConfirm={() => control.mutate("cancel")}
        loading={control.isPending}
      />
    </div>
  );
}

function TranslationSidebar({
  project,
  active,
  view,
  onViewChange,
  onBlueprintChange,
  onCreateBlueprint,
}: {
  project: TranslationProjectDetail;
  active: TranslationBlueprint | null;
  view: View;
  onViewChange: (view: View) => void;
  onBlueprintChange: (id: string) => void;
  onCreateBlueprint: () => void;
}) {
  const t = useTranslations("Translation");
  const [collapsed, setCollapsed] = useState(false);
  const { openSettings } = useSettingsDialog();
  const enabledStages = new Set(
    active?.stageConfig.filter((item) => item.enabled).map((item) => item.stage) ?? [],
  );
  const menus: { view: View; label: string; icon: ReactNode }[] = [
    {
      view: "insights",
      label: t("nav.insights"),
      icon: <ChartNoAxesColumnIncreasing className="size-4" />,
    },
    { view: "blueprint", label: t("nav.blueprint"), icon: <NotebookTabs className="size-4" /> },
    { view: "source", label: t("nav.source"), icon: <FileText className="size-4" /> },
    ...(active
      ? [{ view: "draft" as View, label: t("nav.draft"), icon: <Languages className="size-4" /> }]
      : []),
    ...(active && enabledStages.has("proofread")
      ? [
          {
            view: "proofread" as View,
            label: t("nav.proofread"),
            icon: <FileCheck2 className="size-4" />,
          },
        ]
      : []),
    ...(active && enabledStages.has("fidelity")
      ? [
          {
            view: "fidelity" as View,
            label: t("nav.fidelity"),
            icon: <FileSearch className="size-4" />,
          },
        ]
      : []),
    ...(active && enabledStages.has("polish")
      ? [{ view: "polish" as View, label: t("nav.polish"), icon: <Sparkles className="size-4" /> }]
      : []),
  ];
  const options = project.blueprints.map((blueprint) => ({
    value: blueprint.id,
    label: blueprint.name,
    description: `${blueprint.targetLanguage} · ${t(`status.${blueprint.status}`)}`,
  }));

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
              href="/translations"
              aria-label={t("backToTranslations")}
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
      {!collapsed ? (
        <div className="shrink-0 border-zinc-100 border-b p-2.5">
          <Select
            value={active?.id ?? ""}
            onChange={onBlueprintChange}
            options={options}
            placeholder={t("selectBlueprintPlaceholder")}
            action={{ label: t("addBlueprint"), onSelect: onCreateBlueprint }}
          />
        </div>
      ) : null}
      <nav className="space-y-1 p-2.5">
        {menus.map((item) => (
          <TranslationSidebarButton
            key={item.view}
            collapsed={collapsed}
            active={view === item.view}
            label={item.label}
            onClick={() => onViewChange(item.view)}
          >
            {item.icon}
          </TranslationSidebarButton>
        ))}
      </nav>
      <div className="flex-1" />
      <div className="border-zinc-100 border-t p-2.5">
        <TranslationSidebarButton
          collapsed={collapsed}
          label={t("systemSettings")}
          onClick={openSettings}
        >
          <Settings2 className="size-4" />
        </TranslationSidebarButton>
      </div>
    </motion.aside>
  );
}

function TranslationSidebarButton({
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

function WorkspaceHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-zinc-200 border-b bg-white px-5">
      <div className="min-w-0">
        <h1 className="truncate font-semibold text-sm">{title}</h1>
        {description ? (
          <p className="mt-0.5 truncate text-[11px] text-zinc-400">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}

function WorkspaceEmpty({
  title,
  emptyTitle,
  emptyDescription,
}: {
  title: string;
  emptyTitle: string;
  emptyDescription: string;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-zinc-50">
      <WorkspaceHeader title={title} />
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <Empty title={emptyTitle} description={emptyDescription} />
      </div>
    </div>
  );
}

function InsightsWorkspace({
  project,
  blueprint,
  actions,
  t,
  errors,
}: {
  project: TranslationProjectDetail;
  blueprint: TranslationBlueprint;
  actions: ReactNode;
  t: ReturnType<typeof useTranslations<"Translation">>;
  errors: ReturnType<typeof useTranslations<"Errors">>;
}) {
  const locale = useLocale();
  const usage = useQuery({
    queryKey: ["usage", "translation", project.id, "all"],
    queryFn: () =>
      api<UsageReport>(
        `/api/usage?days=all&projectKind=translation&projectId=${encodeURIComponent(project.id)}`,
      ),
    refetchInterval:
      blueprint.job?.status === "queued" || blueprint.job?.status === "running" ? 1_500 : false,
  });
  const exact = new Intl.NumberFormat(locale);
  const formatCost = (value: number | null) =>
    value == null
      ? t("usageUnpriced")
      : value > 0 && value < 0.0001
        ? "< $0.0001"
        : formatDollarAmount(value, locale);
  const featureLabels: Partial<Record<TaskType, string>> = {
    translationBlueprint: t("nav.blueprint"),
    translationDraft: t("nav.draft"),
    translationProofread: t("nav.proofread"),
    translationFidelity: t("nav.fidelity"),
    translationPolish: t("nav.polish"),
  };
  const enabledStages = stages.filter(
    (stage) => blueprint.stageConfig.find((item) => item.stage === stage)?.enabled !== false,
  );
  const taskStatus = blueprint.job
    ? t(`job.${blueprint.job.status}`)
    : t(`status.${blueprint.status}`);
  const taskProgress = blueprint.job?.progressTotal
    ? t("taskProgressValue", {
        current: blueprint.job.progressCurrent,
        total: blueprint.job.progressTotal,
      })
    : t("noTaskProgress");
  const updatedAt = blueprint.job?.updatedAt ?? blueprint.updatedAt;
  const updatedLabel = Number.isNaN(new Date(updatedAt).getTime())
    ? "—"
    : new Date(updatedAt).toLocaleString();
  const direction = `${project.sourceLanguage || t("autoDetect")} → ${blueprint.targetLanguage}`;
  const stageNames = enabledStages.map((stage) => t(`nav.${stage}`)).join(" · ");

  return (
    <div className="flex h-full min-h-0 flex-col bg-zinc-50">
      <WorkspaceHeader
        title={t("nav.insights")}
        description={t("activeBlueprintMeta", {
          name: blueprint.name,
          target: blueprint.targetLanguage,
        })}
        actions={actions}
      />
      <section className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-5 p-7">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <InsightStat
              icon={<FileText className="size-4" />}
              label={t("insightSourceFile")}
              value={project.sourceFileName}
              detail={t("sourceCharacters", { count: project.sourceCharacterCount })}
            />
            <InsightStat
              icon={<Languages className="size-4" />}
              label={t("insightDirection")}
              value={direction}
            />
            <InsightStat
              icon={<NotebookTabs className="size-4" />}
              label={t("insightStages")}
              value={t("stageCount", { count: enabledStages.length })}
              detail={stageNames}
            />
            <InsightStat
              icon={<ChartNoAxesColumnIncreasing className="size-4" />}
              label={t("insightUpdated")}
              value={updatedLabel}
            />
          </div>
          <section className="space-y-3">
            <div>
              <h2 className="font-semibold text-sm">{t("projectUsage")}</h2>
              <p className="mt-1 text-xs text-zinc-500">{t("projectUsageDescription")}</p>
            </div>
            {usage.isLoading ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <InsightStat
                    icon={<Database className="size-4" />}
                    label={t("usageInputTokens")}
                    value={formatCompactNumber(usage.data.totals.input + usage.data.totals.cached)}
                  />
                  <InsightStat
                    icon={<Sparkles className="size-4" />}
                    label={t("usageOutputTokens")}
                    value={formatCompactNumber(usage.data.totals.output)}
                  />
                  <InsightStat
                    icon={<Hash className="size-4" />}
                    label={t("usageCalls")}
                    value={exact.format(usage.data.totals.calls)}
                  />
                  <InsightStat
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
                <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
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
          <div className="rounded-xl border border-zinc-200 bg-white">
            <WorkflowOverview blueprint={blueprint} t={t} errors={errors} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-xl border border-zinc-200 bg-white p-5">
              <h2 className="font-semibold text-sm">{t("blueprintSummary")}</h2>
              <div className="mt-4 divide-y divide-zinc-100">
                <InsightRow label={t("blueprintName")} value={blueprint.name} />
                <InsightRow label={t("blueprintOrdinal")} value={String(blueprint.ordinal)} />
                <InsightRow label={t("targetLanguage")} value={blueprint.targetLanguage} />
                <InsightRow label={t("enabledStageNames")} value={stageNames} />
                {blueprint.executionWindowTokens ? (
                  <InsightRow
                    label={t("windowSize")}
                    value={t("effectiveWindowSize", {
                      count: Number((blueprint.executionWindowTokens / 1_000).toFixed(2)),
                    })}
                  />
                ) : null}
              </div>
              <div className="mt-4 rounded-lg bg-zinc-50 px-3 py-2.5">
                <p className="font-medium text-[11px] text-zinc-400">{t("instructions")}</p>
                <p className="mt-1 line-clamp-3 text-xs text-zinc-600 leading-5">
                  {blueprint.instructions.trim() || t("noInstructions")}
                </p>
              </div>
            </section>
            <section className="rounded-xl border border-zinc-200 bg-white p-5">
              <h2 className="font-semibold text-sm">{t("backgroundTask")}</h2>
              <div className="mt-4 divide-y divide-zinc-100">
                <InsightRow
                  label={t("taskType")}
                  value={blueprint.job ? t(`jobKind.${blueprint.job.kind}`) : t("noTaskYet")}
                />
                <InsightRow label={t("taskProgress")} value={taskProgress} />
                <InsightRow label={t("taskStatusLabel")} value={taskStatus} />
              </div>
              <p className="mt-4 rounded-lg bg-zinc-50 px-3 py-2.5 text-xs text-zinc-500 leading-5">
                {t("taskPersistentHint")}
              </p>
            </section>
          </div>
        </div>
      </section>
    </div>
  );
}

function InsightStat({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-zinc-200 bg-white p-4">
      <div className="flex items-center gap-2 text-zinc-400">
        <span className="flex size-7 items-center justify-center rounded-lg bg-zinc-100">
          {icon}
        </span>
        <span className="font-medium text-[11px]">{label}</span>
      </div>
      <p className="mt-3 truncate font-semibold text-sm text-zinc-900" title={value}>
        {value}
      </p>
      {detail ? (
        <p className="mt-1 truncate text-[11px] text-zinc-400" title={detail}>
          {detail}
        </p>
      ) : null}
    </div>
  );
}

function InsightRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-5 py-2.5 first:pt-0 last:pb-0">
      <span className="shrink-0 text-xs text-zinc-400">{label}</span>
      <span className="text-right font-medium text-xs text-zinc-700 leading-5">{value}</span>
    </div>
  );
}

function SourceWorkspace({
  project,
  content,
  loading,
  error,
  t,
}: {
  project: TranslationProjectDetail;
  content?: string;
  loading: boolean;
  error?: string;
  t: ReturnType<typeof useTranslations<"Translation">>;
}) {
  const prose = !loading && !error && Boolean(content);
  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <WorkspaceHeader
        title={t("nav.source")}
        description={`${project.sourceFileName} · ${t("sourceCharacters", { count: project.sourceCharacterCount })} · ${project.sourceLanguage || t("autoDetect")}`}
      />
      <section className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        {prose ? (
          <div className="mx-auto max-w-5xl space-y-5 px-8 py-8 font-mono text-sm text-zinc-800 leading-7">
            <IndentedParagraphs content={content ?? ""} />
          </div>
        ) : (
          <pre
            className={cn(
              "mx-auto max-w-5xl whitespace-pre-wrap break-words px-8 py-8 font-mono text-sm leading-7",
              error ? "text-red-600" : "text-zinc-800",
            )}
          >
            {loading ? t("loadingSource") : error || t("sourceEmpty")}
          </pre>
        )}
      </section>
    </div>
  );
}

function BlueprintWorkspace({
  blueprint,
  editable,
  mode,
  content,
  actions,
  saving,
  onModeChange,
  onContentChange,
  onSave,
  t,
  common,
}: {
  blueprint: TranslationBlueprint;
  editable: boolean;
  mode: "preview" | "edit";
  content: string;
  actions: ReactNode;
  saving: boolean;
  onModeChange: (mode: "preview" | "edit") => void;
  onContentChange: (content: string) => void;
  onSave: () => void;
  t: ReturnType<typeof useTranslations<"Translation">>;
  common: ReturnType<typeof useTranslations<"Common">>;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <WorkspaceHeader
        title={t("nav.blueprint")}
        description={t("activeBlueprintMeta", {
          name: blueprint.name,
          target: blueprint.targetLanguage,
        })}
        actions={actions}
      />
      <section className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        {blueprint.status === "queued" || blueprint.status === "generating" ? (
          <Empty title={t("generatingBlueprint")} description={t("backgroundHint")} />
        ) : (
          <div className="mx-auto max-w-5xl p-7">
            <div className="mb-5 flex items-center justify-between gap-4">
              <p className="text-xs text-zinc-400">
                {editable ? t("blueprintEditable") : t("blueprintLocked")}
              </p>
              <div className="flex items-center gap-2">
                <div className="flex rounded-lg bg-zinc-100 p-0.5">
                  <Button
                    size="sm"
                    variant={mode === "preview" ? "secondary" : "ghost"}
                    onClick={() => onModeChange("preview")}
                  >
                    {t("previewBlueprint")}
                  </Button>
                  {editable ? (
                    <Button
                      size="sm"
                      variant={mode === "edit" ? "secondary" : "ghost"}
                      onClick={() => onModeChange("edit")}
                    >
                      {t("editBlueprint")}
                    </Button>
                  ) : null}
                </div>
                {editable && mode === "edit" ? (
                  <Button size="sm" onClick={onSave} loading={saving}>
                    <Save className="size-3.5" />
                    {common("save")}
                  </Button>
                ) : null}
              </div>
            </div>
            {mode === "edit" && editable ? (
              <Textarea
                className="min-h-[calc(100vh-190px)] resize-y font-mono text-xs leading-6"
                value={content}
                onChange={(event) => onContentChange(event.target.value)}
              />
            ) : (
              <div className="rounded-xl border border-zinc-100 bg-white px-8 py-7">
                <MarkdownContent content={content} />
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function StageWorkspace({
  blueprint,
  stage,
  output,
  loading,
  t,
}: {
  blueprint: TranslationBlueprint;
  stage: TranslationStage;
  output?: TranslationOutput;
  loading: boolean;
  t: ReturnType<typeof useTranslations<"Translation">>;
}) {
  const [mode, setMode] = useState<"text" | "comparison" | "diff">("text");
  const enabledStages = stages.filter(
    (item) => blueprint.stageConfig.find((config) => config.stage === item)?.enabled !== false,
  );
  const stageIndex = enabledStages.indexOf(stage);
  const previousStage = stageIndex > 0 ? enabledStages[stageIndex - 1] : null;
  const source = useQuery({
    queryKey: ["translation-source", blueprint.projectId],
    queryFn: () => api<{ content: string }>(`/api/translations/${blueprint.projectId}/source`),
    enabled: stage === "draft" && mode === "comparison",
    staleTime: Infinity,
  });
  const previousOutput = useQuery({
    queryKey: ["translation-output", blueprint.id, previousStage],
    queryFn: () =>
      api<TranslationOutput>(
        `/api/translation-blueprints/${blueprint.id}/outputs/${previousStage}`,
      ),
    enabled: stage !== "draft" && mode === "diff" && Boolean(previousStage),
    staleTime: Infinity,
  });
  const currentContent = `${output?.content ?? ""}${output?.partialContent ?? ""}`;
  const beforeContent =
    stage === "draft"
      ? (source.data?.content ?? "")
      : `${previousOutput.data?.content ?? ""}${previousOutput.data?.partialContent ?? ""}`;
  const comparisonLoading = stage === "draft" ? source.isLoading : previousOutput.isLoading;
  const comparisonError = stage === "draft" ? source.error?.message : previousOutput.error?.message;
  const actions = (
    <>
      <div className="flex rounded-lg bg-zinc-100 p-0.5">
        <Button
          size="sm"
          variant={mode === "text" ? "secondary" : "ghost"}
          onClick={() => setMode("text")}
        >
          {t("textMode")}
        </Button>
        {stage === "draft" ? (
          <Button
            size="sm"
            variant={mode === "comparison" ? "secondary" : "ghost"}
            onClick={() => setMode("comparison")}
          >
            {t("comparisonMode")}
          </Button>
        ) : (
          <Button
            size="sm"
            variant={mode === "diff" ? "secondary" : "ghost"}
            onClick={() => setMode("diff")}
          >
            {t("diffMode")}
          </Button>
        )}
      </div>
      {output ? (
        <span className="text-[11px] text-zinc-400">
          {t("windowProgress", {
            current: output.completedWindowCount,
            total: output.totalWindowCount,
          })}
        </span>
      ) : null}
      {output?.content ? (
        <a href={`/api/translation-blueprints/${blueprint.id}/outputs/${stage}?download=1`}>
          <Button size="sm" variant="secondary">
            <Download className="size-3.5" />
            {t("download")}
          </Button>
        </a>
      ) : null}
    </>
  );
  const content =
    mode === "text" ? (
      <OutputView output={output} loading={loading} t={t} />
    ) : comparisonLoading ? (
      <ComparisonMessage message={t("loadingComparison")} />
    ) : comparisonError ? (
      <ComparisonMessage message={comparisonError} error />
    ) : stage === "draft" ? (
      <SideBySideComparison
        left={beforeContent}
        right={currentContent}
        leftLabel={t("nav.source")}
        rightLabel={t("nav.draft")}
        emptyLabel={t("noOutput")}
      />
    ) : (
      <UnifiedDiff
        before={beforeContent}
        after={currentContent}
        beforeLabel={previousStage ? t(`nav.${previousStage}`) : t("nav.draft")}
        afterLabel={t(`nav.${stage}`)}
        t={t}
      />
    );
  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <WorkspaceHeader
        title={t(`nav.${stage}`)}
        description={t("activeBlueprintMeta", {
          name: blueprint.name,
          target: blueprint.targetLanguage,
        })}
        actions={actions}
      />
      <section className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">{content}</section>
    </div>
  );
}

function ComparisonMessage({ message, error }: { message: string; error?: boolean }) {
  return (
    <div
      className={cn(
        "flex min-h-72 items-center justify-center px-8 text-sm",
        error ? "text-red-600" : "text-zinc-400",
      )}
    >
      {message}
    </div>
  );
}

function SideBySideComparison({
  left,
  right,
  leftLabel,
  rightLabel,
  emptyLabel,
}: {
  left: string;
  right: string;
  leftLabel: string;
  rightLabel: string;
  emptyLabel: string;
}) {
  const paragraphs = useMemo(() => alignParagraphs(left, right), [left, right]);
  if (!paragraphs.length) return <ComparisonMessage message={emptyLabel} />;
  return (
    <div className="min-w-[900px]">
      <div className="sticky top-0 z-10 grid grid-cols-2 border-zinc-200 border-b bg-white/95 backdrop-blur">
        <div className="border-zinc-200 border-r px-6 py-2.5 font-medium text-xs text-zinc-500">
          {leftLabel}
        </div>
        <div className="px-6 py-2.5 font-medium text-xs text-zinc-500">{rightLabel}</div>
      </div>
      <div>
        {paragraphs.map((paragraph, index) => (
          <div key={index} className="grid grid-cols-2">
            <div className="space-y-4 border-zinc-200 border-r bg-zinc-50/60 px-6 py-5 font-mono text-sm text-zinc-700 leading-7">
              <IndentedParagraphs content={paragraph.left} empty=" " />
            </div>
            <div className="space-y-4 px-6 py-5 font-mono text-sm text-zinc-800 leading-7">
              <IndentedParagraphs content={paragraph.right} empty=" " />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DiffLineText({ line }: { line: ReturnType<typeof buildLineDiff>[number] }) {
  if (!line.segments?.length) return line.text || " ";
  return line.segments.map((segment, index) => (
    <span
      key={`${segment.type}-${index}`}
      className={cn(
        segment.type === "removed" && "bg-red-200/90 text-red-950",
        segment.type === "added" && "bg-emerald-200/90 text-emerald-950",
      )}
    >
      {segment.text}
    </span>
  ));
}

function UnifiedDiff({
  before,
  after,
  beforeLabel,
  afterLabel,
  t,
}: {
  before: string;
  after: string;
  beforeLabel: string;
  afterLabel: string;
  t: ReturnType<typeof useTranslations<"Translation">>;
}) {
  const lines = useMemo(() => buildLineDiff(before, after), [after, before]);
  const hasChanges = lines.some((line) => line.type === "added" || line.type === "removed");
  if (!before && !after) return <ComparisonMessage message={t("noComparisonContent")} />;
  if (!hasChanges) return <ComparisonMessage message={t("noDifferences")} />;
  return (
    <div className="min-w-[760px] font-mono text-xs">
      <div className="sticky top-0 z-10 flex items-center gap-3 border-zinc-200 border-b bg-white/95 px-5 py-2.5 font-sans text-xs backdrop-blur">
        <span className="rounded-md bg-red-50 px-2 py-1 text-red-700">− {beforeLabel}</span>
        <span className="text-zinc-300">→</span>
        <span className="rounded-md bg-emerald-50 px-2 py-1 text-emerald-700">+ {afterLabel}</span>
      </div>
      <div className="py-3">
        {lines.map((line, index) =>
          line.type === "omitted" ? (
            <div
              key={`omitted-${index}`}
              className="border-zinc-100 border-y bg-zinc-50 px-5 py-1.5 text-center font-sans text-[11px] text-zinc-400"
            >
              {t("unchangedLines", { count: Number(line.text) })}
            </div>
          ) : (
            <div
              key={`${line.type}-${line.oldLine}-${line.newLine}-${index}`}
              className={cn(
                "grid min-h-6 grid-cols-[48px_48px_24px_minmax(0,1fr)] border-l-2",
                line.type === "added" && "border-emerald-500 bg-emerald-50/70",
                line.type === "removed" && "border-red-500 bg-red-50/70",
                line.type === "same" && "border-transparent",
              )}
            >
              <span className="select-none px-2 py-1 text-right text-zinc-300">
                {line.oldLine ?? ""}
              </span>
              <span className="select-none border-zinc-100 border-r px-2 py-1 text-right text-zinc-300">
                {line.newLine ?? ""}
              </span>
              <span
                className={cn(
                  "select-none py-1 text-center",
                  line.type === "added"
                    ? "text-emerald-700"
                    : line.type === "removed"
                      ? "text-red-700"
                      : "text-zinc-300",
                )}
              >
                {line.type === "added" ? "+" : line.type === "removed" ? "−" : " "}
              </span>
              <span className="whitespace-pre-wrap break-words py-1 pr-5 text-zinc-700 leading-5">
                <DiffLineText line={line} />
              </span>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

function WorkflowOverview({
  blueprint,
  t,
  errors,
}: {
  blueprint: TranslationBlueprint;
  t: ReturnType<typeof useTranslations<"Translation">>;
  errors: ReturnType<typeof useTranslations<"Errors">>;
}) {
  const enabledStages = stages.filter(
    (stage) => blueprint.stageConfig.find((item) => item.stage === stage)?.enabled !== false,
  );
  const completedStages = new Set(blueprint.completedStages);
  const executionStarted =
    blueprint.job?.kind === "translation_execution" ||
    Boolean(blueprint.lockedAt) ||
    blueprint.availableStages.length > 0;
  const executionComplete = blueprint.status === "completed";
  const executionCancelled = blueprint.status === "cancelled";
  const blueprintFailed = blueprint.status === "generation_failed";
  const executionFailed =
    blueprint.status === "execution_failed" || blueprint.job?.status === "failed";
  const currentStage =
    executionStarted && !executionComplete && !executionCancelled
      ? (enabledStages.find((stage) => !completedStages.has(stage)) ?? null)
      : null;

  const workflowSteps: StepItem[] = [
    {
      id: "blueprint",
      label: t("blueprint"),
      status: blueprintFailed ? "error" : blueprint.content.trim() ? "complete" : "current",
    },
    ...stages.map((stage): StepItem => {
      const enabled = enabledStages.includes(stage);
      const completed = completedStages.has(stage);
      const isCurrent = currentStage === stage;
      const status: StepItem["status"] = !enabled
        ? "skipped"
        : completed
          ? "complete"
          : isCurrent && executionFailed
            ? "error"
            : isCurrent
              ? "current"
              : "upcoming";
      return {
        id: stage,
        label: t(`stage.${stage}`),
        status,
      };
    }),
    {
      id: "complete",
      label: t("completeStep"),
      status: executionComplete ? "complete" : "upcoming",
    },
  ];

  return (
    <div className="px-5 py-4">
      <div className="mx-auto max-w-5xl">
        <div className="scrollbar-thin overflow-x-auto px-1 pb-1">
          <Steps items={workflowSteps} />
        </div>
        {blueprint.job?.error ? (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700 text-xs">
            {translateJobError(blueprint.job.error, errors)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function BlueprintFormFields({
  form,
  setForm,
  models,
  t,
}: {
  form: BlueprintForm;
  setForm: (value: BlueprintForm) => void;
  models: { value: string; label: string; description?: string }[];
  t: ReturnType<typeof useTranslations<"Translation">>;
}) {
  const updateStage = (stage: TranslationStage, update: Partial<TranslationStageConfig>) =>
    setForm({
      ...form,
      stageConfig: form.stageConfig.map((item) =>
        item.stage === stage ? { ...item, ...update } : item,
      ),
    });
  return (
    <div className="scrollbar-thin min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label>{t("blueprintName")}</Label>
          <Input
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </div>
        <div>
          <Label>{t("targetLanguage")}</Label>
          <Input
            required
            value={form.targetLanguage}
            onChange={(event) => setForm({ ...form, targetLanguage: event.target.value })}
            placeholder={t("targetLanguagePlaceholder")}
          />
        </div>
      </div>
      <div>
        <Label>{t("instructions")}</Label>
        <Textarea
          className="min-h-24"
          value={form.instructions}
          onChange={(event) => setForm({ ...form, instructions: event.target.value })}
          placeholder={t("instructionsPlaceholder")}
        />
      </div>
      <div>
        <Label>{t("blueprintModel")}</Label>
        <Select
          value={form.generationModelId}
          onChange={(value) => setForm({ ...form, generationModelId: value })}
          options={models}
          placeholder={t("selectModel")}
        />
        <p className="mt-1.5 text-xs text-zinc-400">{t("blueprintThinkingHint")}</p>
      </div>
      <div>
        <Label>{t("stageModels")}</Label>
        <div className="mt-2 divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200">
          {form.stageConfig.map((item) => (
            <div
              key={item.stage}
              className="grid items-center gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_300px]"
            >
              <label className="flex min-w-0 items-start gap-3">
                <input
                  className="mt-0.5 size-4 shrink-0"
                  type="checkbox"
                  checked={item.enabled}
                  disabled={item.stage === "draft"}
                  onChange={(event) => updateStage(item.stage, { enabled: event.target.checked })}
                />
                <span className="min-w-0">
                  <span className="block font-medium text-sm text-zinc-800">
                    {t(`stage.${item.stage}`)}
                  </span>
                  <span className="mt-0.5 block text-xs text-zinc-400 leading-5">
                    {t(`stageThinking.${item.stage}`)}
                  </span>
                </span>
              </label>
              <Select
                value={item.modelId ?? ""}
                onChange={(value) => updateStage(item.stage, { modelId: value || null })}
                options={models}
                placeholder={t("inheritModel")}
              />
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-zinc-400 leading-5">{t("thinkingConfigurationHint")}</p>
      </div>
    </div>
  );
}

function OutputView({
  output,
  loading,
  t,
}: {
  output?: TranslationOutput;
  loading: boolean;
  t: ReturnType<typeof useTranslations<"Translation">>;
}) {
  const content = `${output?.content ?? ""}${output?.partialContent ?? ""}`;
  if (loading || !content)
    return (
      <pre className="mx-auto min-h-full max-w-5xl whitespace-pre-wrap break-words px-8 py-8 font-mono text-sm text-zinc-800 leading-7">
        {loading ? t("loadingOutput") : t("noOutput")}
      </pre>
    );
  return (
    <div className="mx-auto min-h-full max-w-5xl space-y-5 px-8 py-8 font-mono text-sm text-zinc-800 leading-7">
      <IndentedParagraphs content={content} streaming={Boolean(output?.partialContent)} />
    </div>
  );
}

function IndentedParagraphs({
  content,
  streaming = false,
  empty,
}: {
  content: string;
  streaming?: boolean;
  empty?: string;
}) {
  const paragraphs = splitParagraphs(content);
  if (!paragraphs.length) return empty === undefined ? null : <p>{empty}</p>;
  return paragraphs.map((paragraph, index) => (
    <p key={index} className="whitespace-pre-wrap break-words indent-[2em]">
      {paragraph}
      {streaming && index === paragraphs.length - 1 ? (
        <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-zinc-600" />
      ) : null}
    </p>
  ));
}

function Empty({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-72 flex-col items-center justify-center text-center">
      <span className="flex size-12 items-center justify-center rounded-xl bg-zinc-100">
        <FileText className="size-5 text-zinc-400" />
      </span>
      <h3 className="mt-4 font-semibold text-sm">{title}</h3>
      <p className="mt-1 max-w-sm text-xs text-zinc-400 leading-5">{description}</p>
    </div>
  );
}

function translateJobError(error: string, t: ReturnType<typeof useTranslations<"Errors">>) {
  const safeKeys = new Set([
    "configuredModelMissing",
    "modelEmptyContent",
    "translationModelNotConfigured",
    "translationWindowMissing",
    "translationContextWindowTooSmall",
  ]);
  return safeKeys.has(error) && t.has(error as never) ? t(error as never) : error;
}
