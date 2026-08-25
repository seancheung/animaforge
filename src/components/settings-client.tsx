"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowUpDown,
  Bot,
  Download,
  FileUp,
  Fingerprint,
  KeyRound,
  LoaderCircle,
  MessageSquareQuote,
  Pencil,
  Plus,
  Server,
  Settings2,
  Square,
  Trash2,
  Upload,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button, ConfirmDialog, Input, Label, Modal, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/client";
import type {
  AppSettings,
  LlmModel,
  LlmService,
  LlmServiceType,
  ReviewerPrompt,
  StyleFingerprint,
  TaskType,
} from "@/lib/types";
import { cn } from "@/lib/utils";

interface SettingsPayload {
  settings: AppSettings;
  services: LlmService[];
  styleFingerprints: StyleFingerprint[];
}

interface FingerprintForm {
  id: string;
  name: string;
  sampleText: string;
  instructions: string;
  config: string;
  fileName: string;
}

type FingerprintStep = "sample" | "result";
type FingerprintExtractionStatus = "idle" | "streaming" | "completed" | "stopped";
type FingerprintCreationMode = "manual" | "extract";

interface SettingsImportCandidate {
  name: string;
  data: unknown;
  services: number;
  models: number;
  styleFingerprints: number;
}

interface SettingsImportResult extends SettingsPayload {
  summary: {
    services: number;
    models: number;
    styleFingerprints: number;
    secrets: number;
  };
}

