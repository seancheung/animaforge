// biome-ignore-all lint: correctness/useExhaustiveDependencies Floating UI callback refs are intentionally attached during render.
"use client";

import {
  autoUpdate,
  FloatingPortal,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from "@floating-ui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AtSign,
  Bot,
  Check,
  Database,
  FileText,
  LoaderCircle,
  Paperclip,
  Send,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button, ConfirmDialog, Modal, Tooltip } from "@/components/ui";
import { api } from "@/lib/client";
import type {
  AssistantConversation,
  AssistantProposal,
  AssistantProposalItem,
  AssistantResourceRef,
  AssistantScope,
  AssistantToolActivity,
} from "@/lib/types";
import { cn } from "@/lib/utils";

export function CreativeAssistant({
  projectId,
  scope,
  contextId,
  currentReference,
  embedded = false,
  onApplied,
}: {
  projectId: string;
  scope: AssistantScope;
  contextId?: string;
  currentReference?: AssistantResourceRef;
  embedded?: boolean;
  onApplied?: (item: AssistantProposalItem) => void;
}) {
  const t = useTranslations("Assistant");
  const client = useQueryClient();
  const quickPrompts: Record<AssistantScope, string[]> = {
    setup: [t("quickCompleteSetup"), t("quickProjectOutline"), t("quickImproveCharacters")],
    chapter: [t("quickChapterOutline"), t("quickChapterSynopsis"), t("quickReviewBlocks")],
  };
  const targetQuery = `scope=${scope}${contextId ? `&contextId=${encodeURIComponent(contextId)}` : ""}`;
  const queryKey = ["creative-assistant", projectId, scope, contextId ?? ""] as const;
  const query = useQuery({
    queryKey,
    queryFn: () =>
      api<AssistantConversation>(`/api/projects/${projectId}/assistant?${targetQuery}`),
  });
  const [draft, setDraft] = useState("");
  const [references, setReferences] = useState<AssistantResourceRef[]>([]);
  const [mention, setMention] = useState<{ query: string; start: number; end: number } | null>(
    null,
  );
  const [clearOpen, setClearOpen] = useState(false);
  const [proposalId, setProposalId] = useState<string | null>(null);
  const [proposalOpen, setProposalOpen] = useState(false);
  const [optimisticUser, setOptimisticUser] = useState<{
    id: string | null;
    content: string;
    references: AssistantResourceRef[];
  } | null>(null);
  const [streamingReply, setStreamingReply] = useState("");
  const [streamingActivities, setStreamingActivities] = useState<AssistantToolActivity[]>([]);
  const [isPreparingProposal, setIsPreparingProposal] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const composerInput = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const sendController = useRef<AbortController | null>(null);
  const mentionQuery = useQuery({
    queryKey: ["assistant-resources", projectId, scope, contextId ?? "", mention?.query ?? ""],
    queryFn: () =>
      api<AssistantResourceRef[]>(
        `/api/projects/${projectId}/assistant/resources?${targetQuery}&q=${encodeURIComponent(mention?.query ?? "")}`,
      ),
    enabled: Boolean(mention),
  });
  const {
    refs: floatingRefs,
    floatingStyles,
    context: floatingContext,
  } = useFloating({
    open: Boolean(mention),
    onOpenChange: (open) => {
      if (!open) setMention(null);
    },
    placement: "top-start",
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip(), shift({ padding: 8 })],
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useDismiss(floatingContext, { outsidePressEvent: "pointerdown" }),
    useRole(floatingContext, { role: "listbox" }),
  ]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [query.data?.messages.length, optimisticUser, streamingReply]);

  useEffect(() => () => sendController.current?.abort(), []);

  const send = useMutation({
    mutationFn: async ({
      content,
      messageReferences,
    }: {
      content: string;
      messageReferences: AssistantResourceRef[];
    }) => {
      const controller = new AbortController();
      sendController.current = controller;
      try {
        const response = await fetch(`/api/projects/${projectId}/assistant`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scope, contextId, content, references: messageReferences }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error || t("sendFailedStatus", { status: response.status }));
        }
        if (!response.body) throw new Error(t("streamUnavailable"));
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let conversation: AssistantConversation | null = null;
        const processLine = (line: string) => {
          if (!line.trim()) return;
          const event = JSON.parse(line) as {
            type?: string;
            text?: unknown;
            activity?: unknown;
            conversation?: unknown;
            error?: unknown;
            messageId?: unknown;
          };
          if (event.type === "user_ack" && typeof event.messageId === "string") {
            setOptimisticUser((current) =>
              current ? { ...current, id: event.messageId as string } : current,
            );
          } else if (event.type === "delta" && typeof event.text === "string") {
            setStreamingReply((current) => current + event.text);
          } else if (
            event.type === "activity" &&
            event.activity &&
            typeof event.activity === "object"
          ) {
            setStreamingActivities((current) => [
              ...current,
              event.activity as AssistantToolActivity,
            ]);
          } else if (event.type === "proposal_pending") {
            setIsPreparingProposal(true);
          } else if (
            event.type === "done" &&
            event.conversation &&
            typeof event.conversation === "object"
          ) {
            conversation = event.conversation as AssistantConversation;
          } else if (event.type === "error") {
            throw new Error(typeof event.error === "string" ? event.error : t("generationFailed"));
          }
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
        if (!conversation) throw new Error(t("generationFailed"));
        return conversation;
      } finally {
        if (sendController.current === controller) sendController.current = null;
      }
    },
    onSuccess: (conversation) => {
      client.setQueryData(queryKey, conversation);
      setOptimisticUser(null);
      setStreamingReply("");
      setStreamingActivities([]);
      setIsPreparingProposal(false);
    },
    onError: async (error) => {
      if (!isAbortError(error)) toast.error(error.message);
      await client.invalidateQueries({ queryKey });
      setOptimisticUser(null);
      setStreamingReply("");
      setStreamingActivities([]);
      setIsPreparingProposal(false);
    },
  });

  const clear = useMutation({
    mutationFn: () =>
      api(`/api/projects/${projectId}/assistant?${targetQuery}`, { method: "DELETE" }),
    onSuccess: () => {
      client.setQueryData<AssistantConversation>(queryKey, {
        id: null,
        projectId,
        scope,
        contextId: contextId ?? null,
        messages: [],
        attachments: [],
      });
      setClearOpen(false);
      setProposalOpen(false);
      setProposalId(null);
      setReferences([]);
      client.invalidateQueries({ queryKey: ["assistant-resources", projectId, scope] });
    },
    onError: (error) => toast.error(error.message),
  });

  const decide = useMutation({
    mutationFn: ({
      item,
      decision,
    }: {
      item: AssistantProposalItem;
      decision: "accepted" | "rejected";
    }) =>
      api(`/api/assistant-proposal-items/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ decision }),
      }),
    onSuccess: (_result, variables) => {
      client.invalidateQueries({ queryKey });
      if (variables.decision === "accepted") {
        client.invalidateQueries({ queryKey: ["project", projectId] });
        client.invalidateQueries({ queryKey: ["chapter"] });
        client.invalidateQueries({ queryKey: ["assistant-resources", projectId, scope] });
        onApplied?.(variables.item);
      }
    },
    onError: (error) => toast.error(error.message),
  });

  const decideAll = useMutation({
    mutationFn: async ({
      items,
      decision,
    }: {
      items: AssistantProposalItem[];
      decision: "accepted" | "rejected";
    }) => {
      for (const item of items) {
        await api(`/api/assistant-proposal-items/${item.id}`, {
          method: "PATCH",
          body: JSON.stringify({ decision }),
        });
        if (decision === "accepted") onApplied?.(item);
      }
    },
    onSettled: (_result, _error, variables) => {
      client.invalidateQueries({ queryKey });
      if (variables.decision === "accepted") {
        client.invalidateQueries({ queryKey: ["project", projectId] });
        client.invalidateQueries({ queryKey: ["chapter"] });
        client.invalidateQueries({ queryKey: ["assistant-resources", projectId, scope] });
      }
    },
    onError: (error) => toast.error(error.message),
  });

  const removeAttachment = useMutation({
    mutationFn: (id: string) => api(`/api/assistant-attachments/${id}`, { method: "DELETE" }),
    onSuccess: (_result, id) => {
      client.invalidateQueries({ queryKey });
      client.invalidateQueries({ queryKey: ["assistant-resources", projectId, scope] });
      setReferences((current) =>
        current.filter((reference) => reference.type !== "attachment" || reference.id !== id),
      );
    },
    onError: (error) => toast.error(error.message),
  });

  const uploadAttachment = async (file?: File) => {
    if (!file) return;
    const form = new FormData();
    form.set("scope", scope);
    if (contextId) form.set("contextId", contextId);
    form.set("file", file);
    try {
      const response = await fetch(`/api/projects/${projectId}/assistant/attachments`, {
        method: "POST",
        body: form,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(body.error || t("uploadFailedStatus", { status: response.status }));
      client.setQueryData(queryKey, body as AssistantConversation);
      client.invalidateQueries({ queryKey: ["assistant-resources", projectId, scope] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("attachmentUploadFailed"));
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const messages = query.data?.messages ?? [];
  const attachments = query.data?.attachments ?? [];
  const proposals = messages.flatMap((message) => message.proposals);
  const proposal = proposals.find((candidate) => candidate.id === proposalId) ?? null;
  const openProposal = (id: string) => {
    setProposalId(id);
    setProposalOpen(true);
  };
  const submit = () => {
    const content = draft.trim();
    if (content && !send.isPending) {
      const messageReferences = references;
      setDraft("");
      setReferences([]);
      setMention(null);
      setOptimisticUser({ id: null, content, references: messageReferences });
      setStreamingReply("");
      setStreamingActivities([]);
      setIsPreparingProposal(false);
      send.mutate({ content, messageReferences });
    }
  };

  const updateMention = (value: string, caret: number) => {
    const match = value.slice(0, caret).match(/@([^@\s]{0,40})$/);
    setMention(match ? { query: match[1], start: caret - match[0].length, end: caret } : null);
  };

  const selectReference = (resource: AssistantResourceRef) => {
    if (!mention) return;
    const nextDraft = `${draft.slice(0, mention.start)}${resource.label}${draft.slice(mention.end)}`;
    const caret = mention.start + resource.label.length;
    setDraft(nextDraft);
    setReferences((current) =>
      current.some((item) => item.type === resource.type && item.id === resource.id)
        ? current
        : [...current, resource],
    );
    setMention(null);
    window.requestAnimationFrame(() => {
      composerInput.current?.focus();
      composerInput.current?.setSelectionRange(caret, caret);
    });
  };

  const openResourcePicker = () => {
    const caret = composerInput.current?.selectionStart ?? draft.length;
    setMention({ query: "", start: caret, end: caret });
    composerInput.current?.focus();
  };

  return (
    <section
      aria-label={t("regionLabel")}
      className={cn(
        "flex h-full min-h-0 w-full min-w-0 flex-1 flex-col bg-white",
        !embedded && "border-zinc-200 border-l",
      )}
    >
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 py-5">
        {query.isLoading ? (
          <div className="flex h-full items-center justify-center text-zinc-400">
            <LoaderCircle className="size-4 animate-spin" />
          </div>
        ) : null}
        {!query.isLoading && !messages.length && !optimisticUser && !send.isPending ? (
          <div className="flex min-h-full flex-col justify-center py-8">
            <span className="flex size-10 items-center justify-center rounded-xl bg-zinc-100">
              <Bot className="size-4 text-zinc-600" />
            </span>
            <h2 className="mt-4 font-semibold text-sm">{t("startTitle")}</h2>
            <div className="mt-4 space-y-2">
              {quickPrompts[scope].map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => setDraft(prompt)}
                  className="focus-ring block w-full rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-left text-xs text-zinc-600 leading-5 hover:border-zinc-300 hover:bg-zinc-50"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="space-y-5">
          {messages.map((message) => (
            <div
              key={message.id}
              className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}
            >
              <div
                className={cn(
                  "min-w-0 text-sm leading-6",
                  message.role === "user"
                    ? "max-w-[88%] rounded-xl bg-zinc-100 px-3 py-2 text-zinc-800"
                    : "w-full text-zinc-700",
                )}
              >
                {message.activities.length ? (
                  <div className="mb-2 space-y-1">
                    {message.activities.map((activity, index) => (
                      <div
                        key={`${activity.toolName}-${index}`}
                        className="flex items-center gap-1.5 text-[11px] text-zinc-400 leading-5"
                      >
                        <Database className="size-3 shrink-0" />
                        <span className="truncate">{activityLabel(t, activity)}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
                <p className="whitespace-pre-wrap break-words">{message.content}</p>
                {message.references.length ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {message.references.map((reference) => (
                      <span
                        key={`${reference.type}-${reference.id}`}
                        className="inline-flex max-w-full items-center gap-1 rounded-md bg-white/80 px-1.5 py-0.5 text-[10px] text-zinc-500 leading-4"
                      >
                        <AtSign className="size-2.5 shrink-0" />
                        <span className="truncate">{reference.label}</span>
                      </span>
                    ))}
                  </div>
                ) : null}
                {message.proposals.length ? (
                  <div className="mt-3 space-y-2">
                    {message.proposals.map((item) => (
                      <ProposalButton
                        key={item.id}
                        proposal={item}
                        onClick={() => openProposal(item.id)}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
          {optimisticUser &&
          (!optimisticUser.id || !messages.some((message) => message.id === optimisticUser.id)) ? (
            <div className="flex justify-end">
              <div className="max-w-[88%] rounded-xl bg-zinc-100 px-3 py-2 text-sm text-zinc-800 leading-6">
                <p className="whitespace-pre-wrap break-words">{optimisticUser.content}</p>
                {optimisticUser.references.length ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {optimisticUser.references.map((reference) => (
                      <span
                        key={`${reference.type}-${reference.id}`}
                        className="inline-flex max-w-full items-center gap-1 rounded-md bg-white/80 px-1.5 py-0.5 text-[10px] text-zinc-500 leading-4"
                      >
                        <AtSign className="size-2.5 shrink-0" />
                        <span className="truncate">{reference.label}</span>
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
          {send.isPending ? (
            <div className="w-full text-sm text-zinc-700 leading-6">
              {streamingActivities.length ? (
                <div className="mb-2 space-y-1">
                  {streamingActivities.map((activity, index) => (
                    <div
                      key={`${activity.toolName}-${index}`}
                      className="flex items-center gap-1.5 text-[11px] text-zinc-400 leading-5"
                    >
                      <Database className="size-3 shrink-0" />
                      <span className="truncate">{activityLabel(t, activity)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {streamingReply ? (
                <>
                  <p className="whitespace-pre-wrap break-words">
                    {streamingReply}
                    {!isPreparingProposal ? (
                      <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-zinc-700 align-middle" />
                    ) : null}
                  </p>
                  {isPreparingProposal ? <ProposalPlaceholder /> : null}
                </>
              ) : (
                <div className="flex items-center gap-2 text-xs text-zinc-400">
                  <LoaderCircle className="size-3.5 animate-spin" />
                  {t("processing")}
                </div>
              )}
            </div>
          ) : null}
          <div ref={endRef} />
        </div>
      </div>
      <div className="shrink-0 border-zinc-100 border-t p-3">
        {attachments.length ? (
          <div className="scrollbar-thin mb-2 flex gap-1.5 overflow-x-auto pb-1">
            {attachments.map((attachment) => (
              <span
                key={attachment.id}
                className="flex max-w-48 shrink-0 items-center gap-1.5 rounded-md bg-zinc-100 px-2 py-1 text-[11px] text-zinc-600"
              >
                <FileText className="size-3 shrink-0" />
                <span className="truncate">{attachment.name}</span>
                <button
                  type="button"
                  aria-label={t("removeAttachment", { name: attachment.name })}
                  onClick={() => removeAttachment.mutate(attachment.id)}
                  className="text-zinc-400 hover:text-zinc-900"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <div className="rounded-xl border border-zinc-200 bg-white p-2 shadow-sm transition focus-within:border-zinc-400 focus-within:ring-4 focus-within:ring-zinc-950/5">
          {references.length ? (
            <div className="mb-1.5 flex flex-wrap gap-1 px-1">
              {references.map((reference) => (
                <span
                  key={`${reference.type}-${reference.id}`}
                  className="flex max-w-full items-center gap-1 rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600 leading-4"
                >
                  <AtSign className="size-2.5 shrink-0" />
                  <span className="truncate">{reference.label}</span>
                  <button
                    type="button"
                    aria-label={t("removeReference", { name: reference.label })}
                    onClick={() =>
                      setReferences((current) =>
                        current.filter(
                          (item) => item.type !== reference.type || item.id !== reference.id,
                        ),
                      )
                    }
                    className="text-zinc-400 hover:text-zinc-900"
                  >
                    <X className="size-2.5" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <textarea
            {...getReferenceProps()}
            ref={(node) => {
              composerInput.current = node;
              floatingRefs.setReference(node);
            }}
            aria-label={t("composerLabel")}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              updateMention(event.target.value, event.target.selectionStart);
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Escape" && mention) {
                event.preventDefault();
                setMention(null);
                return;
              }
              if (event.key === "Enter" && mention) {
                event.preventDefault();
                return;
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder={t("composerPlaceholder")}
            className="block min-h-16 w-full resize-none bg-transparent px-1.5 py-1 text-sm leading-6 outline-none placeholder:text-zinc-400"
          />
          <div className="mt-1 flex items-center justify-between">
            <input
              ref={fileInput}
              type="file"
              accept=".txt,.md,.markdown,.json,.csv,text/plain,text/markdown,application/json,text/csv"
              className="hidden"
              onChange={(event) => void uploadAttachment(event.target.files?.[0])}
            />
            <div className="flex items-center gap-0.5">
              <Tooltip label={t("referenceResources")}>
                <Button
                  aria-label={t("referenceResources")}
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={openResourcePicker}
                >
                  <AtSign className="size-3.5" />
                </Button>
              </Tooltip>
              {currentReference ? (
                <Tooltip label={t("referenceCurrentBlock", { name: currentReference.label })}>
                  <Button
                    aria-label={t("referenceCurrentBlockLabel")}
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() =>
                      setReferences((items) =>
                        items.some(
                          (item) =>
                            item.type === currentReference.type && item.id === currentReference.id,
                        )
                          ? items
                          : [...items, currentReference],
                      )
                    }
                  >
                    <FileText className="size-3.5" />
                  </Button>
                </Tooltip>
              ) : null}
              <Tooltip label={t("addAttachment")}>
                <Button
                  aria-label={t("addAttachment")}
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => fileInput.current?.click()}
                >
                  <Paperclip className="size-3.5" />
                </Button>
              </Tooltip>
              <span className="mx-0.5 h-4 w-px bg-zinc-200" />
              <Tooltip label={t("clearConversation")}>
                <Button
                  aria-label={t("clearConversation")}
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  disabled={send.isPending || (!messages.length && !attachments.length)}
                  onClick={() => setClearOpen(true)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </Tooltip>
            </div>
            {send.isPending ? (
              <Tooltip label={t("stop")}>
                <Button
                  aria-label={t("stop")}
                  size="icon"
                  className="size-7"
                  onClick={() => sendController.current?.abort()}
                >
                  <Square className="size-3 fill-current" />
                </Button>
              </Tooltip>
            ) : (
              <Button
                aria-label={t("send")}
                size="icon"
                className="size-7"
                disabled={!draft.trim()}
                onClick={submit}
              >
                <Send className="size-3.5" />
              </Button>
            )}
          </div>
        </div>
        {mention ? (
          <FloatingPortal>
            <div
              ref={floatingRefs.setFloating}
              style={floatingStyles}
              className="z-[90] w-72"
              {...getFloatingProps()}
            >
              <div className="popover-panel max-h-72 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-1 shadow-xl">
                {mentionQuery.isLoading ? (
                  <div className="flex items-center justify-center px-3 py-5 text-zinc-400">
                    <LoaderCircle className="size-3.5 animate-spin" />
                  </div>
                ) : mentionQuery.data?.length ? (
                  mentionQuery.data.map((resource) => (
                    <button
                      key={`${resource.type}-${resource.id}`}
                      type="button"
                      role="option"
                      aria-selected={references.some(
                        (item) => item.type === resource.type && item.id === resource.id,
                      )}
                      onClick={() => selectReference(resource)}
                      className="focus-ring flex w-full items-center gap-2.5 rounded-md border border-transparent px-2.5 py-2 text-left hover:bg-zinc-100"
                    >
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-zinc-100">
                        <AtSign className="size-3.5 text-zinc-500" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-xs text-zinc-800">
                          {resource.label}
                        </span>
                        <span className="mt-0.5 block truncate text-[10px] text-zinc-400">
                          {resource.description}
                        </span>
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-5 text-center text-xs text-zinc-400">
                    {t("noResources")}
                  </div>
                )}
              </div>
            </div>
          </FloatingPortal>
        ) : null}
      </div>
      <ConfirmDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        title={t("clearTitle")}
        description={t("clearDescription")}
        confirmText={t("clear")}
        onConfirm={() => clear.mutate()}
        loading={clear.isPending}
      />
      <Modal
        open={proposalOpen}
        onOpenChange={setProposalOpen}
        onExitComplete={() => setProposalId(null)}
        title={proposal?.title ?? t("reviewContent")}
        description={proposal?.description || undefined}
        width="max-w-2xl"
        scrollable={false}
      >
        {proposal ? (
          <ProposalReview
            proposal={proposal}
            decidingId={decide.isPending ? decide.variables?.item.id : null}
            bulkDecision={decideAll.isPending ? decideAll.variables?.decision : null}
            onDecision={(item, decision) => decide.mutate({ item, decision })}
            onBulkDecision={(items, decision) => decideAll.mutate({ items, decision })}
            onOpenProposal={openProposal}
          />
        ) : null}
      </Modal>
    </section>
  );
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function ProposalPlaceholder() {
  const t = useTranslations("Assistant");
  return (
    <div
      role="status"
      aria-live="polite"
      className="mt-3 flex w-full items-center gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2.5 shadow-sm"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100">
        <LoaderCircle className="size-3.5 animate-spin text-zinc-500" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-xs text-zinc-600">{t("preparingProposal")}</span>
        <span aria-hidden="true" className="mt-1.5 flex gap-1.5">
          <span className="h-1.5 w-24 animate-pulse rounded-full bg-zinc-200" />
          <span className="h-1.5 w-12 animate-pulse rounded-full bg-zinc-100" />
        </span>
      </span>
    </div>
  );
}

function ProposalButton({
  proposal,
  onClick,
}: {
  proposal: AssistantProposal;
  onClick: () => void;
}) {
  const t = useTranslations("Assistant");
  const pending = proposal.items.filter((item) => item.decision === "pending").length;
  const accepted = proposal.items.filter((item) => item.decision === "accepted").length;
  const rejected = proposal.items.filter((item) => item.decision === "rejected").length;
  const superseded = proposal.items.filter((item) => item.decision === "superseded").length;
  return (
    <button
      type="button"
      onClick={onClick}
      className="focus-ring flex w-full items-center gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-left shadow-sm hover:border-zinc-300 hover:bg-zinc-50"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100">
        <FileText className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-xs text-zinc-800">{proposal.title}</span>
        <span className="mt-0.5 block text-[11px] text-zinc-400">
          {pending
            ? t("pendingCount", { count: pending })
            : t("reviewSummary", { accepted, rejected, superseded })}
        </span>
      </span>
    </button>
  );
}

function ProposalReview({
  proposal,
  decidingId,
  bulkDecision,
  onDecision,
  onBulkDecision,
  onOpenProposal,
}: {
  proposal: AssistantProposal;
  decidingId: string | null | undefined;
  bulkDecision: "accepted" | "rejected" | null | undefined;
  onDecision: (item: AssistantProposalItem, decision: "accepted" | "rejected") => void;
  onBulkDecision: (items: AssistantProposalItem[], decision: "accepted" | "rejected") => void;
  onOpenProposal: (id: string) => void;
}) {
  const t = useTranslations("Assistant");
  const pendingItems = proposal.items.filter((item) => item.decision === "pending");
  const busy = Boolean(decidingId || bulkDecision);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5">
        {proposal.supersededByProposalId ? (
          <button
            type="button"
            onClick={() => onOpenProposal(proposal.supersededByProposalId!)}
            className="focus-ring mt-4 flex w-full items-center justify-between rounded-lg bg-amber-50 px-3 py-2 text-left text-amber-800 text-xs hover:bg-amber-100"
          >
            <span>{t("proposalHasReplacement")}</span>
            <span className="font-medium">{t("viewReplacement")}</span>
          </button>
        ) : null}
        {proposal.supersedesProposalId ? (
          <button
            type="button"
            onClick={() => onOpenProposal(proposal.supersedesProposalId!)}
            className="focus-ring mt-4 flex w-full items-center justify-between rounded-lg bg-zinc-50 px-3 py-2 text-left text-xs text-zinc-600 hover:bg-zinc-100"
          >
            <span>{t("proposalIsRevision")}</span>
            <span className="font-medium">{t("viewOriginal")}</span>
          </button>
        ) : null}
        <div className="divide-y divide-zinc-100">
          {proposal.items.map((item) => (
            <div key={item.id} className="py-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-sm">{item.label}</span>
                    <DecisionBadge decision={item.decision} />
                  </div>
                  <p className="mt-1 text-[11px] text-zinc-400">{t(`action.${item.action}`)}</p>
                </div>
              </div>
              <ProposalPreview item={item} />
              <div className="mt-3 flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={item.decision !== "pending" || busy}
                  onClick={() => onDecision(item, "rejected")}
                >
                  <X className="size-3.5" />
                  {t("reject")}
                </Button>
                <Button
                  size="sm"
                  disabled={item.decision !== "pending" || busy}
                  loading={decidingId === item.id}
                  onClick={() => onDecision(item, "accepted")}
                >
                  <Check className="size-3.5" />
                  {t("acceptApply")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-zinc-100 border-t px-5 pt-3 pb-4">
        <Button
          size="sm"
          variant="secondary"
          disabled={!pendingItems.length || busy}
          loading={bulkDecision === "rejected"}
          onClick={() => onBulkDecision(pendingItems, "rejected")}
        >
          <X className="size-3.5" />
          {t("rejectAll")}
        </Button>
        <Button
          size="sm"
          disabled={!pendingItems.length || busy}
          loading={bulkDecision === "accepted"}
          onClick={() => onBulkDecision(pendingItems, "accepted")}
        >
          <Check className="size-3.5" />
          {t("acceptAll")}
        </Button>
      </div>
    </div>
  );
}

function DecisionBadge({ decision }: { decision: AssistantProposalItem["decision"] }) {
  const t = useTranslations("Assistant");
  if (decision === "accepted")
    return (
      <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-[10px] text-emerald-700">
        {t("accepted")}
      </span>
    );
  if (decision === "rejected")
    return (
      <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-medium text-[10px] text-zinc-500">
        {t("rejected")}
      </span>
    );
  if (decision === "superseded")
    return (
      <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-[10px] text-amber-700">
        {t("superseded")}
      </span>
    );
  return (
    <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-[10px] text-amber-700">
      {t("pending")}
    </span>
  );
}

function activityLabel(
  t: ReturnType<typeof useTranslations<"Assistant">>,
  activity: AssistantToolActivity,
) {
  const supported = [
    "get_project_context",
    "list_chapters",
    "get_chapter_synopsis",
    "list_chapter_blocks",
    "get_chapter_content",
    "get_block_content",
    "search_chapter_content",
    "list_characters",
    "get_character",
    "search_characters",
    "list_attachments",
    "search_project",
    "read_attachment",
  ];
  return supported.includes(activity.toolName)
    ? t(`activity.${activity.toolName}`)
    : activity.label || activity.toolName;
}

function ProposalPreview({ item }: { item: AssistantProposalItem }) {
  const payload = item.payload;
  if (item.action === "update_project_field")
    return (
      <div className="mt-3 max-h-52 overflow-y-auto whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 text-sm text-zinc-700 leading-6">
        {String(payload.value ?? "")}
      </div>
    );
  if (item.action === "update_chapter_title")
    return (
      <div className="mt-3 rounded-lg bg-zinc-50 p-3 font-medium text-sm text-zinc-700">
        {String(payload.title ?? "")}
      </div>
    );
  if (item.action === "create_character" || item.action === "update_character")
    return (
      <div className="mt-3 rounded-lg bg-zinc-50 p-3">
        <p className="font-medium text-sm">{String(payload.name ?? item.label)}</p>
        <p className="mt-1 whitespace-pre-wrap text-xs text-zinc-600 leading-5">
          {String(payload.description ?? "")}
        </p>
      </div>
    );
  if (
    item.action === "update_chapter_synopsis" ||
    item.action === "create_text_block" ||
    item.action === "update_block_synopsis"
  )
    return (
      <div className="mt-3 max-h-52 overflow-y-auto whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 text-sm text-zinc-700 leading-6">
        {String(payload.synopsis ?? "")}
      </div>
    );
  return (
    <div className="mt-3 rounded-lg bg-zinc-50 p-3">
      <p className="font-medium text-sm">{String(payload.title ?? item.label)}</p>
      <p className="mt-1 whitespace-pre-wrap text-xs text-zinc-600 leading-5">
        {String(payload.synopsis ?? "")}
      </p>
    </div>
  );
}
