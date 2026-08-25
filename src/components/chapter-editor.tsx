// biome-ignore-all lint: correctness/useExhaustiveDependencies Floating UI callback refs are intentionally attached during render.
"use client";

import {
  autoUpdate,
  FloatingPortal,
  flip,
  offset,
  safePolygon,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useHover,
  useInteractions,
  useRole,
} from "@floating-ui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlignLeft,
  ArrowDown,
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Eye,
  FilePenLine,
  FileText,
  History,
  ListChecks,
  ListTree,
  LoaderCircle,
  type LucideIcon,
  Pencil,
  Pilcrow,
  Plus,
  Redo2,
  RefreshCw,
  Save,
  Sparkles,
  Square,
  Trash2,
  Undo2,
  Users,
  WandSparkles,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { CreativeAssistant } from "@/components/creative-assistant";
import { ResizablePanel } from "@/components/resizable-panel";
import {
  Button,
  ConfirmDialog,
  Input,
  Label,
  Modal,
  MultiSelect,
  Select,
  Switch,
  Textarea,
  Tooltip,
} from "@/components/ui";
import { api } from "@/lib/client";
import {
  type Block,
  type BlockType,
  type ChapterDetail,
  type Entity,
  getBlockContent,
  type TaskType,
} from "@/lib/types";
import { cn } from "@/lib/utils";

type GenerateMode = "content" | "checkpoint" | "blockSynopsis" | "chapterSynopsis";
interface GenerateTarget {
  mode: GenerateMode;
  block?: Block;
}
type EditorView = "edit" | "outline" | "read";
type ContextSourceMode = "ignore" | "synopsis" | "content";
type AdjacentBlockMode = "inherit" | "synopsis" | "content";
interface ContextOptions {
  includeBlockSynopsis: boolean;
  includeChapterSynopsis: boolean;
  chapterBlocks: ContextSourceMode;
  adjacentBlocks: AdjacentBlockMode;
  previousChapter: ContextSourceMode;
  nextChapter: ContextSourceMode;
  checkpointFullRebuild: boolean;
}

const DEFAULT_CONTEXT_OPTIONS: ContextOptions = {
  includeBlockSynopsis: true,
  includeChapterSynopsis: true,
  chapterBlocks: "synopsis",
  adjacentBlocks: "content",
  previousChapter: "ignore",
  nextChapter: "ignore",
  checkpointFullRebuild: false,
};

const EDITOR_VIEW_STORAGE_KEY = "animaforge:chapter-editor-view";

function defaultContextOptions(target: GenerateTarget, blocks: Block[]): ContextOptions {
  const options = { ...DEFAULT_CONTEXT_OPTIONS };
  if (target.mode !== "content" || !target.block) return options;
  const orderedBlocks = [...blocks].sort((left, right) => left.sortOrder - right.sortOrder);
  if (target.block.id === orderedBlocks[0]?.id) options.previousChapter = "synopsis";
  if (target.block.id === orderedBlocks.at(-1)?.id) options.nextChapter = "synopsis";
  return options;
}

const BLOCK_TYPE_OPTIONS: { value: BlockType; icon: LucideIcon }[] = [
  { value: "text", icon: FileText },
  { value: "checkpoint", icon: ListChecks },
];

const characterSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function countCharacters(value: string) {
  let count = 0;
  for (const { segment } of characterSegmenter.segment(value)) {
    if (!/^\s+$/u.test(segment)) count += 1;
  }
  return count;
}