export function SettingsClient({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("Settings");
  const common = useTranslations("Common");
  const locale = useLocale();
  const router = useRouter();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<SettingsPayload>("/api/settings"),
    enabled: open,
  });
  const [draft, setDraft] = useState<AppSettings>({
    uiLanguage: null,
    language: "",
    globalDefaultModel: null,
    taskModels: {},
    replyCaps: {},
    characterChatMaxConsecutiveReplies: 5,
    translationConcurrency: 2,
    translationWindowTokenLimit: null,
    revisionWindowTokenLimit: null,
    reviewerPrompts: [],
  });
  const [section, setSection] = useState<
    "general" | "services" | "tasks" | "prompts" | "fingerprints" | "transfer"
  >("general");
  const [importCandidate, setImportCandidate] = useState<SettingsImportCandidate | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);
  const [serviceOpen, setServiceOpen] = useState(false);
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);
  const [modelService, setModelService] = useState<string | null>(null);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    kind: "service" | "model";
    id: string;
    name: string;
  } | null>(null);
  const [serviceForm, setServiceForm] = useState({
    name: "",
    type: "openai" as LlmServiceType,
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
  });
  const emptyModelForm = {
    modelId: "",
    displayName: "",
    contextWindowK: "128",
    customBody: "",
    inputPrice: "",
    cacheReadPrice: "",
    cacheWritePrice: "",
    outputPrice: "",
  };
  const [modelForm, setModelForm] = useState(emptyModelForm);
  const [reviewerForm, setReviewerForm] = useState<ReviewerPrompt | null>(null);
  const [reviewerDeleteTarget, setReviewerDeleteTarget] = useState<ReviewerPrompt | null>(null);
  const [fingerprintForm, setFingerprintForm] = useState<FingerprintForm | null>(null);
  const [fingerprintCreationMode, setFingerprintCreationMode] =
    useState<FingerprintCreationMode>("extract");
  const [fingerprintStep, setFingerprintStep] = useState<FingerprintStep>("sample");
  const [fingerprintExtractionStatus, setFingerprintExtractionStatus] =
    useState<FingerprintExtractionStatus>("idle");
  const [fingerprintReasoning, setFingerprintReasoning] = useState("");
  const fingerprintExtractionController = useRef<AbortController | null>(null);
  const fingerprintReasoningRef = useRef<HTMLPreElement>(null);
  const fingerprintOutputRef = useRef<HTMLPreElement>(null);
  const [fingerprintDeleteTarget, setFingerprintDeleteTarget] = useState<StyleFingerprint | null>(
    null,
  );
  const settingsDirty = useRef(false);
  const settingsVersion = useRef(0);
  const settingsHydrated = useRef(false);

  const { mutate: persistSettings } = useMutation({
    mutationFn: ({ value }: { value: AppSettings; version: number }) =>
      api<AppSettings>("/api/settings", { method: "PATCH", body: JSON.stringify(value) }),
    onSuccess: (settings, { version }) => {
      if (version !== settingsVersion.current) return;
      const localeChanged = settings.uiLanguage !== query.data?.settings.uiLanguage;
      client.setQueryData<SettingsPayload>(["settings"], (current) =>
        current ? { ...current, settings } : current,
      );
      if (localeChanged) router.refresh();
    },
    onError: (error) => toast.error(t("autoSaveFailed", { message: error.message })),
  });

  const updateSettings = (updater: (current: AppSettings) => AppSettings) => {
    settingsDirty.current = true;
    settingsVersion.current += 1;
    setDraft(updater);
  };

  // Settings arrive asynchronously and seed the draft once per dialog session.
  useEffect(() => {
    if (!open) {
      settingsHydrated.current = false;
      return;
    }
    if (query.data && !settingsHydrated.current) {
      settingsHydrated.current = true;
      setDraft(query.data.settings);
    }
  }, [open, query.data]);

  useEffect(() => {
    if (!settingsDirty.current) return;
    const version = settingsVersion.current;
    const timer = window.setTimeout(() => {
      if (version !== settingsVersion.current) return;
      settingsDirty.current = false;
      persistSettings({ value: draft, version });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [draft, persistSettings]);

  useEffect(() => () => fingerprintExtractionController.current?.abort(), []);

  // Keep streamed reasoning and output pinned to the latest model delta.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Stream text is intentionally used only as an update trigger.
  useEffect(() => {
    if (fingerprintExtractionStatus !== "streaming") return;
    if (fingerprintReasoningRef.current)
      fingerprintReasoningRef.current.scrollTop = fingerprintReasoningRef.current.scrollHeight;
    if (fingerprintOutputRef.current)
      fingerprintOutputRef.current.scrollTop = fingerprintOutputRef.current.scrollHeight;
  }, [fingerprintExtractionStatus, fingerprintReasoning, fingerprintForm?.config]);

  const models = useMemo(
    () =>
      (query.data?.services ?? []).flatMap((service) =>
        service.models.map((model) => ({
          value: model.id,
          label: model.displayName,
          description: `${service.name} · ${model.modelId}`,
        })),
      ),
    [query.data],
  );
  const saveService = useMutation({
    mutationFn: () =>
      api(editingServiceId ? `/api/services/${editingServiceId}` : "/api/services", {
        method: editingServiceId ? "PATCH" : "POST",
        body: JSON.stringify(serviceForm),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["settings"] });
      setServiceOpen(false);
      setEditingServiceId(null);
      setServiceForm({
        name: "",
        type: "openai",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "",
      });
    },
    onError: (error) => toast.error(error.message),
  });
  const saveModel = useMutation({
    mutationFn: () => {
      const numericPrice = (value: string) => (value.trim() === "" ? null : Number(value));
      const payload = {
        ...modelForm,
        contextWindowK: Math.max(1, Math.round(Number(modelForm.contextWindowK) || 128)),
        inputPrice: numericPrice(modelForm.inputPrice),
        cacheReadPrice: numericPrice(modelForm.cacheReadPrice),
        cacheWritePrice: numericPrice(modelForm.cacheWritePrice),
        outputPrice: numericPrice(modelForm.outputPrice),
      };
      return api(editingModelId ? `/api/models/${editingModelId}` : "/api/models", {
        method: editingModelId ? "PATCH" : "POST",
        body: JSON.stringify(editingModelId ? payload : { ...payload, serviceId: modelService }),
      });
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["settings"] });
      setModelService(null);
      setEditingModelId(null);
      setModelForm(emptyModelForm);
    },
    onError: (error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: (target: NonNullable<typeof deleteTarget>) =>
      api(`/api/${target.kind === "service" ? "services" : "models"}/${target.id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["settings"] });
      setDeleteTarget(null);
    },
    onError: (error) => toast.error(error.message),
  });
  const extractFingerprint = async (form: FingerprintForm) => {
    if (!form.sampleText.trim() || fingerprintExtractionController.current) return;
    const controller = new AbortController();
    fingerprintExtractionController.current = controller;
    setFingerprintStep("result");
    setFingerprintExtractionStatus("streaming");
    setFingerprintReasoning("");
    setFingerprintForm((current) => (current ? { ...current, config: "" } : current));
    try {
      const response = await fetch("/api/style-fingerprints/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sampleText: form.sampleText,
          instructions: form.instructions,
          modelId: draft.taskModels.styleFingerprint || null,
          outputLanguage: draft.language,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: unknown };
        throw new Error(
          typeof body.error === "string" ? body.error : t("fingerprintExtractionFailed"),
        );
      }
      if (!response.body) throw new Error(t("fingerprintStreamUnavailable"));
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completed = false;
      const processLine = (line: string) => {
        if (!line.trim()) return;
        const event = JSON.parse(line) as
          | { type: "delta" | "reasoning_delta"; text: string }
          | { type: "complete" }
          | { type: "error"; message: string };
        if (event.type === "delta")
          setFingerprintForm((current) =>
            current ? { ...current, config: current.config + event.text } : current,
          );
        if (event.type === "reasoning_delta")
          setFingerprintReasoning((current) => current + event.text);
        if (event.type === "complete") completed = true;
        if (event.type === "error") throw new Error(event.message);
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) processLine(line);
      }
      buffer += decoder.decode();
      if (buffer.trim()) processLine(buffer);
      if (!completed) throw new Error(t("fingerprintStreamInterrupted"));
      setFingerprintExtractionStatus("completed");
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        if (fingerprintExtractionController.current === controller)
          setFingerprintExtractionStatus("stopped");
      } else {
        setFingerprintExtractionStatus("stopped");
        toast.error(error instanceof Error ? error.message : t("fingerprintExtractionFailed"));
      }
    } finally {
      if (fingerprintExtractionController.current === controller)
        fingerprintExtractionController.current = null;
    }
  };
  const stopFingerprintExtraction = () => {
    const controller = fingerprintExtractionController.current;
    fingerprintExtractionController.current = null;
    setFingerprintExtractionStatus("stopped");
    controller?.abort();
  };
  const closeFingerprintForm = () => {
    fingerprintExtractionController.current?.abort();
    fingerprintExtractionController.current = null;
    setFingerprintForm(null);
    setFingerprintCreationMode("extract");
    setFingerprintStep("sample");
    setFingerprintExtractionStatus("idle");
    setFingerprintReasoning("");
  };
  const saveFingerprint = useMutation({
    mutationFn: (form: FingerprintForm) =>
      api<StyleFingerprint>(
        form.id ? `/api/style-fingerprints/${form.id}` : "/api/style-fingerprints",
        {
          method: form.id ? "PATCH" : "POST",
          body: JSON.stringify({ name: form.name, config: form.config }),
        },
      ),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["settings"] });
      closeFingerprintForm();
    },
    onError: (error) => toast.error(error.message),
  });
  const removeFingerprint = useMutation({
    mutationFn: (fingerprint: StyleFingerprint) =>
      api(`/api/style-fingerprints/${fingerprint.id}`, { method: "DELETE" }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["settings"] });
      client.invalidateQueries({ queryKey: ["project"] });
      setFingerprintDeleteTarget(null);
    },
    onError: (error) => toast.error(error.message),
  });
  const exportSettings = useMutation({
    mutationFn: () => api<unknown>("/api/settings/export"),
    onSuccess: (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `anima-forge-settings-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success(t("exportSuccess"));
    },
    onError: (error) => toast.error(error.message),
  });
  const importSettings = useMutation({
    mutationFn: (candidate: SettingsImportCandidate) =>
      api<SettingsImportResult>("/api/settings/import", {
        method: "POST",
        body: JSON.stringify(candidate.data),
      }),
    onSuccess: (result) => {
      const localeChanged = draft.uiLanguage !== result.settings.uiLanguage;
      settingsDirty.current = false;
      settingsVersion.current += 1;
      settingsHydrated.current = true;
      setDraft(result.settings);
      client.setQueryData<SettingsPayload>(["settings"], {
        settings: result.settings,
        services: result.services,
        styleFingerprints: result.styleFingerprints,
      });
      client.invalidateQueries({ queryKey: ["project"] });
      setImportCandidate(null);
      if (importFileRef.current) importFileRef.current.value = "";
      toast.success(
        t("importSuccess", {
          services: result.summary.services,
          models: result.summary.models,
          fingerprints: result.summary.styleFingerprints,
        }),
      );
      if (localeChanged) router.refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  const selectSettingsImport = async (file: File) => {
    if (file.size > 2_000_000) {
      toast.error(t("importTooLarge"));
      if (importFileRef.current) importFileRef.current.value = "";
      return;
    }
    try {
      const data = JSON.parse(await file.text()) as Record<string, unknown>;
      if (
        data.kind !== "anima-forge-settings" ||
        data.version !== 1 ||
        data.includesSecrets !== true
      ) {
        throw new Error("invalid");
      }
      const services = Array.isArray(data.services) ? data.services : [];
      const styleFingerprints = Array.isArray(data.styleFingerprints) ? data.styleFingerprints : [];
      const models = services.reduce(
        (count, service) =>
          count +
          (typeof service === "object" &&
          service !== null &&
          Array.isArray((service as { models?: unknown }).models)
            ? ((service as { models: unknown[] }).models.length ?? 0)
            : 0),
        0,
      );
      setImportCandidate({
        name: file.name,
        data,
        services: services.length,
        models,
        styleFingerprints: styleFingerprints.length,
      });
    } catch {
      toast.error(t("invalidImportFile"));
      if (importFileRef.current) importFileRef.current.value = "";
    }
  };

  const taskLabels: Record<TaskType, string> = {
    writing: t("writing"),
    summary: t("summary"),
    assistant: t("assistant"),
    chat: t("chat"),
    review: t("review"),
    revisionPlan: t("revisionPlan"),
    revisionExecution: t("revisionExecution"),
    styleFingerprint: t("styleFingerprintTask"),
    translationBlueprint: t("translationBlueprint"),
    translationDraft: t("translationDraft"),
    translationProofread: t("translationProofread"),
    translationFidelity: t("translationFidelity"),
    translationPolish: t("translationPolish"),
  };
  const taskDescriptions: Record<TaskType, string> = {
    writing: t("writingDescription"),
    summary: t("summaryDescription"),
    assistant: t("assistantDescription"),
    chat: t("chatDescription"),
    review: t("reviewDescription"),
    revisionPlan: t("revisionPlanDescription"),
    revisionExecution: t("revisionExecutionDescription"),
    styleFingerprint: t("styleFingerprintTaskDescription"),
    translationBlueprint: t("translationBlueprintDescription"),
    translationDraft: t("translationDraftDescription"),
    translationProofread: t("translationProofreadDescription"),
    translationFidelity: t("translationFidelityDescription"),
    translationPolish: t("translationPolishDescription"),
  };
  const taskThinkingHints: Partial<Record<TaskType, string>> = {
    translationBlueprint: t("translationBlueprintThinkingHint"),
    translationDraft: t("translationDraftThinkingHint"),
    translationProofread: t("translationProofreadThinkingHint"),
    translationFidelity: t("translationFidelityThinkingHint"),
    translationPolish: t("translationPolishThinkingHint"),
  };

  const openReviewerForm = (reviewer?: ReviewerPrompt) =>
    setReviewerForm(reviewer ? { ...reviewer } : { id: "", name: "", prompt: "" });
  const openServiceForm = (service?: LlmService) => {
    setEditingServiceId(service?.id ?? null);
    setServiceForm(
      service
        ? {
            name: service.name,
            type: service.type,
            baseUrl: service.baseUrl,
            apiKey: service.apiKey,
          }
        : { name: "", type: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "" },
    );
    setServiceOpen(true);
  };
  const openModelForm = (serviceId: string, model?: LlmModel) => {
    setModelService(serviceId);
    setEditingModelId(model?.id ?? null);
    setModelForm(
      model
        ? {
            modelId: model.modelId,
            displayName: model.displayName,
            contextWindowK: model.contextWindowK.toString(),
            customBody: model.customBody,
            inputPrice: model.inputPrice?.toString() ?? "",
            cacheReadPrice: model.cacheReadPrice?.toString() ?? "",
            cacheWritePrice: model.cacheWritePrice?.toString() ?? "",
            outputPrice: model.outputPrice?.toString() ?? "",
          }
        : emptyModelForm,
    );
  };
  const saveReviewer = () => {
    if (!reviewerForm?.name.trim() || !reviewerForm.prompt.trim()) return;
    const reviewer = {
      ...reviewerForm,
      id: reviewerForm.id || crypto.randomUUID(),
      name: reviewerForm.name.trim(),
      prompt: reviewerForm.prompt.trim(),
    };
    updateSettings((current) => ({
      ...current,
      reviewerPrompts: current.reviewerPrompts.some((item) => item.id === reviewer.id)
        ? current.reviewerPrompts.map((item) => (item.id === reviewer.id ? reviewer : item))
        : [...current.reviewerPrompts, reviewer],
    }));
    setReviewerForm(null);
  };

  return (
    <>
      <Modal
        open={open}
        onOpenChange={onOpenChange}
        title={t("title")}
        width="max-w-5xl"
        scrollable={false}
      >
        <main className="grid h-[min(680px,calc(90vh-65px))] min-h-0 grid-cols-[180px_minmax(0,1fr)] overflow-hidden sm:grid-cols-[190px_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col border-zinc-200 border-r bg-zinc-50 p-2.5">
            <nav className="space-y-1">
              <button
                type="button"
                onClick={() => setSection("general")}
                className={cn(
                  "focus-ring flex w-full items-center gap-2.5 rounded-lg border border-transparent px-3 py-2 text-left text-sm transition-colors",
                  section === "general"
                    ? "bg-zinc-200/70 font-medium text-zinc-950"
                    : "text-zinc-600 hover:bg-zinc-200/50 hover:text-zinc-950",
                )}
              >
                <Settings2 className="size-4" />
                {t("generalNav")}
              </button>
              <button
                type="button"
                onClick={() => setSection("services")}
                className={cn(
                  "focus-ring flex w-full items-center gap-2.5 rounded-lg border border-transparent px-3 py-2 text-left text-sm transition-colors",
                  section === "services"
                    ? "bg-zinc-200/70 font-medium text-zinc-950"
                    : "text-zinc-600 hover:bg-zinc-200/50 hover:text-zinc-950",
                )}
              >
                <Server className="size-4" />
                {t("servicesNav")}
              </button>
              <button
                type="button"
                onClick={() => setSection("tasks")}
                className={cn(
                  "focus-ring flex w-full items-center gap-2.5 rounded-lg border border-transparent px-3 py-2 text-left text-sm transition-colors",
                  section === "tasks"
                    ? "bg-zinc-200/70 font-medium text-zinc-950"
                    : "text-zinc-600 hover:bg-zinc-200/50 hover:text-zinc-950",
                )}
              >
                <Bot className="size-4" />
                {t("tasksNav")}
              </button>
              <button
                type="button"
                onClick={() => setSection("prompts")}
                className={cn(
                  "focus-ring flex w-full items-center gap-2.5 rounded-lg border border-transparent px-3 py-2 text-left text-sm transition-colors",
                  section === "prompts"
                    ? "bg-zinc-200/70 font-medium text-zinc-950"
                    : "text-zinc-600 hover:bg-zinc-200/50 hover:text-zinc-950",
                )}
              >
                <MessageSquareQuote className="size-4" />
                {t("promptsNav")}
              </button>
              <button
                type="button"
                onClick={() => setSection("fingerprints")}
                className={cn(
                  "focus-ring flex w-full items-center gap-2.5 rounded-lg border border-transparent px-3 py-2 text-left text-sm transition-colors",
                  section === "fingerprints"
                    ? "bg-zinc-200/70 font-medium text-zinc-950"
                    : "text-zinc-600 hover:bg-zinc-200/50 hover:text-zinc-950",
                )}
              >
                <Fingerprint className="size-4" />
                {t("fingerprintsNav")}
              </button>
              <button
                type="button"
                onClick={() => setSection("transfer")}
                className={cn(
                  "focus-ring flex w-full items-center gap-2.5 rounded-lg border border-transparent px-3 py-2 text-left text-sm transition-colors",
                  section === "transfer"
                    ? "bg-zinc-200/70 font-medium text-zinc-950"
                    : "text-zinc-600 hover:bg-zinc-200/50 hover:text-zinc-950",
                )}
              >
                <ArrowUpDown className="size-4" />
                {t("transferNav")}
              </button>
            </nav>
            <div className="mt-auto flex gap-2 px-3 py-2 text-[11px] text-zinc-400 leading-4">
              <KeyRound className="mt-0.5 size-3 shrink-0" />
              <span>{t("localKeys")}</span>
            </div>
          </aside>
          <section className="flex min-h-0 min-w-0 flex-col bg-white">
            {section === "transfer" ? (
              <>
                <div className="shrink-0 border-zinc-100 border-b px-6 py-5">
                  <h2 className="font-semibold text-base">{t("transferTitle")}</h2>
                  <p className="mt-1 text-xs text-zinc-500">{t("transferDescription")}</p>
                </div>
                <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-6">
                  <div className="space-y-4">
                    <div className="rounded-xl border border-zinc-200 p-5">
                      <div className="flex items-start gap-3">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100">
                          <Download className="size-4 text-zinc-600" />
                        </span>
                        <div>
                          <h3 className="font-semibold text-sm">{t("exportTitle")}</h3>
                          <p className="mt-1 text-xs text-zinc-500 leading-5">
                            {t("exportDescription")}
                          </p>
                        </div>
                      </div>
                      <p className="mt-5 rounded-lg bg-amber-50 p-3 text-amber-700 text-xs leading-5">
                        {t("apiKeyExportWarning")}
                      </p>
                      <div className="mt-4 flex justify-end">
                        <Button
                          onClick={() => exportSettings.mutate()}
                          loading={exportSettings.isPending}
                        >
                          <Download className="size-3.5" />
                          {t("exportButton")}
                        </Button>
                      </div>
                    </div>

                    <div className="rounded-xl border border-zinc-200 p-5">
                      <div className="flex items-start gap-3">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100">
                          <Upload className="size-4 text-zinc-600" />
                        </span>
                        <div>
                          <h3 className="font-semibold text-sm">{t("importTitle")}</h3>
                          <p className="mt-1 text-xs text-zinc-500 leading-5">
                            {t("importDescription")}
                          </p>
                        </div>
                      </div>
                      <input
                        ref={importFileRef}
                        type="file"
                        accept=".json,application/json"
                        className="hidden"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void selectSettingsImport(file);
                        }}
                      />
                      <div className="mt-4 flex justify-end">
                        <Button variant="secondary" onClick={() => importFileRef.current?.click()}>
                          <Upload className="size-3.5" />
                          {t("chooseImportFile")}
                        </Button>
                      </div>
                    </div>

                    <p className="px-1 text-[11px] text-zinc-400 leading-5">
                      {t("transferScopeHint")}
                    </p>
                  </div>
                </div>
              </>
            ) : section === "general" ? (
              <>
                <div className="shrink-0 border-zinc-100 border-b px-6 py-5">
                  <h2 className="font-semibold text-base">{t("generalTitle")}</h2>
                  <p className="mt-1 text-xs text-zinc-500">{t("generalDescription")}</p>
                </div>
                <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-6">
                  <div className="divide-y divide-zinc-100">
                    <div className="grid gap-5 py-6 md:grid-cols-[minmax(150px,1fr)_320px]">
                      <div>
                        <div className="font-medium text-sm">{t("interfaceLanguage")}</div>
                        <p className="mt-1.5 text-xs text-zinc-500 leading-5">
                          {t("interfaceLanguageDescription")}
                        </p>
                      </div>
                      <div>
                        <Label>{t("language")}</Label>
                        <Select
                          value={draft.uiLanguage ?? locale}
                          onChange={(value) =>
                            updateSettings((current) => ({
                              ...current,
                              uiLanguage: value as AppSettings["uiLanguage"],
                            }))
                          }
                          options={[
                            { value: "en", label: t("english") },
                            { value: "zh-CN", label: t("simplifiedChinese") },
                          ]}
                        />
                      </div>
                    </div>
                    <div className="grid gap-5 py-6 md:grid-cols-[minmax(150px,1fr)_320px]">
                      <div>
                        <div className="font-medium text-sm">{t("outputLanguage")}</div>
                        <p className="mt-1.5 text-xs text-zinc-500 leading-5">
                          {t("outputLanguageDescription")}
                        </p>
                      </div>
                      <div>
                        <Label>{t("language")}</Label>
                        <Input
                          value={draft.language}
                          onChange={(event) =>
                            updateSettings((current) => ({
                              ...current,
                              language: event.target.value,
                            }))
                          }
                          placeholder={t("outputLanguageExample")}
                        />
                      </div>
                    </div>
                    <div className="grid gap-5 py-6 md:grid-cols-[minmax(150px,1fr)_320px]">
                      <div>
                        <div className="font-medium text-sm">{t("translationConcurrency")}</div>
                        <p className="mt-1.5 text-xs text-zinc-500 leading-5">
                          {t("translationConcurrencyDescription")}
                        </p>
                      </div>
                      <div>
                        <Label>{t("concurrentRequests")}</Label>
                        <Input
                          type="number"
                          min={1}
                          max={4}
                          value={draft.translationConcurrency}
                          onChange={(event) =>
                            updateSettings((current) => ({
                              ...current,
                              translationConcurrency: Math.min(
                                4,
                                Math.max(1, Number(event.target.value) || 1),
                              ),
                            }))
                          }
                        />
                      </div>
                    </div>
                    <div className="grid gap-5 py-6 md:grid-cols-[minmax(150px,1fr)_320px]">
                      <div>
                        <div className="font-medium text-sm">{t("translationWindowSize")}</div>
                        <p className="mt-1.5 text-xs text-zinc-500 leading-5">
                          {t("translationWindowSizeDescription")}
                        </p>
                      </div>
                      <WindowLimitControl
                        value={draft.translationWindowTokenLimit}
                        onChange={(value) =>
                          updateSettings((current) => ({
                            ...current,
                            translationWindowTokenLimit: value,
                          }))
                        }
                      />
                    </div>
                    <div className="grid gap-5 py-6 md:grid-cols-[minmax(150px,1fr)_320px]">
                      <div>
                        <div className="font-medium text-sm">{t("revisionWindowSize")}</div>
                        <p className="mt-1.5 text-xs text-zinc-500 leading-5">
                          {t("revisionWindowSizeDescription")}
                        </p>
                      </div>
                      <WindowLimitControl
                        value={draft.revisionWindowTokenLimit}
                        onChange={(value) =>
                          updateSettings((current) => ({
                            ...current,
                            revisionWindowTokenLimit: value,
                          }))
                        }
                      />
                    </div>
                    <div className="grid gap-5 py-6 md:grid-cols-[minmax(150px,1fr)_320px]">
                      <div>
                        <div className="font-medium text-sm">
                          {t("characterChatMaxConsecutiveReplies")}
                        </div>
                        <p className="mt-1.5 text-xs text-zinc-500 leading-5">
                          {t("characterChatMaxConsecutiveRepliesDescription")}
                        </p>
                      </div>
                      <div>
                        <Label>{t("replyCount")}</Label>
                        <Input
                          type="number"
                          min={1}
                          value={draft.characterChatMaxConsecutiveReplies}
                          onChange={(event) =>
                            updateSettings((current) => ({
                              ...current,
                              characterChatMaxConsecutiveReplies: Math.max(
                                1,
                                Number(event.target.value) || 1,
                              ),
                            }))
                          }
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </>
            ) : section === "services" ? (
              <>
                <div className="flex shrink-0 items-center justify-between border-zinc-100 border-b px-6 py-5">
                  <div>
                    <h2 className="font-semibold text-base">{t("servicesTitle")}</h2>
                    <p className="mt-1 text-xs text-zinc-500">{t("servicesDescription")}</p>
                  </div>
                  <Button size="sm" onClick={() => openServiceForm()}>
                    <Plus className="size-3.5" />
                    {t("addService")}
                  </Button>
                </div>
                <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-6">
                  <div className="space-y-3 py-5">
                    {query.data?.services.map((service) => (
                      <ServiceCard
                        key={service.id}
                        service={service}
                        onEdit={() => openServiceForm(service)}
                        onAddModel={() => openModelForm(service.id)}
                        onEditModel={(model) => openModelForm(service.id, model)}
                        onDelete={(kind, id, name) => setDeleteTarget({ kind, id, name })}
                      />
                    ))}
                    {!query.isLoading && !query.data?.services.length ? (
                      <div className="flex min-h-80 flex-col items-center justify-center text-center">
                        <span className="flex size-10 items-center justify-center rounded-xl bg-zinc-100">
                          <Server className="size-4 text-zinc-500" />
                        </span>
                        <p className="mt-3 font-medium text-sm">{t("noServices")}</p>
                        <p className="mt-1 text-xs text-zinc-500">{t("noServicesDescription")}</p>
                      </div>
                    ) : null}
                  </div>
                </div>
              </>
            ) : section === "tasks" ? (
              <>
                <div className="shrink-0 border-zinc-100 border-b px-6 py-5">
                  <h2 className="font-semibold text-base">{t("tasksTitle")}</h2>
                  <p className="mt-1 text-xs text-zinc-500">{t("tasksDescription")}</p>
                </div>
                <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-6">
                  <div className="divide-y divide-zinc-100">
                    <div className="grid gap-5 py-6 md:grid-cols-[minmax(150px,1fr)_320px]">
                      <div>
                        <div className="flex items-center gap-2 font-medium text-sm">
                          <Bot className="size-4 text-zinc-400" />
                          {t("globalDefaultModel")}
                        </div>
                        <p className="mt-1.5 text-xs text-zinc-500 leading-5">
                          {t("globalDefaultModelDescription")}
                        </p>
                      </div>
                      <div>
                        <Label>{t("defaultModel")}</Label>
                        <Select
                          value={draft.globalDefaultModel ?? "none"}
                          onChange={(value) =>
                            updateSettings((current) => ({
                              ...current,
                              globalDefaultModel: value === "none" ? null : value,
                            }))
                          }
                          options={[{ value: "none", label: common("notConfigured") }, ...models]}
                        />
                      </div>
                    </div>
                    {(
                      [
                        "writing",
                        "summary",
                        "assistant",
                        "chat",
                        "review",
                        "revisionPlan",
                        "revisionExecution",
                        "styleFingerprint",
                        "translationBlueprint",
                        "translationDraft",
                        "translationProofread",
                        "translationFidelity",
                        "translationPolish",
                      ] as TaskType[]
                    ).map((task) => (
                      <div
                        key={task}
                        className="grid gap-5 py-6 md:grid-cols-[minmax(150px,1fr)_320px]"
                      >
                        <div>
                          <div className="flex items-center gap-2 font-medium text-sm">
                            <Bot className="size-4 text-zinc-400" />
                            {taskLabels[task]}
                          </div>
                          <p className="mt-1.5 text-xs text-zinc-500 leading-5">
                            {taskDescriptions[task]}
                          </p>
                          {taskThinkingHints[task] ? (
                            <p className="mt-1 text-xs text-zinc-400 leading-5">
                              {taskThinkingHints[task]}
                            </p>
                          ) : null}
                        </div>
                        <div className="space-y-3">
                          <div>
                            <Label>{t("defaultModel")}</Label>
                            <Select
                              value={draft.taskModels[task] ?? "inherit"}
                              onChange={(value) =>
                                updateSettings((current) => ({
                                  ...current,
                                  taskModels: {
                                    ...current.taskModels,
                                    [task]: value === "inherit" ? null : value,
                                  },
                                }))
                              }
                              options={[
                                { value: "inherit", label: t("useGlobalDefault") },
                                ...models,
                              ]}
                            />
                          </div>
                          <div>
                            <Label>{t("replyCap")}</Label>
                            <Input
                              type="number"
                              min={1}
                              placeholder={t("serviceDefault")}
                              value={draft.replyCaps[task] ?? ""}
                              onChange={(event) => {
                                const value = event.target.value;
                                updateSettings((current) => ({
                                  ...current,
                                  replyCaps: {
                                    ...current.replyCaps,
                                    [task]: value ? Number(value) : null,
                                  },
                                }));
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : section === "prompts" ? (
              <>
                <div className="flex shrink-0 items-center justify-between border-zinc-100 border-b px-6 py-5">
                  <div>
                    <h2 className="font-semibold text-base">{t("promptsTitle")}</h2>
                    <p className="mt-1 text-xs text-zinc-500">{t("promptsDescription")}</p>
                  </div>
                  <Button size="sm" onClick={() => openReviewerForm()}>
                    <Plus className="size-3.5" />
                    {t("addReviewer")}
                  </Button>
                </div>
                <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-6">
                  <div className="divide-y divide-zinc-100">
                    {draft.reviewerPrompts.map((reviewer) => (
                      <div key={reviewer.id} className="flex items-start gap-4 py-5">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100">
                          <MessageSquareQuote className="size-4 text-zinc-500" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <h3 className="font-medium text-sm">{reviewer.name}</h3>
                          <p className="mt-1.5 whitespace-pre-wrap text-xs text-zinc-500 leading-5">
                            {reviewer.prompt}
                          </p>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={common("edit")}
                            onClick={() => openReviewerForm(reviewer)}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={common("delete")}
                            onClick={() => setReviewerDeleteTarget(reviewer)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                    {!draft.reviewerPrompts.length ? (
                      <div className="flex min-h-80 flex-col items-center justify-center text-center">
                        <MessageSquareQuote className="size-6 text-zinc-300" />
                        <p className="mt-3 font-medium text-sm">{t("noReviewers")}</p>
                        <p className="mt-1 text-xs text-zinc-500">{t("noReviewersDescription")}</p>
                      </div>
                    ) : null}
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="flex shrink-0 items-center justify-between border-zinc-100 border-b px-6 py-5">
                  <div>
                    <h2 className="font-semibold text-base">{t("fingerprintsTitle")}</h2>
                    <p className="mt-1 text-xs text-zinc-500">{t("fingerprintsDescription")}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setFingerprintCreationMode("extract");
                        setFingerprintStep("sample");
                        setFingerprintExtractionStatus("idle");
                        setFingerprintReasoning("");
                        setFingerprintForm({
                          id: "",
                          name: "",
                          sampleText: "",
                          instructions: "",
                          config: "",
                          fileName: "",
                        });
                      }}
                    >
                      <Fingerprint className="size-3.5" />
                      {t("extractFingerprintStyle")}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        setFingerprintCreationMode("manual");
                        setFingerprintStep("result");
                        setFingerprintExtractionStatus("idle");
                        setFingerprintReasoning("");
                        setFingerprintForm({
                          id: "",
                          name: "",
                          sampleText: "",
                          instructions: "",
                          config: "",
                          fileName: "",
                        });
                      }}
                    >
                      <Plus className="size-3.5" />
                      {t("addFingerprintConfig")}
                    </Button>
                  </div>
                </div>
                <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-6">
                  <div className="divide-y divide-zinc-100">
                    {(query.data?.styleFingerprints ?? []).map((fingerprint) => (
                      <div key={fingerprint.id} className="flex items-start gap-4 py-5">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100">
                          <Fingerprint className="size-4 text-zinc-500" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <h3 className="font-medium text-sm">{fingerprint.name}</h3>
                          <p className="mt-1.5 line-clamp-4 whitespace-pre-wrap text-xs text-zinc-500 leading-5">
                            {fingerprint.config}
                          </p>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={common("edit")}
                            onClick={() => {
                              setFingerprintCreationMode("manual");
                              setFingerprintStep("result");
                              setFingerprintExtractionStatus("completed");
                              setFingerprintReasoning("");
                              setFingerprintForm({
                                ...fingerprint,
                                sampleText: "",
                                instructions: "",
                                fileName: "",
                              });
                            }}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={common("delete")}
                            onClick={() => setFingerprintDeleteTarget(fingerprint)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                    {!query.isLoading && !query.data?.styleFingerprints.length ? (
                      <div className="flex min-h-72 flex-col items-center justify-center text-center">
                        <Fingerprint className="size-6 text-zinc-300" />
                        <p className="mt-3 font-medium text-sm">{t("noFingerprints")}</p>
                        <p className="mt-1 text-xs text-zinc-500">
                          {t("noFingerprintsDescription")}
                        </p>
                      </div>
                    ) : null}
                  </div>
                </div>
              </>
            )}
          </section>
        </main>
      </Modal>
      <Modal
        open={Boolean(importCandidate)}
        onOpenChange={(open) => {
          if (!open && !importSettings.isPending) {
            setImportCandidate(null);
            if (importFileRef.current) importFileRef.current.value = "";
          }
        }}
        title={t("confirmImportTitle")}
        description={t("confirmImportDescription")}
        width="max-w-md"
      >
        <div className="space-y-4 p-5">
          <div className="rounded-lg bg-zinc-50 p-3">
            <p className="truncate font-medium text-sm">{importCandidate?.name}</p>
            <p className="mt-1 text-xs text-zinc-500 leading-5">
              {t("importSummary", {
                services: importCandidate?.services ?? 0,
                models: importCandidate?.models ?? 0,
                fingerprints: importCandidate?.styleFingerprints ?? 0,
              })}
            </p>
          </div>
          <p className="text-amber-700 text-xs leading-5">{t("importContainsApiKeys")}</p>
        </div>
        <div className="flex justify-end gap-2 border-zinc-100 border-t p-3">
          <Button
            variant="secondary"
            disabled={importSettings.isPending}
            onClick={() => {
              setImportCandidate(null);
              if (importFileRef.current) importFileRef.current.value = "";
            }}
          >
            {common("cancel")}
          </Button>
          <Button
            loading={importSettings.isPending}
            onClick={() => importCandidate && importSettings.mutate(importCandidate)}
          >
            {t("importButton")}
          </Button>
        </div>
      </Modal>
      <Modal
        open={serviceOpen}
        onOpenChange={(open) => {
          setServiceOpen(open);
          if (!open) setEditingServiceId(null);
        }}
        title={editingServiceId ? t("editServiceTitle") : t("addServiceTitle")}
        scrollable={false}
      >
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            saveService.mutate();
          }}
        >
          <div className="scrollbar-thin min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
            <div>
              <Label>{t("name")}</Label>
              <Input
                autoFocus
                required
                value={serviceForm.name}
                onChange={(event) => setServiceForm({ ...serviceForm, name: event.target.value })}
                placeholder="OpenAI"
              />
            </div>
            <div>
              <Label>{t("apiType")}</Label>
              <Select
                value={serviceForm.type}
                onChange={(value) => {
                  const type = value as LlmServiceType;
                  setServiceForm({
                    ...serviceForm,
                    type,
                    baseUrl:
                      type === "anthropic"
                        ? "https://api.anthropic.com/v1"
                        : "https://api.openai.com/v1",
                  });
                }}
                options={[
                  { value: "openai", label: t("openAiCompatible") },
                  { value: "anthropic", label: t("anthropicCompatible") },
                ]}
              />
            </div>
            <div>
              <Label>Base URL</Label>
              <Input
                required
                value={serviceForm.baseUrl}
                onChange={(event) =>
                  setServiceForm({ ...serviceForm, baseUrl: event.target.value })
                }
              />
            </div>
            <div>
              <Label>API Key</Label>
              <Input
                type="password"
                value={serviceForm.apiKey}
                onChange={(event) => setServiceForm({ ...serviceForm, apiKey: event.target.value })}
              />
            </div>
          </div>
          <div className="flex shrink-0 justify-end gap-2 border-zinc-100 border-t p-3">
            <Button type="button" variant="secondary" onClick={() => setServiceOpen(false)}>
              {common("cancel")}
            </Button>
            <Button type="submit" loading={saveService.isPending}>
              {editingServiceId ? common("save") : common("add")}
            </Button>
          </div>
        </form>
      </Modal>
      <Modal
        open={Boolean(modelService)}
        onOpenChange={(open) => {
          if (!open) {
            setModelService(null);
            setEditingModelId(null);
          }
        }}
        title={editingModelId ? t("editModelTitle") : t("addModelTitle")}
        description={t("addModelDescription")}
        width="max-w-2xl"
        scrollable={false}
      >
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            saveModel.mutate();
          }}
        >
          <div className="scrollbar-thin min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
            <div>
              <Label>{t("modelId")}</Label>
              <Input
                autoFocus
                required
                value={modelForm.modelId}
                onChange={(event) => setModelForm({ ...modelForm, modelId: event.target.value })}
                placeholder="gpt-5.6-luna"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
              <div>
                <Label>{t("displayName")}</Label>
                <Input
                  required
                  value={modelForm.displayName}
                  onChange={(event) =>
                    setModelForm({ ...modelForm, displayName: event.target.value })
                  }
                  placeholder="GPT 5.6 Luna"
                />
              </div>
              <div>
                <Label>{t("contextWindowK")}</Label>
                <Input
                  required
                  type="number"
                  min="1"
                  step="1"
                  value={modelForm.contextWindowK}
                  onChange={(event) =>
                    setModelForm({ ...modelForm, contextWindowK: event.target.value })
                  }
                />
                <p className="mt-1 text-[11px] text-zinc-400">{t("contextWindowKHint")}</p>
              </div>
            </div>
            <div>
              <div className="mb-2">
                <Label>{t("tokenPrices")}</Label>
                <p className="mt-1 text-xs text-zinc-400">{t("tokenPricesDescription")}</p>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <PriceInput
                  label={t("inputPrice")}
                  value={modelForm.inputPrice}
                  onChange={(value) => setModelForm({ ...modelForm, inputPrice: value })}
                />
                <PriceInput
                  label={t("outputPrice")}
                  value={modelForm.outputPrice}
                  onChange={(value) => setModelForm({ ...modelForm, outputPrice: value })}
                />
                <PriceInput
                  label={t("cacheReadPrice")}
                  value={modelForm.cacheReadPrice}
                  onChange={(value) => setModelForm({ ...modelForm, cacheReadPrice: value })}
                />
                <PriceInput
                  label={t("cacheWritePrice")}
                  value={modelForm.cacheWritePrice}
                  onChange={(value) => setModelForm({ ...modelForm, cacheWritePrice: value })}
                />
              </div>
            </div>
            <div>
              <Label>{t("customBody")}</Label>
              <Textarea
                className="font-mono text-xs"
                value={modelForm.customBody}
                onChange={(event) => setModelForm({ ...modelForm, customBody: event.target.value })}
                placeholder='{"thinking":{"type":"disabled"}}'
              />
            </div>
          </div>
          <div className="flex shrink-0 justify-end gap-2 border-zinc-100 border-t p-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setModelService(null);
                setEditingModelId(null);
              }}
            >
              {common("cancel")}
            </Button>
            <Button type="submit" loading={saveModel.isPending}>
              {editingModelId ? common("save") : t("addModel")}
            </Button>
          </div>
        </form>
      </Modal>
      <Modal
        open={Boolean(reviewerForm)}
        onOpenChange={(open) => !open && setReviewerForm(null)}
        title={reviewerForm?.id ? t("editReviewerTitle") : t("addReviewerTitle")}
        scrollable={false}
      >
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            saveReviewer();
          }}
        >
          <div className="scrollbar-thin min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
            <div>
              <Label>{t("reviewerName")}</Label>
              <Input
                autoFocus
                required
                value={reviewerForm?.name ?? ""}
                onChange={(event) =>
                  setReviewerForm((current) =>
                    current ? { ...current, name: event.target.value } : current,
                  )
                }
              />
            </div>
            <div>
              <Label>{t("reviewerPrompt")}</Label>
              <Textarea
                required
                className="min-h-48"
                value={reviewerForm?.prompt ?? ""}
                onChange={(event) =>
                  setReviewerForm((current) =>
                    current ? { ...current, prompt: event.target.value } : current,
                  )
                }
                placeholder={t("reviewerPromptPlaceholder")}
              />
            </div>
          </div>
          <div className="flex shrink-0 justify-end gap-2 border-zinc-100 border-t p-3">
            <Button type="button" variant="secondary" onClick={() => setReviewerForm(null)}>
              {common("cancel")}
            </Button>
            <Button type="submit">{common("save")}</Button>
          </div>
        </form>
      </Modal>
      <Modal
        open={Boolean(fingerprintForm)}
        onOpenChange={(open) => {
          if (!open && !saveFingerprint.isPending) closeFingerprintForm();
        }}
        title={
          fingerprintForm?.id
            ? t("editFingerprintTitle")
            : fingerprintCreationMode === "manual"
              ? t("addFingerprintConfigTitle")
              : t("extractFingerprintStyleTitle")
        }
        width="max-w-2xl"
        scrollable={false}
      >
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (!fingerprintForm) return;
            if (
              fingerprintForm.id ||
              fingerprintCreationMode === "manual" ||
              fingerprintExtractionStatus === "completed"
            )
              saveFingerprint.mutate(fingerprintForm);
            else if (fingerprintStep === "sample") void extractFingerprint(fingerprintForm);
          }}
        >
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-5">
            {fingerprintForm?.id || fingerprintCreationMode === "manual" ? (
              <div className="space-y-4">
                <div>
                  <Label>{t("fingerprintName")}</Label>
                  <Input
                    autoFocus
                    required
                    value={fingerprintForm?.name ?? ""}
                    onChange={(event) =>
                      setFingerprintForm((current) =>
                        current ? { ...current, name: event.target.value } : current,
                      )
                    }
                    placeholder={t("fingerprintNamePlaceholder")}
                  />
                </div>
                <div>
                  <Label>{t("fingerprintConfig")}</Label>
                  <Textarea
                    required
                    className="min-h-64 font-mono text-xs leading-5"
                    value={fingerprintForm?.config ?? ""}
                    onChange={(event) =>
                      setFingerprintForm((current) =>
                        current ? { ...current, config: event.target.value } : current,
                      )
                    }
                    placeholder={t("fingerprintConfigPlaceholder")}
                  />
                  <p className="mt-1.5 text-xs text-zinc-400">
                    {t("fingerprintConfigDescription")}
                  </p>
                </div>
              </div>
            ) : fingerprintStep === "sample" ? (
              <div className="space-y-4">
                <div>
                  <div className="mb-1.5 flex items-center justify-between gap-3">
                    <Label>{t("sampleText")}</Label>
                    <label className="focus-ring inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100">
                      <FileUp className="size-3.5" />
                      {fingerprintForm?.fileName || t("selectTextFile")}
                      <input
                        type="file"
                        className="sr-only"
                        accept=".txt,.md,.markdown,text/plain,text/markdown"
                        onChange={async (event) => {
                          const file = event.target.files?.[0];
                          event.target.value = "";
                          if (!file) return;
                          if (!/\.(txt|md|markdown)$/i.test(file.name)) {
                            toast.error(t("invalidSampleFile"));
                            return;
                          }
                          const sampleText = await file.text();
                          setFingerprintForm((current) =>
                            current ? { ...current, sampleText, fileName: file.name } : current,
                          );
                        }}
                      />
                    </label>
                  </div>
                  <Textarea
                    autoFocus
                    required
                    className="min-h-56"
                    value={fingerprintForm?.sampleText ?? ""}
                    onChange={(event) =>
                      setFingerprintForm((current) =>
                        current
                          ? { ...current, sampleText: event.target.value, fileName: "" }
                          : current,
                      )
                    }
                    placeholder={t("sampleTextPlaceholder")}
                  />
                  <p className="mt-1.5 text-xs text-zinc-400">{t("sampleNotSaved")}</p>
                </div>
                <div>
                  <Label>{t("extractionInstructions")}</Label>
                  <Textarea
                    className="min-h-28"
                    value={fingerprintForm?.instructions ?? ""}
                    onChange={(event) =>
                      setFingerprintForm((current) =>
                        current ? { ...current, instructions: event.target.value } : current,
                      )
                    }
                    placeholder={t("extractionInstructionsPlaceholder")}
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <Label>{t("fingerprintName")}</Label>
                  <Input
                    autoFocus
                    required
                    value={fingerprintForm?.name ?? ""}
                    onChange={(event) =>
                      setFingerprintForm((current) =>
                        current ? { ...current, name: event.target.value } : current,
                      )
                    }
                    placeholder={t("fingerprintNamePlaceholder")}
                  />
                </div>
                {fingerprintReasoning ? (
                  <div>
                    <Label>{t("fingerprintReasoning")}</Label>
                    <pre
                      ref={fingerprintReasoningRef}
                      className="scrollbar-thin max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-500 leading-5"
                    >
                      {fingerprintReasoning}
                    </pre>
                  </div>
                ) : null}
                <div>
                  <div className="mb-1.5 flex items-center justify-between gap-3">
                    <Label>{t("fingerprintConfig")}</Label>
                    {fingerprintExtractionStatus === "streaming" ? (
                      <span className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                        <LoaderCircle className="size-3 animate-spin" />
                        {t("fingerprintExtracting")}
                      </span>
                    ) : fingerprintExtractionStatus === "stopped" ? (
                      <span className="text-[11px] text-amber-600">
                        {t("fingerprintExtractionStopped")}
                      </span>
                    ) : null}
                  </div>
                  {fingerprintExtractionStatus === "completed" ? (
                    <Textarea
                      required
                      className="min-h-64 font-mono text-xs leading-5"
                      value={fingerprintForm?.config ?? ""}
                      onChange={(event) =>
                        setFingerprintForm((current) =>
                          current ? { ...current, config: event.target.value } : current,
                        )
                      }
                      placeholder={t("fingerprintConfigPlaceholder")}
                    />
                  ) : (
                    <pre
                      ref={fingerprintOutputRef}
                      className="scrollbar-thin max-h-80 min-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-zinc-200 bg-zinc-50 p-3 font-mono text-xs text-zinc-700 leading-5"
                    >
                      {fingerprintForm?.config || t("fingerprintWaitingForOutput")}
                    </pre>
                  )}
                  {fingerprintExtractionStatus === "completed" ? (
                    <p className="mt-1.5 text-xs text-zinc-400">
                      {t("fingerprintConfigDescription")}
                    </p>
                  ) : null}
                </div>
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center justify-between gap-3 border-zinc-100 border-t p-3">
            {!fingerprintForm?.id &&
            fingerprintCreationMode === "extract" &&
            fingerprintStep === "result" ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  if (fingerprintExtractionStatus === "streaming") stopFingerprintExtraction();
                  setFingerprintExtractionStatus("idle");
                  setFingerprintStep("sample");
                }}
              >
                <ArrowLeft className="size-4" />
                {t("previousStep")}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={saveFingerprint.isPending}
                onClick={closeFingerprintForm}
              >
                {common("cancel")}
              </Button>
              {fingerprintForm?.id || fingerprintCreationMode === "manual" ? (
                <Button
                  type="submit"
                  loading={saveFingerprint.isPending}
                  disabled={!fingerprintForm?.name.trim() || !fingerprintForm?.config.trim()}
                >
                  {common("save")}
                </Button>
              ) : fingerprintStep === "sample" ? (
                <Button type="submit" disabled={!fingerprintForm?.sampleText.trim()}>
                  <Fingerprint className="size-4" />
                  {t("extractFingerprint")}
                </Button>
              ) : fingerprintExtractionStatus === "streaming" ? (
                <Button type="button" variant="danger" onClick={stopFingerprintExtraction}>
                  <Square className="size-3.5 fill-current" />
                  {t("stopExtraction")}
                </Button>
              ) : fingerprintExtractionStatus === "completed" ? (
                <Button
                  type="submit"
                  loading={saveFingerprint.isPending}
                  disabled={!fingerprintForm?.name.trim() || !fingerprintForm?.config.trim()}
                >
                  {common("confirm")}
                </Button>
              ) : (
                <Button
                  type="button"
                  disabled={!fingerprintForm?.sampleText.trim()}
                  onClick={() => fingerprintForm && void extractFingerprint(fingerprintForm)}
                >
                  <Fingerprint className="size-4" />
                  {t("extractAgain")}
                </Button>
              )}
            </div>
          </div>
        </form>
      </Modal>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t("deleteTitle", {
          type: deleteTarget?.kind === "service" ? t("service") : t("model"),
        })}
        description={t("deleteDescription", { name: deleteTarget?.name ?? "" })}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget)}
        loading={remove.isPending}
      />
      <ConfirmDialog
        open={Boolean(reviewerDeleteTarget)}
        onOpenChange={(open) => !open && setReviewerDeleteTarget(null)}
        title={t("deleteReviewerTitle")}
        description={t("deleteReviewerDescription", { name: reviewerDeleteTarget?.name ?? "" })}
        onConfirm={() => {
          if (!reviewerDeleteTarget) return;
          updateSettings((current) => ({
            ...current,
            reviewerPrompts: current.reviewerPrompts.filter(
              (reviewer) => reviewer.id !== reviewerDeleteTarget.id,
            ),
          }));
          setReviewerDeleteTarget(null);
        }}
      />
      <ConfirmDialog
        open={Boolean(fingerprintDeleteTarget)}
        onOpenChange={(open) => !open && setFingerprintDeleteTarget(null)}
        title={t("deleteFingerprintTitle")}
        description={t("deleteFingerprintDescription", {
          name: fingerprintDeleteTarget?.name ?? "",
        })}
        onConfirm={() =>
          fingerprintDeleteTarget && removeFingerprint.mutate(fingerprintDeleteTarget)
        }
        loading={removeFingerprint.isPending}
      />
    </>
  );
}

function WindowLimitControl({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  const t = useTranslations("Settings");
  const custom = value != null;
  return (
    <div className="space-y-3">
      <Select
        value={custom ? "custom" : "auto"}
        onChange={(mode) => onChange(mode === "custom" ? (value ?? 8_000) : null)}
        options={[
          { value: "auto", label: t("automaticWindowSize") },
          { value: "custom", label: t("customWindowSize") },
        ]}
      />
      {custom ? (
        <div>
          <Label>{t("windowTokenLimit")}</Label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              max={64}
              step={1}
              value={value / 1_000}
              onChange={(event) =>
                onChange(Math.min(64, Math.max(1, Number(event.target.value) || 1)) * 1_000)
              }
            />
            <span className="shrink-0 text-xs text-zinc-500">K Token</span>
          </div>
        </div>
      ) : (
        <p className="text-xs text-zinc-400 leading-5">{t("automaticWindowSizeHint")}</p>
      )}
    </div>
  );
}

function PriceInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-[11px] text-zinc-500">{label}</label>
      <Input
        type="number"
        min="0"
        step="any"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="—"
      />
    </div>
  );
}

function formatContextWindow(contextWindowK: number) {
  return contextWindowK >= 1000
    ? `${Number((contextWindowK / 1000).toFixed(2))}M`
    : `${contextWindowK}K`;
}