export function ChapterEditor({ chapterId }: { chapterId: string }) {
  const t = useTranslations("Chapter");
  const entitiesT = useTranslations("Entities");
  const common = useTranslations("Common");
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["chapter", chapterId],
    queryFn: () => api<ChapterDetail>(`/api/chapters/${chapterId}`),
  });
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<EditorView>("edit");
  const [rightPanel, setRightPanel] = useState<"chapter" | "assistant">("chapter");
  const [saveState, setSaveState] = useState<"saved" | "dirty" | "saving" | "error">("saved");
  const [chapterDraft, setChapterDraft] = useState<{ title: string; synopsis: string } | null>(
    null,
  );
  const [streamingIds, setStreamingIds] = useState<Set<string>>(new Set());
  const [generation, setGeneration] = useState<GenerateTarget | null>(null);
  const [entityDialogOpen, setEntityDialogOpen] = useState(false);
  const [entityModeDraft, setEntityModeDraft] = useState<"all" | "selected">("selected");
  const [entityIdsDraft, setEntityIdsDraft] = useState<string[]>([]);
  const [editingEntity, setEditingEntity] = useState<Entity | null>(null);
  const [entityForm, setEntityForm] = useState({ name: "", description: "" });
  const [synopsisBlock, setSynopsisBlock] = useState<Block | null>(null);
  const [deleteBlock, setDeleteBlock] = useState<Block | null>(null);
  const [deleteSwipe, setDeleteSwipe] = useState<{ block: Block; swipeId: string } | null>(null);
  const [undoStack, setUndoStack] = useState<Block[][]>([]);
  const [redoStack, setRedoStack] = useState<Block[][]>([]);
  const saveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const pendingContentSaves = useRef(new Map<string, string>());
  const activeContentSaves = useRef(new Set<string>());
  const generationControllers = useRef(new Map<string, AbortController>());

  // The query result is an external cache; mirror it into the editor's undoable local state.
  useEffect(() => {
    if (!query.data) return;
    setBlocks(query.data.blocks);
  }, [query.data]);
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(EDITOR_VIEW_STORAGE_KEY);
    } catch {
      return;
    }
    if (saved !== "edit" && saved !== "outline" && saved !== "read") return;
    const frame = window.requestAnimationFrame(() => setView(saved));
    return () => window.cancelAnimationFrame(frame);
  }, []);
  useEffect(
    () => () => {
      saveTimers.current.forEach(clearTimeout);
      generationControllers.current.forEach((controller) => controller.abort());
    },
    [],
  );

  const refresh = useCallback(
    () => client.invalidateQueries({ queryKey: ["chapter", chapterId] }),
    [client, chapterId],
  );
  const currentDetail = useMemo(
    () =>
      query.data
        ? {
            ...query.data,
            chapter: chapterDraft ? { ...query.data.chapter, ...chapterDraft } : query.data.chapter,
            blocks,
          }
        : null,
    [query.data, chapterDraft, blocks],
  );
  const modelOptions = useMemo(
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

  const selectView = (next: EditorView) => {
    setView(next);
    if (
      next === "outline" &&
      blocks.find((block) => block.id === selectedId)?.type === "checkpoint"
    )
      setSelectedId(null);
    try {
      window.localStorage.setItem(EDITOR_VIEW_STORAGE_KEY, next);
    } catch {
      /* The editor still works when storage is unavailable. */
    }
  };

  const mutateBlock = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api<Block>(`/api/blocks/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: (block) =>
      setBlocks((items) => items.map((item) => (item.id === block.id ? block : item))),
    onError: (error) => {
      setSaveState("error");
      toast.error(error.message);
    },
  });
  const addBlock = useMutation({
    mutationFn: (body: { type?: BlockType; beforeId?: string; afterId?: string }) =>
      api<Block>(`/api/chapters/${chapterId}/blocks`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: (block) => {
      refresh();
      setSelectedId(block.id);
    },
    onError: (error) => toast.error(error.message),
  });
  const removeBlock = useMutation({
    mutationFn: (id: string) => api(`/api/blocks/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      refresh();
      setDeleteBlock(null);
      setSelectedId(null);
    },
    onError: (error) => toast.error(error.message),
  });
  const removeSwipe = useMutation({
    mutationFn: (id: string) => api<Block>(`/api/swipes/${id}`, { method: "DELETE" }),
    onSuccess: (block) => {
      setBlocks((items) => items.map((item) => (item.id === block.id ? block : item)));
      setDeleteSwipe(null);
    },
    onError: (error) => toast.error(error.message),
  });
  const updateChapter = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<ChapterDetail["chapter"]>(`/api/chapters/${chapterId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: (updated, body) => {
      if (body.title !== undefined || body.synopsis !== undefined)
        setChapterDraft((current) => ({
          title: body.title !== undefined ? updated.title : (current?.title ?? updated.title),
          synopsis:
            body.synopsis !== undefined
              ? updated.synopsis
              : (current?.synopsis ?? updated.synopsis),
        }));
      setSaveState("saved");
      refresh();
    },
    onError: (error) => {
      setSaveState("error");
      toast.error(error.message);
    },
  });
  const updateEntity = useMutation({
    mutationFn: () =>
      api<Entity>(`/api/entities/${editingEntity?.id}`, {
        method: "PATCH",
        body: JSON.stringify(entityForm),
      }),
    onSuccess: () => {
      setEditingEntity(null);
      refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  function snapshot() {
    setUndoStack((items) => [...items.slice(-49), structuredClone(blocks)]);
    setRedoStack([]);
  }

  async function flushContentSave(blockId: string) {
    const existing = saveTimers.current.get(blockId);
    if (existing) clearTimeout(existing);
    saveTimers.current.delete(blockId);
    if (activeContentSaves.current.has(blockId) || streamingIds.has(blockId)) return;

    const content = pendingContentSaves.current.get(blockId);
    if (content === undefined) return;
    pendingContentSaves.current.delete(blockId);
    activeContentSaves.current.add(blockId);
    setSaveState("saving");

    try {
      await api(`/api/blocks/${blockId}`, { method: "PATCH", body: JSON.stringify({ content }) });
      activeContentSaves.current.delete(blockId);
      if (pendingContentSaves.current.has(blockId) && !saveTimers.current.has(blockId))
        void flushContentSave(blockId);
      else if (!activeContentSaves.current.size && !pendingContentSaves.current.size) {
        setSaveState("saved");
        refresh();
      } else if (!activeContentSaves.current.size) setSaveState("dirty");
    } catch (error) {
      activeContentSaves.current.delete(blockId);
      if (!pendingContentSaves.current.has(blockId))
        pendingContentSaves.current.set(blockId, content);
      setSaveState("error");
      toast.error(error instanceof Error ? error.message : t("autoSaveFailed"));
    }
  }

  function scheduleContentSave(blockId: string, content: string) {
    const existing = saveTimers.current.get(blockId);
    if (existing) clearTimeout(existing);
    pendingContentSaves.current.set(blockId, content);
    if (!activeContentSaves.current.size) setSaveState("dirty");
    saveTimers.current.set(
      blockId,
      setTimeout(() => void flushContentSave(blockId), 1200),
    );
  }

  function editContent(blockId: string, content: string) {
    snapshot();
    setBlocks((items) =>
      items.map((block) =>
        block.id === blockId
          ? {
              ...block,
              swipes: block.swipes.map((swipe) =>
                swipe.id === block.currentSwipeId ? { ...swipe, content } : swipe,
              ),
            }
          : block,
      ),
    );
    scheduleContentSave(blockId, content);
  }

  function editSynopsis(blockId: string, synopsis: string) {
    snapshot();
    setBlocks((items) =>
      items.map((block) => (block.id === blockId ? { ...block, synopsis } : block)),
    );
    setSaveState("dirty");
  }

  async function saveSynopsis(blockId: string, synopsis: string) {
    setSaveState("saving");
    try {
      await mutateBlock.mutateAsync({ id: blockId, body: { synopsis } });
      setSaveState("saved");
      refresh();
    } catch {
      // The mutation reports the save error and keeps the local draft available.
    }
  }

  async function restoreHistory(direction: "undo" | "redo") {
    const source = direction === "undo" ? undoStack : redoStack;
    const target = source.at(-1);
    if (!target) return;
    const current = structuredClone(blocks);
    if (direction === "undo") {
      setUndoStack(source.slice(0, -1));
      setRedoStack((items) => [...items, current]);
    } else {
      setRedoStack(source.slice(0, -1));
      setUndoStack((items) => [...items, current]);
    }
    setBlocks(target);
    setSaveState("saving");
    await Promise.all(
      target
        .filter((block) => block.type === "text")
        .map((block) =>
          api(`/api/blocks/${block.id}`, {
            method: "PATCH",
            body: JSON.stringify({ content: getBlockContent(block), synopsis: block.synopsis }),
          }),
        ),
    );
    setSaveState("saved");
    refresh();
  }

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="dialog"]',
        )
      )
        return;
      if (event.key.toLowerCase() === "z") {
        event.preventDefault();
        restoreHistory(event.shiftKey ? "redo" : "undo");
      }
      if (event.key.toLowerCase() === "y") {
        event.preventDefault();
        restoreHistory("redo");
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
    // Keyboard listener intentionally tracks the latest local history.
  }, [undoStack, redoStack, blocks]);

  async function moveBlock(block: Block, move: "up" | "down", withinType = false) {
    snapshot();
    const index = blocks.findIndex((item) => item.id === block.id);
    const visibleBlocks = withinType ? blocks.filter((item) => item.type === block.type) : blocks;
    const visibleIndex = visibleBlocks.findIndex((item) => item.id === block.id);
    const target = visibleBlocks[visibleIndex + (move === "up" ? -1 : 1)];
    if (!target) return;
    const targetIndex = blocks.findIndex((item) => item.id === target.id);
    const steps = Math.abs(targetIndex - index);
    const optimistic = [...blocks];
    optimistic.splice(index, 1);
    optimistic.splice(targetIndex, 0, block);
    setBlocks(optimistic.map((item, sortOrder) => ({ ...item, sortOrder })));
    for (let step = 0; step < steps; step += 1) {
      await api<Block>(`/api/blocks/${block.id}`, {
        method: "PATCH",
        body: JSON.stringify({ move }),
      });
    }
    refresh();
  }

  async function switchSwipe(block: Block, direction: -1 | 1) {
    const index = block.swipes.findIndex((swipe) => swipe.id === block.currentSwipeId);
    const target = block.swipes[index + direction];
    if (!target) return;
    const updated = await mutateBlock.mutateAsync({
      id: block.id,
      body: { currentSwipeId: target.id },
    });
    setBlocks((items) => items.map((item) => (item.id === updated.id ? updated : item)));
    refresh();
  }

  if (query.isLoading)
    return (
      <div className="flex h-full items-center justify-center bg-zinc-50">
        <LoaderCircle className="size-5 animate-spin text-zinc-400" />
      </div>
    );
  if (!currentDetail)
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        {t("loadFailed")}
      </div>
    );
  const { chapter, project } = currentDetail;
  const alwaysIncludedEntityIds = currentDetail.allEntities
    .filter((entity) => entity.alwaysInclude)
    .map((entity) => entity.id);
  const selectedEntityIdsDraft = [...new Set([...alwaysIncludedEntityIds, ...entityIdsDraft])];
  const visibleBlocks =
    view === "outline" ? blocks.filter((block) => block.type === "text") : blocks;
  const selectedBlock = blocks.find((block) => block.id === selectedId);
  const selectedBlockNumber = selectedBlock
    ? blocks.filter(
        (block) => block.type === selectedBlock.type && block.sortOrder <= selectedBlock.sortOrder,
      ).length
    : 0;
  const currentAssistantReference = selectedBlock
    ? {
        type: "block" as const,
        id: selectedBlock.id,
        label:
          selectedBlock.type === "checkpoint"
            ? `${chapter.title}#${t("checkpoint")} ${selectedBlockNumber}`
            : `${chapter.title}#${selectedBlockNumber}`,
        description:
          selectedBlock.type === "checkpoint"
            ? `${t("checkpoint")} ${String(selectedBlockNumber).padStart(2, "0")}`
            : `Text ${String(selectedBlockNumber).padStart(2, "0")}`,
      }
    : undefined;

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-zinc-50">
      <div className="relative min-h-0 min-w-0 flex-1">
        <div className="absolute top-3 right-4 z-20 flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white/95 p-1.5 shadow-md backdrop-blur">
          <span
            className={cn(
              "mr-1 flex items-center gap-1 px-1 text-[11px]",
              saveState === "error" ? "text-red-500" : "text-zinc-400",
            )}
          >
            {saveState === "saving" ? (
              <LoaderCircle className="size-3 animate-spin" />
            ) : saveState === "error" ? (
              <CircleAlert className="size-3" />
            ) : saveState === "dirty" ? (
              <Save className="size-3" />
            ) : (
              <Check className="size-3" />
            )}
            {saveState === "saving"
              ? t("saving")
              : saveState === "error"
                ? t("saveFailed")
                : saveState === "dirty"
                  ? t("pendingSave")
                  : t("saved")}
          </span>
          <Button
            variant="ghost"
            size="icon"
            disabled={!undoStack.length}
            onClick={() => restoreHistory("undo")}
            aria-label={t("undo")}
          >
            <Undo2 className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={!redoStack.length}
            onClick={() => restoreHistory("redo")}
            aria-label={t("redo")}
          >
            <Redo2 className="size-3.5" />
          </Button>
          <div className="mx-0.5 h-5 w-px bg-zinc-200" />
          <div className="flex rounded-lg bg-zinc-100 p-0.5">
            <button
              onClick={() => selectView("edit")}
              className={cn(
                "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs",
                view === "edit" ? "bg-white font-medium shadow-sm" : "text-zinc-500",
              )}
            >
              <FilePenLine className="size-3.5" />
              {t("editView")}
            </button>
            <button
              onClick={() => selectView("outline")}
              className={cn(
                "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs",
                view === "outline" ? "bg-white font-medium shadow-sm" : "text-zinc-500",
              )}
            >
              <ListTree className="size-3.5" />
              {t("outlineView")}
            </button>
            <button
              onClick={() => selectView("read")}
              className={cn(
                "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs",
                view === "read" ? "bg-white font-medium shadow-sm" : "text-zinc-500",
              )}
            >
              <Eye className="size-3.5" />
              {t("readView")}
            </button>
          </div>
        </div>
        <main
          onClick={() => view !== "read" && setSelectedId(null)}
          className={cn(
            "scrollbar-thin h-full min-w-0 overflow-y-auto px-4 pt-20 pb-8 sm:px-8 xl:px-12",
            view === "read" ? "bg-white" : "bg-zinc-50/50",
          )}
        >
          {view === "read" ? (
            <ReadingView detail={currentDetail} />
          ) : (
            <div className="mx-auto max-w-4xl">
              <div className="mb-7">
                <input
                  aria-label={t("chapterTitle")}
                  className="focus-ring -mx-2 block w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 font-semibold text-3xl leading-tight tracking-tight hover:bg-white/70 focus:bg-white"
                  value={chapter.title}
                  onChange={(event) => {
                    setChapterDraft((current) => ({
                      title: event.target.value,
                      synopsis: current?.synopsis ?? chapter.synopsis,
                    }));
                    setSaveState("dirty");
                  }}
                  onBlur={(event) => {
                    setSaveState("saving");
                    updateChapter.mutate({ title: event.target.value });
                  }}
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing) return;
                    if (event.key === "Enter") {
                      event.preventDefault();
                      event.currentTarget.blur();
                    }
                  }}
                />
              </div>
              {!visibleBlocks.length ? (
                <AddPlaceholder onAdd={(type) => addBlock.mutate({ type })} />
              ) : (
                <>
                  {visibleBlocks.map((block, index) => (
                    <BlockCard
                      key={block.id}
                      block={block}
                      index={index}
                      typeIndex={
                        blocks.filter(
                          (item) => item.type === block.type && item.sortOrder <= block.sortOrder,
                        ).length - 1
                      }
                      total={visibleBlocks.length}
                      outline={view === "outline"}
                      selected={selectedId === block.id}
                      streaming={streamingIds.has(block.id)}
                      onSelect={() => setSelectedId(block.id)}
                      onContent={(content) => editContent(block.id, content)}
                      onContentBlur={() => void flushContentSave(block.id)}
                      onSynopsisContent={(synopsis) => editSynopsis(block.id, synopsis)}
                      onSynopsisBlur={() => void saveSynopsis(block.id, block.synopsis)}
                      onAddBefore={(type) => addBlock.mutate({ type, beforeId: block.id })}
                      onAddAfter={(type) => addBlock.mutate({ type, afterId: block.id })}
                      onMove={(direction) => moveBlock(block, direction, view === "outline")}
                      onGenerate={() =>
                        setGeneration({
                          mode: block.type === "checkpoint" ? "checkpoint" : "content",
                          block,
                        })
                      }
                      onStop={() => generationControllers.current.get(block.id)?.abort()}
                      onSynopsis={() => setSynopsisBlock(block)}
                      onClearStale={() =>
                        mutateBlock.mutate({ id: block.id, body: { stale: false } })
                      }
                      onDelete={() => setDeleteBlock(block)}
                      onSwitchSwipe={(direction) => switchSwipe(block, direction)}
                      onDeleteSwipe={() => setDeleteSwipe({ block, swipeId: block.currentSwipeId })}
                    />
                  ))}
                  <AddPlaceholder
                    compact
                    onAdd={(type) => addBlock.mutate({ type, afterId: blocks.at(-1)?.id })}
                  />
                </>
              )}
            </div>
          )}
        </main>
      </div>
      <ResizablePanel storageKey="chapter" className="hidden flex-col lg:flex">
        <div className="flex h-12 shrink-0 items-end border-zinc-200 border-b px-3">
          <button
            type="button"
            onClick={() => setRightPanel("chapter")}
            className={cn(
              "-mb-px flex h-10 flex-1 items-center justify-center gap-1.5 border-b-2 text-xs transition-colors",
              rightPanel === "chapter"
                ? "border-zinc-950 font-medium text-zinc-950"
                : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-800",
            )}
          >
            <FileText className="size-3.5" />
            {t("chapterTab")}
          </button>
          <button
            type="button"
            onClick={() => setRightPanel("assistant")}
            className={cn(
              "-mb-px flex h-10 flex-1 items-center justify-center gap-1.5 border-b-2 text-xs transition-colors",
              rightPanel === "assistant"
                ? "border-zinc-950 font-medium text-zinc-950"
                : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-800",
            )}
          >
            <Sparkles className="size-3.5" />
            {t("assistantTab")}
          </button>
        </div>
        {rightPanel === "chapter" ? (
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-4">
            <div className="mb-5">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-semibold text-xs text-zinc-400 uppercase tracking-wider">
                  {t("chapterSynopsis")}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setGeneration({ mode: "chapterSynopsis" })}
                >
                  <Sparkles className="size-3.5" />
                </Button>
              </div>
              <Textarea
                className="min-h-36 border-transparent bg-zinc-50 text-xs leading-5"
                value={chapter.synopsis}
                onChange={(event) => {
                  setChapterDraft((current) => ({
                    title: current?.title ?? chapter.title,
                    synopsis: event.target.value,
                  }));
                  setSaveState("dirty");
                }}
                onBlur={(event) => {
                  setSaveState("saving");
                  updateChapter.mutate({ synopsis: event.target.value });
                }}
                placeholder={t("chapterSynopsisPlaceholder")}
              />
            </div>
            <div className="border-zinc-100 border-t pt-5">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2 font-semibold text-xs text-zinc-400 uppercase tracking-wider">
                  <Users className="size-3.5" />
                  {t("relatedEntities")}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setEntityModeDraft(chapter.entityMode);
                    setEntityIdsDraft(chapter.entityIds);
                    setEntityDialogOpen(true);
                  }}
                  aria-label={t("editRelatedEntities")}
                >
                  <Pencil className="size-3.5" />
                </Button>
              </div>
              {chapter.entityMode === "all" ? (
                <p className="text-xs text-zinc-500">{t("allEntitiesShort")}</p>
              ) : currentDetail.entities.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {currentDetail.entities.map((entity) => (
                    <button
                      key={entity.id}
                      type="button"
                      onClick={() => {
                        setEditingEntity(entity);
                        setEntityForm({
                          name: entity.name,
                          description: entity.description,
                        });
                      }}
                      className="focus-ring max-w-full truncate rounded-md bg-zinc-100 px-2 py-1 font-medium text-xs text-zinc-700 hover:bg-zinc-200"
                    >
                      {entity.name}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-zinc-400">{t("noRelatedEntities")}</p>
              )}
            </div>
            <div className="mt-5 border-zinc-100 border-t pt-5">
              <h3 className="font-semibold text-xs text-zinc-400 uppercase tracking-wider">
                {t("currentContext")}
              </h3>
              <ContextList
                detail={currentDetail}
                selected={blocks.find((block) => block.id === selectedId)}
              />
            </div>
            <div className="mt-6 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
              <div className="flex items-center gap-2 font-medium text-xs">
                <Bot className="size-3.5" />
                {t("taskModels")}
              </div>
              {(["writing", "summary"] as TaskType[]).map((task) => {
                const modelId =
                  project.modelOverrides[task] ||
                  currentDetail.settings.taskModels[task] ||
                  currentDetail.settings.globalDefaultModel;
                const model = modelOptions.find((item) => item.value === modelId);
                return (
                  <div key={task} className="mt-3 flex items-center justify-between text-xs">
                    <span className="text-zinc-500">
                      {task === "writing" ? t("writing") : t("summary")}
                    </span>
                    <span className="max-w-36 truncate font-medium">
                      {model?.label || common("notConfigured")}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1">
            <CreativeAssistant
              projectId={project.id}
              scope="chapter"
              contextId={chapter.id}
              currentReference={currentAssistantReference}
              embedded
              onApplied={(item) => {
                if (
                  item.action === "update_chapter_title" &&
                  typeof item.payload.title === "string"
                )
                  setChapterDraft((current) => ({
                    title: item.payload.title as string,
                    synopsis: current?.synopsis ?? chapter.synopsis,
                  }));
                if (
                  item.action === "update_chapter_synopsis" &&
                  typeof item.payload.synopsis === "string"
                )
                  setChapterDraft((current) => ({
                    title: current?.title ?? chapter.title,
                    synopsis: item.payload.synopsis as string,
                  }));
                refresh();
              }}
            />
          </div>
        )}
      </ResizablePanel>
      <Modal
        open={entityDialogOpen}
        onOpenChange={(open) => !updateChapter.isPending && setEntityDialogOpen(open)}
        title={t("relatedEntitiesTitle")}
        width="max-w-md"
      >
        <div className="space-y-5 p-5">
          <Switch
            checked={entityModeDraft === "all"}
            onChange={(checked) => setEntityModeDraft(checked ? "all" : "selected")}
            label={t("allEntities")}
            description={t("allEntitiesDescription")}
          />
          {entityModeDraft === "selected" ? (
            <div className="border-zinc-100 border-t pt-4">
              <p className="mb-3 font-semibold text-xs text-zinc-400 uppercase tracking-wider">
                {t("selectEntities")}
              </p>
              <MultiSelect
                values={selectedEntityIdsDraft}
                lockedValues={alwaysIncludedEntityIds}
                onChange={(entityIds) =>
                  setEntityIdsDraft([
                    ...new Set([
                      ...entityIds.filter((entityId) =>
                        alwaysIncludedEntityIds.every((lockedId) => lockedId !== entityId),
                      ),
                      ...entityIdsDraft.filter((entityId) =>
                        alwaysIncludedEntityIds.includes(entityId),
                      ),
                    ]),
                  ])
                }
                options={currentDetail.allEntities.map((entity) => {
                  const typeLabel = entity.type.systemKey
                    ? entitiesT(`systemTypes.${entity.type.systemKey}` as never)
                    : entity.type.name;
                  return {
                    value: entity.id,
                    label: entity.name,
                    description: entity.alwaysInclude
                      ? `${typeLabel} · ${entitiesT("alwaysIncluded")}`
                      : typeLabel,
                  };
                })}
                emptyLabel={t("noProjectEntities")}
              />
            </div>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-zinc-100 border-t p-3">
          <Button
            variant="secondary"
            disabled={updateChapter.isPending}
            onClick={() => setEntityDialogOpen(false)}
          >
            {common("cancel")}
          </Button>
          <Button
            loading={updateChapter.isPending}
            onClick={() =>
              updateChapter.mutate(
                { entityMode: entityModeDraft, entityIds: entityIdsDraft },
                { onSuccess: () => setEntityDialogOpen(false) },
              )
            }
          >
            {common("confirm")}
          </Button>
        </div>
      </Modal>
      <Modal
        open={Boolean(editingEntity)}
        onOpenChange={(open) => {
          if (!open && !updateEntity.isPending) setEditingEntity(null);
        }}
        title={t("editEntity")}
        description={t("editEntityDescription")}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (editingEntity) updateEntity.mutate();
          }}
        >
          <div className="space-y-4 p-5">
            <div>
              <Label>{t("entityName")}</Label>
              <Input
                autoFocus
                required
                value={entityForm.name}
                onChange={(event) =>
                  setEntityForm((current) => ({ ...current, name: event.target.value }))
                }
              />
            </div>
            <div>
              <Label>{t("entityDescription")}</Label>
              <Textarea
                className="min-h-40"
                value={entityForm.description}
                onChange={(event) =>
                  setEntityForm((current) => ({ ...current, description: event.target.value }))
                }
                placeholder={t("entityDescriptionPlaceholder")}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 border-zinc-100 border-t p-3">
            <Button
              type="button"
              variant="secondary"
              disabled={updateEntity.isPending}
              onClick={() => setEditingEntity(null)}
            >
              {common("cancel")}
            </Button>
            <Button type="submit" loading={updateEntity.isPending}>
              {t("saveEntity")}
            </Button>
          </div>
        </form>
      </Modal>
      <GenerationDialog
        open={Boolean(generation)}
        target={generation}
        detail={currentDetail}
        modelOptions={modelOptions}
        onClose={() => setGeneration(null)}
        onStreamState={(id, active) =>
          setStreamingIds((set) => {
            const next = new Set(set);
            if (active) next.add(id);
            else next.delete(id);
            return next;
          })
        }
        onRequestController={(id, controller) => {
          if (controller) generationControllers.current.set(id, controller);
          else generationControllers.current.delete(id);
        }}
        onLocalText={(blockId, text) =>
          setBlocks((items) =>
            items.map((block) =>
              block.id === blockId
                ? {
                    ...block,
                    swipes: block.swipes.map((swipe) =>
                      swipe.id === block.currentSwipeId ? { ...swipe, content: text } : swipe,
                    ),
                  }
                : block,
            ),
          )
        }
        onComplete={async (target, text, replaceWithNewSwipe) => {
          if (target.mode === "chapterSynopsis")
            await updateChapter.mutateAsync({ synopsis: text });
          else if (target.mode === "blockSynopsis" && target.block) {
            await mutateBlock.mutateAsync({ id: target.block.id, body: { synopsis: text } });
          } else if (target.block) {
            const updated = await mutateBlock.mutateAsync({
              id: target.block.id,
              body: {
                content: text,
                newSwipe: replaceWithNewSwipe,
                ...(target.mode === "checkpoint" ? { stale: false } : {}),
              },
            });
            setBlocks((items) => items.map((item) => (item.id === updated.id ? updated : item)));
          }
          refresh();
        }}
      />
      <SynopsisDialog
        block={synopsisBlock}
        onClose={() => setSynopsisBlock(null)}
        onSave={async (value) => {
          if (!synopsisBlock) return;
          await mutateBlock.mutateAsync({ id: synopsisBlock.id, body: { synopsis: value } });
          setSynopsisBlock(null);
          refresh();
        }}
        onGenerate={() => {
          if (synopsisBlock) {
            setSynopsisBlock(null);
            setGeneration({ mode: "blockSynopsis", block: synopsisBlock });
          }
        }}
      />
      <ConfirmDialog
        open={Boolean(deleteBlock)}
        onOpenChange={(open) => !open && setDeleteBlock(null)}
        title={t("deleteBlockTitle")}
        description={t("deleteBlockDescription")}
        onConfirm={() => deleteBlock && removeBlock.mutate(deleteBlock.id)}
        loading={removeBlock.isPending}
      />
      <ConfirmDialog
        open={Boolean(deleteSwipe)}
        onOpenChange={(open) => !open && setDeleteSwipe(null)}
        title={t("deleteSwipeTitle")}
        description={t("deleteSwipeDescription")}
        onConfirm={() => deleteSwipe && removeSwipe.mutate(deleteSwipe.swipeId)}
        loading={removeSwipe.isPending}
      />
    </div>
  );
}

function AddPlaceholder({
  compact,
  onAdd,
}: {
  compact?: boolean;
  onAdd: (type: BlockType) => void;
}) {
  const t = useTranslations("Chapter");
  return (
    <div
      className={cn(
        "group flex items-center gap-2",
        compact
          ? "mt-3"
          : "min-h-52 justify-center rounded-xl border border-zinc-300 border-dashed bg-white",
      )}
    >
      <span
        className={cn(
          "h-px flex-1 bg-zinc-200 opacity-0 transition group-hover:opacity-100",
          !compact && "hidden",
        )}
      />
      <div className="flex items-center gap-1 rounded-lg border border-zinc-300 border-dashed bg-white p-1 text-xs text-zinc-400 transition hover:border-zinc-400 hover:text-zinc-700">
        <button
          className="flex items-center gap-1.5 rounded-md px-3 py-2 hover:bg-zinc-50"
          onClick={() => onAdd("text")}
        >
          <Plus className="size-3.5" />
          {t("addTextBlock")}
        </button>
        <span className="h-4 w-px bg-zinc-200" />
        <button
          className="flex items-center gap-1.5 rounded-md px-3 py-2 hover:bg-amber-50 hover:text-amber-700"
          onClick={() => onAdd("checkpoint")}
        >
          <ListChecks className="size-3.5" />
          {t("addCheckpoint")}
        </button>
      </div>
      <span
        className={cn(
          "h-px flex-1 bg-zinc-200 opacity-0 transition group-hover:opacity-100",
          !compact && "hidden",
        )}
      />
    </div>
  );
}

function BlockCard({
  block,
  index,
  typeIndex,
  total,
  outline,
  selected,
  streaming,
  onSelect,
  onContent,
  onContentBlur,
  onSynopsisContent,
  onSynopsisBlur,
  onAddBefore,
  onAddAfter,
  onMove,
  onGenerate,
  onStop,
  onSynopsis,
  onClearStale,
  onDelete,
  onSwitchSwipe,
  onDeleteSwipe,
}: {
  block: Block;
  index: number;
  typeIndex: number;
  total: number;
  outline: boolean;
  selected: boolean;
  streaming: boolean;
  onSelect: () => void;
  onContent: (value: string) => void;
  onContentBlur: () => void;
  onSynopsisContent: (value: string) => void;
  onSynopsisBlur: () => void;
  onAddBefore: (type: BlockType) => void;
  onAddAfter: (type: BlockType) => void;
  onMove: (direction: "up" | "down") => void;
  onGenerate: () => void;
  onStop: () => void;
  onSynopsis: () => void;
  onClearStale: () => void;
  onDelete: () => void;
  onSwitchSwipe: (direction: -1 | 1) => void;
  onDeleteSwipe: () => void;
}) {
  const t = useTranslations("Chapter");
  const common = useTranslations("Common");
  const content = getBlockContent(block);
  const characterCount = countCharacters(content);
  const showSynopsis = outline && block.type === "text";
  const value = showSynopsis ? block.synopsis : content;
  const swipeIndex = block.swipes.findIndex((swipe) => swipe.id === block.currentSwipeId);
  return (
    <section
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      className={cn(
        "group relative mb-3 rounded-xl border bg-white transition",
        block.type === "checkpoint"
          ? "border-amber-200 bg-amber-50/40"
          : outline
            ? "border-zinc-300 border-l-[3px] border-l-zinc-500 bg-zinc-100/70"
            : "border-zinc-200",
        selected && "border-zinc-400 shadow-[0_0_0_1px_#d4d4d8,0_5px_20px_rgba(0,0,0,.05)]",
      )}
    >
      <div className="flex h-9 items-center justify-between border-zinc-100 border-b px-4">
        <div className="flex items-center gap-2">
          {block.type === "checkpoint" ? (
            <ListChecks className="size-3.5 text-amber-600" />
          ) : showSynopsis ? (
            <ListTree className="size-3.5 text-zinc-500" />
          ) : (
            <Pilcrow className="size-3.5 text-zinc-400" />
          )}
          <span
            className={cn(
              "font-mono text-[10px]",
              block.type === "checkpoint"
                ? "text-amber-600"
                : showSynopsis
                  ? "font-medium text-zinc-600"
                  : "text-zinc-400",
            )}
          >
            {block.type === "checkpoint"
              ? `${t("checkpoint")} ${String(typeIndex + 1).padStart(2, "0")}`
              : `Text ${String(typeIndex + 1).padStart(2, "0")}`}
          </span>
          {block.type === "checkpoint" && streaming ? (
            <span className="streaming-dot size-1.5 rounded-full bg-amber-500" />
          ) : null}
          {block.stale ? (
            <button
              onClick={(event) => {
                event.stopPropagation();
                onClearStale();
              }}
              className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 font-medium text-[10px] text-amber-700"
            >
              <RefreshCw className="size-2.5" />
              {t("stale")} · {t("clearStale")}
            </button>
          ) : null}
          {!outline && block.synopsis ? (
            <Tooltip label={block.synopsis}>
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onSynopsis();
                }}
                className="flex size-5 items-center justify-center text-zinc-400 hover:text-zinc-800"
              >
                <FileText className="size-3.5" />
              </button>
            </Tooltip>
          ) : null}
        </div>
        {streaming || characterCount || block.swipes.length > 1 ? (
          <div className="flex items-center gap-2 text-[10px] text-zinc-400">
            {characterCount ? (
              <span>{t("blockCharacterCount", { count: characterCount })}</span>
            ) : null}
            {block.swipes.length > 1 ? (
              <div className="flex items-center gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6"
                  disabled={swipeIndex <= 0 || streaming}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSwitchSwipe(-1);
                  }}
                >
                  <ChevronLeft className="size-3" />
                </Button>
                <History className="size-3" />
                {swipeIndex + 1} / {block.swipes.length}
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6"
                  disabled={swipeIndex >= block.swipes.length - 1 || streaming}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSwitchSwipe(1);
                  }}
                >
                  <ChevronRight className="size-3" />
                </Button>
              </div>
            ) : null}
            {streaming ? (
              <Tooltip label={t("stopGeneration")}>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6 text-red-500 hover:bg-red-50 hover:text-red-600"
                  aria-label={t("stopGeneration")}
                  onClick={(event) => {
                    event.stopPropagation();
                    onStop();
                  }}
                >
                  <Square className="size-3 fill-current" />
                </Button>
              </Tooltip>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="relative px-5 py-4">
        <textarea
          value={value}
          disabled={streaming}
          onChange={(event) =>
            showSynopsis ? onSynopsisContent(event.target.value) : onContent(event.target.value)
          }
          onBlur={showSynopsis ? onSynopsisBlur : onContentBlur}
          placeholder={
            showSynopsis
              ? t("outlinePlaceholder")
              : block.type === "checkpoint"
                ? t("checkpointPlaceholder")
                : t("textPlaceholder")
          }
          className={cn(
            "editor-textarea min-h-24 w-full resize-none bg-transparent text-[15px] text-zinc-800 leading-7 outline-none placeholder:text-zinc-300",
            showSynopsis && "min-h-16 text-sm text-zinc-700 leading-6 placeholder:text-zinc-400",
            block.type === "checkpoint" && "min-h-16 text-amber-950/80 text-sm leading-6",
          )}
        />
        {streaming ? (
          <span className="ml-0.5 inline-block h-5 w-0.5 animate-pulse bg-zinc-700" />
        ) : null}
      </div>
      {selected ? (
        <div
          className="absolute -bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 whitespace-nowrap rounded-lg border border-zinc-200 bg-white p-1 shadow-lg"
          onClick={(event) => event.stopPropagation()}
        >
          <BlockInsertMenu label={t("insertBefore")} onInsert={onAddBefore} />
          <BlockInsertMenu label={t("insertAfter")} onInsert={onAddAfter} />
          <span className="mx-1 h-4 w-px bg-zinc-200" />
          {!outline ? (
            <>
              {streaming ? (
                <ToolbarButton label={t("stopGeneration")} danger onClick={onStop}>
                  <Square className="size-3 fill-current" />
                </ToolbarButton>
              ) : (
                <ToolbarButton
                  label={
                    block.type === "checkpoint"
                      ? content
                        ? t("regenerateSummary")
                        : t("generateSummary")
                      : content
                        ? t("regenerate")
                        : t("generate")
                  }
                  onClick={onGenerate}
                >
                  {block.type === "checkpoint" ? (
                    <ListChecks className="size-3.5" />
                  ) : (
                    <WandSparkles className="size-3.5" />
                  )}
                </ToolbarButton>
              )}
              {block.type === "text" ? (
                <ToolbarButton label={t("synopsis")} disabled={streaming} onClick={onSynopsis}>
                  <AlignLeft className="size-3.5" />
                </ToolbarButton>
              ) : null}
            </>
          ) : null}
          <ToolbarButton
            label={common("moveUp")}
            disabled={index === 0}
            onClick={() => onMove("up")}
          >
            <ArrowUp className="size-3.5" />
          </ToolbarButton>
          <ToolbarButton
            label={common("moveDown")}
            disabled={index === total - 1}
            onClick={() => onMove("down")}
          >
            <ArrowDown className="size-3.5" />
          </ToolbarButton>
          {block.swipes.length > 1 ? (
            <ToolbarButton label={t("deleteHistory")} onClick={onDeleteSwipe}>
              <History className="size-3.5" />
            </ToolbarButton>
          ) : null}
          <ToolbarButton label={common("delete")} danger onClick={onDelete}>
            <Trash2 className="size-3.5" />
          </ToolbarButton>
        </div>
      ) : null}
    </section>
  );
}