function ServiceCard({
  service,
  onEdit,
  onAddModel,
  onEditModel,
  onDelete,
}: {
  service: LlmService;
  onEdit: () => void;
  onAddModel: () => void;
  onEditModel: (model: LlmModel) => void;
  onDelete: (kind: "service" | "model", id: string, name: string) => void;
}) {
  const t = useTranslations("Settings");
  const common = useTranslations("Common");
  return (
    <article className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h3 className="truncate font-semibold text-base">{service.name}</h3>
            <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] text-zinc-500">
              {service.type === "openai" ? t("openAiCompatible") : t("anthropicCompatible")}
            </span>
          </div>
          <p className="mt-2 truncate font-mono text-xs text-zinc-400">{service.baseUrl}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button variant="ghost" size="icon" aria-label={common("edit")} onClick={onEdit}>
            <Pencil className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-zinc-400 hover:bg-red-50 hover:text-red-600"
            aria-label={common("delete")}
            onClick={() => onDelete("service", service.id, service.name)}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>
      <div className="mt-5 space-y-2">
        {service.models.map((model) => {
          const hasCustomBody = Boolean(
            model.customBody.trim() && model.customBody.trim() !== "{}",
          );
          return (
            <div
              key={model.id}
              className="flex min-h-14 items-center gap-3 rounded-xl bg-zinc-50 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <span className="font-medium text-sm">{model.displayName}</span>
                <span className="ml-1.5 font-mono text-xs text-zinc-400">({model.modelId})</span>
                <span className="ml-2 inline-flex rounded-full bg-zinc-200/70 px-2 py-0.5 text-[10px] text-zinc-500">
                  {formatContextWindow(model.contextWindowK)}
                </span>
                {hasCustomBody ? (
                  <span className="ml-2 inline-flex rounded-full bg-zinc-200/70 px-2 py-0.5 text-[10px] text-zinc-500">
                    {t("customBodyBadge")}
                  </span>
                ) : null}
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={common("edit")}
                onClick={() => onEditModel(model)}
              >
                <Pencil className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="text-zinc-400 hover:bg-red-50 hover:text-red-600"
                aria-label={common("delete")}
                onClick={() => onDelete("model", model.id, model.displayName)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          );
        })}
      </div>
      <Button className="mt-3" size="sm" variant="secondary" onClick={onAddModel}>
        <Plus className="size-3.5" />
        {t("addModel")}
      </Button>
    </article>
  );
}