function BlockInsertMenu({
  label,
  onInsert,
}: {
  label: string;
  onInsert: (type: BlockType) => void;
}) {
  const t = useTranslations("Chapter");
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: "top-start",
    whileElementsMounted: autoUpdate,
    middleware: [offset(6), flip(), shift({ padding: 8 })],
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useHover(context, { delay: { open: 80, close: 100 }, handleClose: safePolygon() }),
    useClick(context),
    useDismiss(context, { outsidePressEvent: "pointerdown" }),
    useRole(context, { role: "menu" }),
  ]);

  return (
    <>
      <button
        ref={refs.setReference}
        type="button"
        aria-label={t("insertBlock", { position: label })}
        aria-expanded={open}
        className={cn(
          "focus-ring flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-950",
          open && "bg-zinc-100 text-zinc-950",
        )}
        {...getReferenceProps()}
      >
        <Plus className="size-3.5" />
        <span>{label}</span>
        <ChevronDown className="size-3" />
      </button>
      {open ? (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            className="z-[80]"
            {...getFloatingProps()}
          >
            <div
              data-state="open"
              className="popover-panel w-40 rounded-lg border border-zinc-200 bg-white p-1 shadow-xl"
            >
              {BLOCK_TYPE_OPTIONS.map((option) => {
                const Icon = option.icon;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      onInsert(option.value);
                      setOpen(false);
                    }}
                    className="focus-ring flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950"
                  >
                    <Icon className="size-3.5 text-zinc-400" />
                    <span>{option.value === "text" ? t("textBlock") : t("checkpoint")}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </FloatingPortal>
      ) : null}
    </>
  );
}

function ToolbarButton({
  label,
  children,
  onClick,
  disabled,
  danger,
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-950 disabled:opacity-30",
        danger && "hover:bg-red-50 hover:text-red-600",
      )}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

function ReadingView({ detail }: { detail: ChapterDetail }) {
  const t = useTranslations("Chapter");
  const paragraphs = detail.blocks
    .filter((block) => block.type === "text")
    .flatMap((block) =>
      getBlockContent(block)
        .replace(/\r\n/g, "\n")
        .split("\n")
        .map((content, index) => ({ key: `${block.id}:${index}`, content: content.trim() })),
    )
    .filter((paragraph) => paragraph.content);
  return (
    <article className="mx-auto max-w-3xl pb-16">
      <h1 className="font-semibold text-3xl tracking-tight">{detail.chapter.title}</h1>
      <div className="mt-8 space-y-5">
        {paragraphs.length ? (
          paragraphs.map((paragraph) => (
            <p key={paragraph.key} className="indent-[2em] text-base text-zinc-800 leading-8">
              {paragraph.content}
            </p>
          ))
        ) : (
          <p className="py-20 text-center text-sm text-zinc-400">{t("noProse")}</p>
        )}
      </div>
    </article>
  );
}

function ContextList({ detail, selected }: { detail: ChapterDetail; selected?: Block }) {
  const t = useTranslations("Chapter");
  const siblingCount = selected
    ? detail.blocks.filter((block) => block.id !== selected.id).length
    : null;
  const items = [
    {
      label: t("projectInfo"),
      value:
        detail.project.synopsis || detail.project.proseStyle ? t("configured") : t("incomplete"),
      warning: !(detail.project.synopsis || detail.project.proseStyle),
    },
    {
      label: t("relatedEntities"),
      value: t("entityCount", { count: detail.entities.length }),
      warning: false,
    },
    {
      label: t("chapterSynopsis"),
      value: detail.chapter.synopsis ? t("configured") : t("notConfigured"),
      warning: !detail.chapter.synopsis,
    },
    {
      label: t("currentBlockSynopsis"),
      value: selected ? (selected.synopsis ? t("configured") : t("notConfigured")) : "—",
      warning: Boolean(selected && !selected.synopsis),
    },
    {
      label: t("surroundingBlocks"),
      value: siblingCount === null ? "—" : t("blockCount", { count: siblingCount }),
      warning: false,
    },
  ];
  return (
    <div className="mt-3 space-y-1">
      {items.map((item) => (
        <div
          key={item.label}
          className="flex items-center justify-between rounded-md px-2 py-2 text-xs hover:bg-zinc-50"
        >
          <span className="text-zinc-500">{item.label}</span>
          <span className={cn("font-medium", item.warning ? "text-amber-600" : "text-zinc-700")}>
            {item.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function GenerationDialog({
  open,
  target,
  detail,
  modelOptions,
  onClose,
  onStreamState,
  onRequestController,
  onLocalText,
  onComplete,
}: {
  open: boolean;
  target: GenerateTarget | null;
  detail: ChapterDetail;
  modelOptions: { value: string; label: string; description?: string }[];
  onClose: () => void;
  onStreamState: (id: string, active: boolean) => void;
  onRequestController: (id: string, controller: AbortController | null) => void;
  onLocalText: (blockId: string, text: string) => void;
  onComplete: (target: GenerateTarget, text: string, replaceWithNewSwipe: boolean) => Promise<void>;
}) {
  const t = useTranslations("Chapter");
  const common = useTranslations("Common");
  const [instructions, setInstructions] = useState("");
  const [options, setOptions] = useState<ContextOptions>(DEFAULT_CONTEXT_OPTIONS);
  const [modelId, setModelId] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [preview, setPreview] = useState("");
  const requestController = useRef<AbortController | null>(null);
  useEffect(() => () => requestController.current?.abort(), []);
  useEffect(() => {
    if (!target) return;
    const task: TaskType = target.mode === "content" ? "writing" : "summary";
    // Opening a different generation target intentionally resets the dialog form.
    setModelId(
      String(
        detail.project.modelOverrides[task] ||
          detail.settings.taskModels[task] ||
          detail.settings.globalDefaultModel ||
          "",
      ),
    );
    setInstructions("");
    setPreview("");
    setOptions(defaultContextOptions(target, detail.blocks));
  }, [
    target,
    detail.blocks,
    detail.project.modelOverrides,
    detail.settings.taskModels,
    detail.settings.globalDefaultModel,
  ]);

  const updateOptions = (updater: (current: ContextOptions) => ContextOptions) => {
    setOptions(updater);
  };

  const labels: Record<GenerateMode, string> = {
    content:
      target?.block && getBlockContent(target.block) ? t("regenerateText") : t("generateText"),
    checkpoint: t("generateCheckpoint"),
    blockSynopsis: t("generateBlockSynopsis"),
    chapterSynopsis: t("generateChapterSynopsis"),
  };
  async function run() {
    if (!target || !modelId) {
      toast.error(t("selectModelFirst"));
      return;
    }
    const priorCheckpoint =
      target.mode === "checkpoint" && target.block
        ? [...detail.blocks]
            .reverse()
            .find(
              (block) => block.type === "checkpoint" && block.sortOrder < target.block!.sortOrder,
            )
        : undefined;
    if (priorCheckpoint?.stale && !options.checkpointFullRebuild) return;
    setRunning(true);
    setPreview("");
    const blockId = target.block?.id;
    const controller = new AbortController();
    requestController.current = controller;
    if (blockId) onRequestController(blockId, controller);
    if (blockId) onStreamState(blockId, true);
    const oldContent = target.block ? getBlockContent(target.block) : "";
    if (target.mode === "content" || target.mode === "checkpoint") onLocalText(blockId!, "");
    const streamsIntoBlock = target.mode === "content" || target.mode === "checkpoint";
    if (streamsIntoBlock) onClose();
    let text = "";
    try {
      const response = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chapterId: detail.chapter.id,
          blockId,
          mode: target.mode,
          instructions,
          modelId,
          ...options,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || t("generationFailedStatus", { status: response.status }));
      }
      if (!response.body) throw new Error(t("noModelStream"));
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        if (target.mode === "content" || target.mode === "checkpoint") onLocalText(blockId!, text);
        else setPreview(text);
      }
      if (!text.trim()) throw new Error(t("emptyModelResponse"));
      await onComplete(target, text.trim(), Boolean(oldContent.trim()));
      if (!streamsIntoBlock) onClose();
    } catch (error) {
      if ((target.mode === "content" || target.mode === "checkpoint") && blockId)
        onLocalText(blockId, oldContent);
      if (!isAbortError(error))
        toast.error(error instanceof Error ? error.message : t("generationFailed"));
    } finally {
      if (requestController.current === controller) requestController.current = null;
      if (blockId) {
        onRequestController(blockId, null);
        onStreamState(blockId, false);
      }
      setRunning(false);
    }
  }

  if (!target) return null;
  const isContent = target.mode === "content";
  const isCheckpoint = target.mode === "checkpoint";
  const isRegeneration = Boolean(isContent && target.block && getBlockContent(target.block).trim());
  const priorCheckpoint =
    isCheckpoint && target.block
      ? [...detail.blocks]
          .reverse()
          .find((block) => block.type === "checkpoint" && block.sortOrder < target.block!.sortOrder)
      : undefined;
  const staleDependency = Boolean(priorCheckpoint?.stale && !options.checkpointFullRebuild);
  const checkpointContext = isCheckpoint
    ? [
        priorCheckpoint && !options.checkpointFullRebuild
          ? t("previousCheckpoint")
          : t("allPreviousProse"),
        ...(priorCheckpoint && !options.checkpointFullRebuild ? [t("proseAfterCheckpoint")] : []),
      ]
    : [];
  const sourceModeOptions = [
    { value: "ignore", label: t("contextModeIgnore") },
    { value: "synopsis", label: t("contextModeSynopsis") },
    { value: "content", label: t("contextModeContent") },
  ];
  const adjacentBlockModeOptions = [
    { value: "inherit", label: t("contextModeInherit") },
    { value: "synopsis", label: t("contextModeSynopsis") },
    { value: "content", label: t("contextModeContent") },
  ];
  const contextModeLabel = (
    scope: "chapterBlocks" | "adjacentBlocks" | "previousChapter" | "nextChapter",
    mode: ContextSourceMode | AdjacentBlockMode,
  ) => t(`${scope}Preview.${mode}`);
  const contextItems = [
    t("projectInfo"),
    t("relatedEntitiesCount", { count: detail.entities.length }),
    ...(detail.project.language.trim() || detail.settings.language.trim()
      ? [t("outputLanguage")]
      : []),
    ...(options.includeChapterSynopsis && detail.chapter.synopsis.trim()
      ? [t("chapterSynopsis")]
      : []),
    ...checkpointContext,
    ...(!isCheckpoint && options.includeBlockSynopsis && target.block?.synopsis
      ? [t("currentBlockSynopsis")]
      : []),
    ...(isContent && options.chapterBlocks !== "ignore"
      ? [contextModeLabel("chapterBlocks", options.chapterBlocks)]
      : []),
    ...(isContent ? [contextModeLabel("adjacentBlocks", options.adjacentBlocks)] : []),
    ...(isContent && options.previousChapter !== "ignore"
      ? [contextModeLabel("previousChapter", options.previousChapter)]
      : []),
    ...(isContent && options.nextChapter !== "ignore"
      ? [contextModeLabel("nextChapter", options.nextChapter)]
      : []),
    ...(isContent && instructions.trim() && target.block && getBlockContent(target.block)
      ? [t("oldText")]
      : []),
  ];
  return (
    <Modal
      open={open}
      onOpenChange={(value) => !value && !running && onClose()}
      title={labels[target.mode]}
      width="max-w-4xl"
      scrollable={false}
    >
      <div className="grid h-[calc(90vh-130px)] max-h-[560px] overflow-y-auto md:grid-cols-[minmax(0,1fr)_320px] md:overflow-hidden">
        <div className="scrollbar-thin space-y-6 p-6 md:overflow-y-auto">
          <div>
            <Label>{t("modelForGeneration")}</Label>
            <Select
              value={modelId}
              onChange={setModelId}
              options={modelOptions}
              placeholder={t("selectModel")}
            />
          </div>
          {isContent ? (
            <div>
              <Label>{t(isRegeneration ? "revisionRequest" : "generationRequest")}</Label>
              <Textarea
                value={instructions}
                onChange={(event) => setInstructions(event.target.value)}
                placeholder={t(
                  isRegeneration ? "revisionRequestPlaceholder" : "generationRequestPlaceholder",
                )}
              />
            </div>
          ) : null}
          {staleDependency ? (
            <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-amber-800 text-sm">
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              <span>{t("staleCheckpointWarning")}</span>
            </div>
          ) : null}
          {preview || (running && target.mode !== "content" && target.mode !== "checkpoint") ? (
            <div>
              <Label>{t("streamPreview")}</Label>
              <div className="max-h-44 min-h-24 overflow-y-auto rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700 leading-6">
                {preview}
                <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-zinc-800" />
              </div>
            </div>
          ) : null}
          <div>
            <Label>{t("contextPreview")}</Label>
            <div className="flex flex-wrap gap-2 rounded-lg bg-zinc-50 p-3">
              {contextItems.map((item) => (
                <span
                  key={item}
                  className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-600"
                >
                  {item}
                </span>
              ))}
            </div>
          </div>
        </div>
        <aside className="scrollbar-thin overflow-y-auto border-zinc-100 border-t bg-zinc-50/60 p-5 md:border-t-0 md:border-l">
          <p className="font-semibold text-xs text-zinc-400 uppercase tracking-wider">
            {t("contextSettings")}
          </p>
          {isContent ? (
            <div className="mt-5 space-y-5">
              <Switch
                checked={options.includeChapterSynopsis}
                onChange={(value) =>
                  updateOptions((current) => ({ ...current, includeChapterSynopsis: value }))
                }
                label={t("currentChapterSynopsis")}
              />
              <Switch
                checked={options.includeBlockSynopsis}
                onChange={(value) =>
                  updateOptions((current) => ({ ...current, includeBlockSynopsis: value }))
                }
                label={t("currentBlockSynopsis")}
              />
              <div>
                <Label>{t("chapterBlocks")}</Label>
                <Select
                  value={options.chapterBlocks}
                  onChange={(value) =>
                    updateOptions((current) => ({
                      ...current,
                      chapterBlocks: value as ContextSourceMode,
                    }))
                  }
                  options={sourceModeOptions}
                />
              </div>
              <div>
                <Label>{t("adjacentBlocks")}</Label>
                <Select
                  value={options.adjacentBlocks}
                  onChange={(value) =>
                    updateOptions((current) => ({
                      ...current,
                      adjacentBlocks: value as AdjacentBlockMode,
                    }))
                  }
                  options={adjacentBlockModeOptions}
                />
              </div>
              <div>
                <Label>{t("previousChapter")}</Label>
                <Select
                  value={options.previousChapter}
                  onChange={(value) =>
                    updateOptions((current) => ({
                      ...current,
                      previousChapter: value as ContextSourceMode,
                    }))
                  }
                  options={sourceModeOptions}
                />
              </div>
              <div>
                <Label>{t("nextChapter")}</Label>
                <Select
                  value={options.nextChapter}
                  onChange={(value) =>
                    updateOptions((current) => ({
                      ...current,
                      nextChapter: value as ContextSourceMode,
                    }))
                  }
                  options={sourceModeOptions}
                />
              </div>
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              <Switch
                checked={options.includeChapterSynopsis}
                onChange={(value) =>
                  updateOptions((current) => ({ ...current, includeChapterSynopsis: value }))
                }
                label={t("currentChapterSynopsis")}
              />
              {!isCheckpoint ? (
                <Switch
                  checked={options.includeBlockSynopsis}
                  onChange={(value) =>
                    updateOptions((current) => ({ ...current, includeBlockSynopsis: value }))
                  }
                  label={t("currentBlockSynopsis")}
                />
              ) : null}
              {isCheckpoint && priorCheckpoint ? (
                <Switch
                  checked={options.checkpointFullRebuild}
                  onChange={(value) =>
                    updateOptions((current) => ({ ...current, checkpointFullRebuild: value }))
                  }
                  label={t("fullRebuild")}
                  description={t("fullRebuildDescription")}
                />
              ) : null}
            </div>
          )}
        </aside>
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-zinc-100 border-t px-5 py-3">
        <Button variant="secondary" disabled={running} onClick={onClose}>
          {common("cancel")}
        </Button>
        {running ? (
          <Button variant="danger" onClick={() => requestController.current?.abort()}>
            <Square className="size-3.5 fill-current" />
            {t("stopGeneration")}
          </Button>
        ) : (
          <Button disabled={staleDependency} onClick={run}>
            <Sparkles className="size-3.5" />
            {t("confirmGeneration")}
          </Button>
        )}
      </div>
    </Modal>
  );
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function SynopsisDialog({
  block,
  onClose,
  onSave,
  onGenerate,
}: {
  block: Block | null;
  onClose: () => void;
  onSave: (value: string) => Promise<void>;
  onGenerate: () => void;
}) {
  const t = useTranslations("Chapter");
  const common = useTranslations("Common");
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  // Modal draft follows the selected block.
  useEffect(() => setValue(block?.synopsis ?? ""), [block]);
  return (
    <Modal
      open={Boolean(block)}
      onOpenChange={(open) => !open && onClose()}
      title={t("blockSynopsisTitle")}
      description={t("blockSynopsisDialogDescription")}
    >
      <div className="p-5">
        <Label>{t("synopsisContent")}</Label>
        <Textarea
          autoFocus
          className="min-h-40"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={t("synopsisContentPlaceholder")}
        />
      </div>
      <div className="flex justify-between border-zinc-100 border-t p-3">
        <Button variant="secondary" onClick={onGenerate}>
          <WandSparkles className="size-3.5" />
          {t("aiGenerate")}
        </Button>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            {common("cancel")}
          </Button>
          <Button
            loading={saving}
            onClick={async () => {
              setSaving(true);
              await onSave(value);
              setSaving(false);
            }}
          >
            <Save className="size-3.5" />
            {common("save")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
