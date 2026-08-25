"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  MessageCircle,
  MessageSquarePlus,
  Plus,
  Search,
  Send,
  Settings2,
  Square,
  Trash2,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button, ConfirmDialog, Input, Label, Modal, Switch, Tooltip } from "@/components/ui";
import { api } from "@/lib/client";
import type {
  Chapter,
  Character,
  CharacterChatContextSettings,
  CharacterChatDetail,
  CharacterChatMessage,
  CharacterChatSession,
  CharacterChatSummary,
  Entity,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const emptyContext = (): CharacterChatContextSettings => ({
  includeStorySynopsis: true,
  chapterIds: [],
  entityIds: [],
  preferChapterSynopsis: true,
  allowCharacterMentions: false,
});

interface ComposerMention {
  id: string | null;
  name: string;
}

type TransientChatMessage = CharacterChatMessage & { complete: boolean };

export function CharacterChatWorkspace({
  projectId,
  initialChatId,
  characters,
  entities,
  chapters,
}: {
  projectId: string;
  initialChatId: string | null;
  characters: Character[];
  entities: Entity[];
  chapters: Chapter[];
}) {
  const t = useTranslations("CharacterChat");
  const common = useTranslations("Common");
  const locale = useLocale();
  const router = useRouter();
  const client = useQueryClient();
  const [selectedChatId, setSelectedChatId] = useState<string | null>(initialChatId);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [deleteSession, setDeleteSession] = useState<CharacterChatSession | null>(null);
  const [deleteMessage, setDeleteMessage] = useState<CharacterChatMessage | null>(null);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [userCharacterId, setUserCharacterId] = useState<string | null>(null);
  const [createContext, setCreateContext] = useState<CharacterChatContextSettings>(emptyContext);
  const [settingsDraft, setSettingsDraft] = useState<CharacterChatContextSettings>(emptyContext);
  const [composer, setComposer] = useState("");
  const [composerMentions, setComposerMentions] = useState<ComposerMention[]>([]);
  const [optimisticAuthor, setOptimisticAuthor] = useState<CharacterChatMessage | null>(null);
  const [streamingMessages, setStreamingMessages] = useState<TransientChatMessage[]>([]);
  const [mention, setMention] = useState<{ start: number; end: number; query: string } | null>(
    null,
  );
  const [mentionIndex, setMentionIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const sendController = useRef<AbortController | null>(null);
  const authorAcknowledged = useRef(false);

  const chats = useQuery({
    queryKey: ["character-chats", projectId],
    queryFn: () => api<CharacterChatSummary[]>(`/api/projects/${projectId}/chats`),
  });
  const activeChatId =
    selectedChatId && chats.data?.some((chat) => chat.id === selectedChatId)
      ? selectedChatId
      : initialChatId && chats.data?.some((chat) => chat.id === initialChatId)
        ? initialChatId
        : (chats.data?.[0]?.id ?? null);
  const detail = useQuery({
    queryKey: ["character-chat", activeChatId, selectedSessionId],
    queryFn: () =>
      api<CharacterChatDetail>(
        `/api/chats/${activeChatId}${selectedSessionId ? `?session=${encodeURIComponent(selectedSessionId)}` : ""}`,
      ),
    enabled: Boolean(activeChatId),
  });
  const activeSessionId = selectedSessionId ?? detail.data?.activeSessionId ?? null;
  const latestStreamingContent = streamingMessages.at(-1)?.content;

  useEffect(() => {
    if (!activeChatId || initialChatId === activeChatId) return;
    router.replace(`/projects/${projectId}/chats?chat=${encodeURIComponent(activeChatId)}`, {
      scroll: false,
    });
  }, [activeChatId, initialChatId, projectId, router]);

  // biome-ignore lint: correctness/useExhaustiveDependencies
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [
    detail.data?.messages.length,
    optimisticAuthor,
    streamingMessages.length,
    latestStreamingContent,
  ]);

  useEffect(() => () => sendController.current?.abort(), []);

  const selectChat = (chatId: string) => {
    sendController.current?.abort();
    setOptimisticAuthor(null);
    setStreamingMessages([]);
    setSelectedChatId(chatId);
    setSelectedSessionId(null);
    setQuickOpen(false);
    setMention(null);
    setComposerMentions([]);
    router.push(`/projects/${projectId}/chats?chat=${encodeURIComponent(chatId)}`, {
      scroll: false,
    });
  };

  const createChat = useMutation({
    mutationFn: () =>
      api<CharacterChatDetail>(`/api/projects/${projectId}/chats`, {
        method: "POST",
        body: JSON.stringify({ memberIds, userCharacterId, contextSettings: createContext }),
      }),
    onSuccess: (chat) => {
      client.invalidateQueries({ queryKey: ["character-chats", projectId] });
      setCreateOpen(false);
      setMemberIds([]);
      setUserCharacterId(null);
      setCreateContext(emptyContext());
      selectChat(chat.id);
    },
    onError: (error) => toast.error(error.message),
  });

  const saveSettings = useMutation({
    mutationFn: () =>
      api<CharacterChatDetail>(`/api/chats/${activeChatId}`, {
        method: "PATCH",
        body: JSON.stringify({ contextSettings: settingsDraft }),
      }),
    onSuccess: (chat) => {
      client.setQueryData(["character-chat", activeChatId, selectedSessionId], chat);
      client.invalidateQueries({ queryKey: ["character-chats", projectId] });
      setSettingsOpen(false);
      toast.success(t("settingsSaved"));
    },
    onError: (error) => toast.error(error.message),
  });

  const createSession = useMutation({
    mutationFn: () =>
      api<CharacterChatSession>(`/api/chats/${activeChatId}/sessions`, { method: "POST" }),
    onSuccess: (session) => {
      setSelectedSessionId(session.id);
      client.invalidateQueries({ queryKey: ["character-chat", activeChatId] });
      client.invalidateQueries({ queryKey: ["character-chats", projectId] });
    },
    onError: (error) => toast.error(error.message),
  });

  const removeSession = useMutation({
    mutationFn: (session: CharacterChatSession) =>
      api(`/api/chat-sessions/${session.id}`, { method: "DELETE" }),
    onSuccess: (_result, session) => {
      const sessions = detail.data?.sessions ?? [];
      const index = sessions.findIndex((item) => item.id === session.id);
      const next = sessions[index - 1] ?? sessions[index + 1] ?? null;
      setSelectedSessionId(next?.id ?? null);
      setDeleteSession(null);
      client.invalidateQueries({ queryKey: ["character-chat", activeChatId] });
      client.invalidateQueries({ queryKey: ["character-chats", projectId] });
    },
    onError: (error) => toast.error(error.message),
  });

  const sendTurn = useMutation({
    mutationFn: async (body: { content?: string; characterIds?: string[] }) => {
      if (!activeSessionId) throw new Error(t("sessionRequired"));
      const controller = new AbortController();
      sendController.current = controller;
      try {
        const response = await fetch(`/api/chat-sessions/${activeSessionId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: unknown };
          throw new Error(
            typeof payload.error === "string"
              ? payload.error
              : t("sendFailedStatus", { status: response.status }),
          );
        }
        if (!response.body) throw new Error(t("streamUnavailable"));
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let chat: CharacterChatDetail | null = null;
        const processLine = (line: string) => {
          if (!line.trim()) return;
          const event = JSON.parse(line) as {
            type?: string;
            message?: unknown;
            messageId?: unknown;
            text?: unknown;
            chat?: unknown;
            error?: unknown;
          };
          if (
            event.type === "author_message" &&
            event.message &&
            typeof event.message === "object"
          ) {
            authorAcknowledged.current = true;
            setOptimisticAuthor(event.message as CharacterChatMessage);
          } else if (
            event.type === "character_start" &&
            event.message &&
            typeof event.message === "object"
          ) {
            const message = event.message as CharacterChatMessage;
            setStreamingMessages((current) => [
              ...current.filter((item) => item.id !== message.id),
              { ...message, complete: false },
            ]);
          } else if (
            event.type === "character_delta" &&
            typeof event.messageId === "string" &&
            typeof event.text === "string"
          ) {
            setStreamingMessages((current) =>
              current.map((message) =>
                message.id === event.messageId
                  ? { ...message, content: message.content + event.text }
                  : message,
              ),
            );
          } else if (
            event.type === "character_done" &&
            event.message &&
            typeof event.message === "object"
          ) {
            const message = event.message as CharacterChatMessage;
            setStreamingMessages((current) =>
              current.map((item) =>
                item.id === message.id ? { ...message, complete: true } : item,
              ),
            );
          } else if (event.type === "done" && event.chat && typeof event.chat === "object") {
            chat = event.chat as CharacterChatDetail;
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
        if (!chat) throw new Error(t("generationFailed"));
        return chat;
      } finally {
        if (sendController.current === controller) sendController.current = null;
      }
    },
    onMutate: (body) => {
      const snapshot = { composer, composerMentions };
      authorAcknowledged.current = false;
      setStreamingMessages([]);
      if (body.content !== undefined) {
        setOptimisticAuthor({
          id: `optimistic-${Date.now()}`,
          sessionId: activeSessionId ?? "",
          role: "author",
          characterId: null,
          content: body.content,
          createdAt: new Date().toISOString(),
        });
        setComposer("");
        setComposerMentions([]);
        setMention(null);
        setMentionIndex(0);
      }
      setQuickOpen(false);
      return snapshot;
    },
    onSuccess: (chat) => {
      client.setQueryData(["character-chat", activeChatId, selectedSessionId], chat);
      client.invalidateQueries({ queryKey: ["character-chats", projectId] });
      setOptimisticAuthor(null);
      setStreamingMessages([]);
    },
    onError: async (error, body, snapshot) => {
      if (body.content !== undefined && !authorAcknowledged.current && snapshot) {
        setComposer(snapshot.composer);
        setComposerMentions(snapshot.composerMentions);
      }
      if (!isAbortError(error)) toast.error(error.message);
      await client.invalidateQueries({
        queryKey: ["character-chat", activeChatId, selectedSessionId],
      });
      setOptimisticAuthor(null);
      setStreamingMessages([]);
    },
  });

  const removeMessage = useMutation({
    mutationFn: (message: CharacterChatMessage) =>
      api(`/api/chat-messages/${message.id}`, { method: "DELETE" }),
    onSuccess: () => {
      setDeleteMessage(null);
      client.invalidateQueries({ queryKey: ["character-chat", activeChatId, selectedSessionId] });
    },
    onError: (error) => toast.error(error.message),
  });

  const filteredChats = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return (chats.data ?? []).filter(
      (chat) =>
        !query || chat.members.some((member) => member.name.toLocaleLowerCase().includes(query)),
    );
  }, [chats.data, search]);

  const mentionOptions = useMemo(() => {
    if (!mention || !detail.data) return [];
    const query = mention.query.toLocaleLowerCase();
    return detail.data.members.filter((member) => member.name.toLocaleLowerCase().includes(query));
  }, [detail.data, mention]);

  const insertMention = (character?: Character) => {
    if (!mention) return;
    const token: ComposerMention = character
      ? { id: character.id, name: character.name }
      : { id: null, name: t("everyone") };
    setComposerMentions((current) =>
      token.id === null
        ? [token]
        : current.some((item) => item.id === null)
          ? [token]
          : current.some((item) => item.id === token.id)
            ? current
            : [...current, token],
    );
    const next = `${composer.slice(0, mention.start)}${composer.slice(mention.end)}`;
    const caret = mention.start;
    setComposer(next);
    setMention(null);
    setMentionIndex(0);
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(caret, caret);
    });
  };

  const onComposerChange = (value: string, caret: number) => {
    setComposer(value);
    if (detail.data?.members.length === 1) {
      setMention(null);
      setMentionIndex(0);
      return;
    }
    const match = value.slice(0, caret).match(/@([^@\s<>]*)$/);
    setMention(match ? { start: caret - match[0].length, end: caret, query: match[1] } : null);
    setMentionIndex(0);
  };

  const submit = () => {
    if ((!composer.trim() && !composerMentions.length) || sendTurn.isPending) return;
    const expressions = composerMentions.map((item) =>
      item.id === null ? "<mention/>" : `<mention>${item.name}</mention>`,
    );
    sendTurn.mutate({ content: [...expressions, composer.trim()].filter(Boolean).join(" ") });
  };

  const openSettings = () => {
    if (!detail.data) return;
    setSettingsDraft(detail.data.contextSettings);
    setSettingsOpen(true);
  };

  return (
    <div className="flex h-full min-h-0 bg-white">
      <aside className="flex w-72 shrink-0 flex-col border-zinc-200 border-r bg-zinc-50/70">
        <div className="flex h-14 shrink-0 items-center justify-between border-zinc-200 border-b px-4">
          <div>
            <h1 className="font-semibold text-sm">{t("title")}</h1>
            <p className="mt-0.5 text-[11px] text-zinc-400">
              {t("chatCount", { count: chats.data?.length ?? 0 })}
            </p>
          </div>
          <Tooltip label={t("newChat")}>
            <Button size="icon" onClick={() => setCreateOpen(true)}>
              <MessageSquarePlus className="size-4" />
            </Button>
          </Tooltip>
        </div>
        <div className="p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-2.5 left-3 size-3.5 text-zinc-400" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("searchPlaceholder")}
              className="pl-8"
            />
          </div>
        </div>
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-3 pt-1 pb-3">
          {filteredChats.map((chat) => (
            <button
              key={chat.id}
              type="button"
              onClick={() => selectChat(chat.id)}
              className={cn(
                "mb-1 flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition",
                activeChatId === chat.id
                  ? "border-zinc-200 bg-white shadow-sm"
                  : "border-transparent hover:bg-white/70",
              )}
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-zinc-200 font-semibold text-xs text-zinc-600">
                {chat.members.length > 1 ? (
                  <Users className="size-4" />
                ) : (
                  chat.members[0]?.name.slice(0, 1)
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-sm">
                  {formatMemberNames(
                    chat.members.map((member) => member.name),
                    locale,
                  )}
                </span>
                <span className="mt-1 flex items-center justify-between text-[11px] text-zinc-400">
                  <span>{t("sessionCount", { count: chat.sessionCount })}</span>
                  <span>{formatDate(chat.updatedAt, locale)}</span>
                </span>
              </span>
            </button>
          ))}
          {!chats.isLoading && !filteredChats.length ? (
            <div className="px-5 py-16 text-center">
              <MessageCircle className="mx-auto size-6 text-zinc-300" />
              <p className="mt-3 text-xs text-zinc-400">
                {search ? t("noSearchResults") : t("noChats")}
              </p>
              {!search && characters.length ? (
                <Button
                  className="mt-4"
                  size="sm"
                  variant="secondary"
                  onClick={() => setCreateOpen(true)}
                >
                  {t("newChat")}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </aside>
      <section className="flex min-w-0 flex-1 flex-col">
        {detail.data ? (
          <>
            <header className="flex h-14 shrink-0 items-center justify-between border-zinc-200 border-b px-5">
              <div className="min-w-0">
                <h2 className="truncate font-semibold text-sm">
                  {formatMemberNames(
                    detail.data.members.map((member) => member.name),
                    locale,
                  )}
                </h2>
                <p className="mt-0.5 text-[11px] text-zinc-400">
                  {detail.data.members.length > 1
                    ? t("groupChat", { count: detail.data.members.length })
                    : t("singleChat")}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <SessionPicker
                  sessions={detail.data.sessions}
                  value={detail.data.activeSessionId}
                  disabled={sendTurn.isPending}
                  onChange={setSelectedSessionId}
                  label={(number) => t("session", { number })}
                />
                <Tooltip label={t("newSession")}>
                  <Button
                    size="icon"
                    variant="ghost"
                    loading={createSession.isPending}
                    disabled={sendTurn.isPending}
                    onClick={() => createSession.mutate()}
                  >
                    <Plus className="size-4" />
                  </Button>
                </Tooltip>
                <Tooltip label={t("deleteSession")}>
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={
                      sendTurn.isPending ||
                      detail.data.sessions.length <= 1 ||
                      !detail.data.activeSessionId
                    }
                    onClick={() =>
                      setDeleteSession(
                        detail.data?.sessions.find(
                          (session) => session.id === detail.data?.activeSessionId,
                        ) ?? null,
                      )
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </Tooltip>
                <Tooltip label={t("chatSettings")}>
                  <Button size="icon" variant="ghost" onClick={openSettings}>
                    <Settings2 className="size-4" />
                  </Button>
                </Tooltip>
              </div>
            </header>
            <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto bg-zinc-50/60 px-6 py-6">
              <div className="mx-auto max-w-3xl space-y-5">
                {!detail.data.messages.length && !optimisticAuthor && !sendTurn.isPending ? (
                  <div className="flex min-h-72 flex-col items-center justify-center text-center">
                    <span className="flex size-12 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-zinc-200">
                      <MessageCircle className="size-5 text-zinc-400" />
                    </span>
                    <h3 className="mt-4 font-medium text-sm">{t("emptySession")}</h3>
                    <p className="mt-1 max-w-sm text-xs text-zinc-400 leading-5">
                      {detail.data.members.length > 1
                        ? t("emptySessionDescription")
                        : t("emptySingleSessionDescription")}
                    </p>
                  </div>
                ) : null}
                {detail.data.messages.map((message) => (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    members={detail.data!.members}
                    authorLabel={detail.data!.userCharacter?.name ?? t("author")}
                    authorInitial={detail.data!.userCharacter?.name.slice(0, 1)}
                    allLabel={t("everyone")}
                    deleteLabel={common("delete")}
                    onDelete={() => setDeleteMessage(message)}
                  />
                ))}
                {optimisticAuthor &&
                !detail.data.messages.some((message) => message.id === optimisticAuthor.id) ? (
                  <MessageBubble
                    message={optimisticAuthor}
                    members={detail.data.members}
                    authorLabel={detail.data.userCharacter?.name ?? t("author")}
                    authorInitial={detail.data.userCharacter?.name.slice(0, 1)}
                    allLabel={t("everyone")}
                    deleteLabel={common("delete")}
                    transient
                  />
                ) : null}
                {streamingMessages.map((message) => (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    members={detail.data!.members}
                    authorLabel={detail.data!.userCharacter?.name ?? t("author")}
                    authorInitial={detail.data!.userCharacter?.name.slice(0, 1)}
                    allLabel={t("everyone")}
                    deleteLabel={common("delete")}
                    transient
                    streaming={!message.complete}
                  />
                ))}
                {sendTurn.isPending && !streamingMessages.length ? (
                  <div className="flex items-center gap-2 text-xs text-zinc-400">
                    <span className="flex size-7 items-center justify-center rounded-full bg-white ring-1 ring-zinc-200">
                      <span className="streaming-dot size-1.5 rounded-full bg-zinc-500" />
                    </span>
                    {t("charactersResponding")}
                  </div>
                ) : null}
                <div ref={endRef} />
              </div>
            </div>
            <div className="shrink-0 border-zinc-200 border-t bg-white px-5 py-4">
              <div className="relative mx-auto max-w-3xl">
                {mention ? (
                  <div
                    id="character-mention-listbox"
                    role="listbox"
                    className="absolute bottom-[calc(100%+8px)] left-0 z-20 w-64 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl"
                  >
                    <button
                      id="character-mention-option-0"
                      role="option"
                      aria-selected={mentionIndex === 0}
                      type="button"
                      onMouseEnter={() => setMentionIndex(0)}
                      onClick={() => insertMention()}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm",
                        mentionIndex === 0 ? "bg-zinc-100" : "hover:bg-zinc-100",
                      )}
                    >
                      <span className="flex size-7 items-center justify-center rounded-full bg-zinc-100">
                        <Users className="size-3.5" />
                      </span>
                      <span>{t("everyone")}</span>
                    </button>
                    {mentionOptions.map((member, index) => (
                      <button
                        id={`character-mention-option-${index + 1}`}
                        role="option"
                        aria-selected={mentionIndex === index + 1}
                        key={member.id}
                        type="button"
                        onMouseEnter={() => setMentionIndex(index + 1)}
                        onClick={() => insertMention(member)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm",
                          mentionIndex === index + 1 ? "bg-zinc-100" : "hover:bg-zinc-100",
                        )}
                      >
                        <span className="flex size-7 items-center justify-center rounded-full bg-zinc-100 font-medium text-xs">
                          {member.name.slice(0, 1)}
                        </span>
                        <span className="truncate">{member.name}</span>
                      </button>
                    ))}
                    {!mentionOptions.length ? (
                      <p className="px-3 py-3 text-center text-xs text-zinc-400">
                        {t("noMentionMatches")}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {quickOpen && detail.data.members.length > 1 ? (
                  <div className="absolute bottom-[calc(100%+8px)] left-0 z-20 w-60 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl">
                    <div className="flex items-center justify-between px-2 py-1.5">
                      <span className="font-medium text-[11px] text-zinc-500">
                        {t("chooseSpeaker")}
                      </span>
                      <button
                        type="button"
                        onClick={() => setQuickOpen(false)}
                        className="text-zinc-400"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                    {detail.data.members.map((member) => (
                      <button
                        key={member.id}
                        type="button"
                        disabled={sendTurn.isPending}
                        onClick={() => sendTurn.mutate({ characterIds: [member.id] })}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-zinc-100 disabled:opacity-50"
                      >
                        <span className="flex size-7 items-center justify-center rounded-full bg-zinc-100 font-medium text-xs">
                          {member.name.slice(0, 1)}
                        </span>
                        <span className="truncate">{member.name}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="rounded-xl border border-zinc-200 bg-white shadow-sm focus-within:border-zinc-300 focus-within:ring-4 focus-within:ring-zinc-950/5">
                  {composerMentions.length ? (
                    <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
                      {composerMentions.map((item) => (
                        <span
                          key={item.id ?? "everyone"}
                          className="inline-flex h-7 items-center gap-1 rounded-md bg-sky-50 pr-1.5 pl-2.5 font-medium text-sky-700 text-xs ring-1 ring-sky-200 ring-inset"
                        >
                          <span>@{item.name}</span>
                          <button
                            type="button"
                            onClick={() =>
                              setComposerMentions((current) =>
                                current.filter((candidate) => candidate.id !== item.id),
                              )
                            }
                            aria-label={t("removeMention", { name: item.name })}
                            className="flex size-4 items-center justify-center rounded text-sky-500 hover:bg-sky-100 hover:text-sky-800"
                          >
                            <X className="size-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <textarea
                    ref={textareaRef}
                    value={composer}
                    disabled={sendTurn.isPending}
                    role={mention ? "combobox" : undefined}
                    aria-autocomplete={mention ? "list" : undefined}
                    aria-expanded={mention ? true : undefined}
                    aria-controls={mention ? "character-mention-listbox" : undefined}
                    aria-activedescendant={
                      mention ? `character-mention-option-${mentionIndex}` : undefined
                    }
                    onChange={(event) =>
                      onComposerChange(
                        event.target.value,
                        event.target.selectionStart ?? event.target.value.length,
                      )
                    }
                    onKeyDown={(event) => {
                      if (event.nativeEvent.isComposing) return;
                      if (mention && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
                        event.preventDefault();
                        const optionCount = mentionOptions.length + 1;
                        setMentionIndex((current) =>
                          event.key === "ArrowDown"
                            ? (current + 1) % optionCount
                            : (current - 1 + optionCount) % optionCount,
                        );
                        return;
                      }
                      if (event.key === "Escape" && mention) {
                        event.preventDefault();
                        setMention(null);
                        setMentionIndex(0);
                        return;
                      }
                      if (event.key === "Backspace" && !composer && composerMentions.length) {
                        event.preventDefault();
                        setComposerMentions((current) => current.slice(0, -1));
                        return;
                      }
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        if (mention) {
                          if (mentionIndex === 0) insertMention();
                          else if (mentionOptions[mentionIndex - 1])
                            insertMention(mentionOptions[mentionIndex - 1]);
                        } else submit();
                      }
                    }}
                    placeholder={
                      detail.data.members.length > 1
                        ? t("composerPlaceholder")
                        : t("singleComposerPlaceholder")
                    }
                    className={cn(
                      "block w-full resize-none rounded-xl border-0 bg-transparent px-3 py-2.5 text-sm leading-6 outline-none ring-0 placeholder:text-zinc-400 focus:border-0 focus:outline-none focus:ring-0 disabled:opacity-50",
                      composerMentions.length ? "min-h-16" : "min-h-20",
                    )}
                  />
                  <div
                    className={cn(
                      "flex items-center px-2.5 pb-2.5",
                      detail.data.members.length > 1 ? "justify-between" : "justify-end",
                    )}
                  >
                    {detail.data.members.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => setQuickOpen((open) => !open)}
                        className="focus-ring flex h-8 items-center gap-2 rounded-lg px-2.5 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
                      >
                        <UserRound className="size-3.5" />
                        {t("directSpeaker")}
                      </button>
                    ) : null}
                    {sendTurn.isPending ? (
                      <Tooltip label={t("stop")}>
                        <Button
                          size="icon"
                          onClick={() => sendController.current?.abort()}
                          aria-label={t("stop")}
                        >
                          <Square className="size-3.5 fill-current" />
                        </Button>
                      </Tooltip>
                    ) : (
                      <Button
                        size="icon"
                        disabled={!composer.trim() && !composerMentions.length}
                        onClick={submit}
                        aria-label={t("send")}
                      >
                        <Send className="size-4" />
                      </Button>
                    )}
                  </div>
                </div>
                <p className="mt-2 text-center text-[10px] text-zinc-400">{t("composerHint")}</p>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-zinc-100">
              <MessageCircle className="size-6 text-zinc-400" />
            </span>
            <h2 className="mt-4 font-semibold text-sm">
              {characters.length ? t("selectOrCreate") : t("charactersRequired")}
            </h2>
            <p className="mt-1 max-w-sm text-xs text-zinc-400 leading-5">
              {characters.length
                ? t("selectOrCreateDescription")
                : t("charactersRequiredDescription")}
            </p>
            {characters.length ? (
              <Button className="mt-5" onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" />
                {t("newChat")}
              </Button>
            ) : null}
          </div>
        )}
      </section>

      <Modal
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={t("createTitle")}
        description={t("createDescription")}
        width="max-w-2xl"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            createChat.mutate();
          }}
        >
          <div className="scrollbar-thin max-h-[65vh] space-y-6 overflow-y-auto p-5">
            <div>
              <Label>{t("members")}</Label>
              <CharacterSelection
                characters={characters}
                selectedIds={memberIds}
                onChange={(ids) => {
                  setMemberIds(ids);
                  if (userCharacterId && ids.includes(userCharacterId)) setUserCharacterId(null);
                }}
                emptyLabel={t("noCharacters")}
              />
            </div>
            <IdentitySelection
              characters={characters.filter((character) => !memberIds.includes(character.id))}
              value={userCharacterId}
              onChange={setUserCharacterId}
            />
            <ContextSettingsFields
              value={createContext}
              onChange={setCreateContext}
              members={characters.filter((character) => memberIds.includes(character.id))}
              userCharacter={
                characters.find((character) => character.id === userCharacterId) ?? null
              }
              entities={entities}
              chapters={chapters}
            />
          </div>
          <div className="flex justify-end gap-2 border-zinc-100 border-t p-3">
            <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>
              {common("cancel")}
            </Button>
            <Button type="submit" disabled={!memberIds.length} loading={createChat.isPending}>
              {t("create")}
            </Button>
          </div>
        </form>
      </Modal>
      <Modal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        title={t("settingsTitle")}
        description={t("settingsDescription")}
        width="max-w-2xl"
      >
        <div className="scrollbar-thin max-h-[65vh] space-y-6 overflow-y-auto p-5">
          <div>
            <Label>{t("membersFixed")}</Label>
            <div className="flex flex-wrap gap-2">
              {detail.data?.members.map((member) => (
                <span
                  key={member.id}
                  className="rounded-full bg-zinc-100 px-3 py-1.5 font-medium text-xs text-zinc-700"
                >
                  {member.name}
                </span>
              ))}
            </div>
          </div>
          <div>
            <Label>{t("myIdentity")}</Label>
            <p className="rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-700">
              {detail.data?.userCharacter?.name ?? t("author")}
            </p>
          </div>
          <ContextSettingsFields
            value={settingsDraft}
            onChange={setSettingsDraft}
            members={detail.data?.members ?? []}
            userCharacter={detail.data?.userCharacter ?? null}
            entities={entities}
            chapters={chapters}
          />
        </div>
        <div className="flex justify-end gap-2 border-zinc-100 border-t p-3">
          <Button variant="secondary" onClick={() => setSettingsOpen(false)}>
            {common("cancel")}
          </Button>
          <Button loading={saveSettings.isPending} onClick={() => saveSettings.mutate()}>
            {common("save")}
          </Button>
        </div>
      </Modal>
      <ConfirmDialog
        open={Boolean(deleteSession)}
        onOpenChange={(open) => !open && setDeleteSession(null)}
        title={t("deleteSessionTitle")}
        description={t("deleteSessionDescription")}
        onConfirm={() => deleteSession && removeSession.mutate(deleteSession)}
        loading={removeSession.isPending}
      />
      <ConfirmDialog
        open={Boolean(deleteMessage)}
        onOpenChange={(open) => !open && setDeleteMessage(null)}
        title={t("deleteMessageTitle")}
        description={t("deleteMessageDescription")}
        onConfirm={() => deleteMessage && removeMessage.mutate(deleteMessage)}
        loading={removeMessage.isPending}
      />
    </div>
  );
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function SessionPicker({
  sessions,
  value,
  disabled,
  onChange,
  label,
}: {
  sessions: CharacterChatSession[];
  value: string | null;
  disabled?: boolean;
  onChange: (id: string) => void;
  label: (number: number) => string;
}) {
  const [open, setOpen] = useState(false);
  const selected = sessions.find((session) => session.id === value) ?? sessions.at(-1);
  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className="focus-ring flex h-8 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 font-medium text-xs hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {selected ? label(selected.sortOrder) : "—"}
        <ChevronDown className="size-3 text-zinc-400" />
      </button>
      {open ? (
        <div className="absolute top-10 right-0 z-30 min-w-40 rounded-lg border border-zinc-200 bg-white p-1 shadow-xl">
          {sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              onClick={() => {
                onChange(session.id);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs hover:bg-zinc-100"
            >
              <Check
                className={cn(
                  "size-3.5",
                  session.id === selected?.id ? "opacity-100" : "opacity-0",
                )}
              />
              {label(session.sortOrder)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MessageBubble({
  message,
  members,
  authorLabel,
  authorInitial,
  allLabel,
  deleteLabel,
  onDelete,
  transient,
  streaming,
}: {
  message: CharacterChatMessage;
  members: Character[];
  authorLabel: string;
  authorInitial?: string;
  allLabel: string;
  deleteLabel: string;
  onDelete?: () => void;
  transient?: boolean;
  streaming?: boolean;
}) {
  const member = members.find((candidate) => candidate.id === message.characterId);
  const author = message.role === "author";
  return (
    <div
      className={cn(
        "group flex items-start gap-3",
        author && "flex-row-reverse",
        transient && "fade-in animate-in duration-150",
      )}
    >
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full font-semibold text-xs",
          author ? "bg-zinc-950 text-white" : "bg-white text-zinc-600 ring-1 ring-zinc-200",
        )}
      >
        {author ? (authorInitial ?? <UserRound className="size-3.5" />) : member?.name.slice(0, 1)}
      </span>
      <div className={cn("max-w-[78%]", author && "text-right")}>
        <div className="mb-1 px-1 text-[11px] text-zinc-400">
          {author ? authorLabel : member?.name}
        </div>
        <div
          className={cn(
            "relative rounded-2xl px-4 py-2.5 text-left text-sm leading-6 shadow-sm",
            author
              ? "rounded-tr-sm bg-zinc-950 text-white"
              : "rounded-tl-sm bg-white text-zinc-800 ring-1 ring-zinc-200",
          )}
        >
          <MentionContent content={message.content} allLabel={allLabel} />
          {streaming ? (
            <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-zinc-700 align-middle" />
          ) : null}
          {onDelete && !transient ? (
            <button
              type="button"
              onClick={onDelete}
              aria-label={deleteLabel}
              className={cn(
                "absolute top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-zinc-400 opacity-0 transition hover:bg-white hover:text-red-500 group-hover:opacity-100",
                author ? "-left-10" : "-right-10",
              )}
            >
              <Trash2 className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function MentionContent({ content, allLabel }: { content: string; allLabel: string }) {
  const parts = content.split(/(<mention\s*\/>|<mention>\s*[^<]+?\s*<\/mention>)/gi);
  return (
    <p className="whitespace-pre-wrap break-words">
      {parts.map((part, index) => {
        if (/<mention\s*\/>/i.test(part))
          return (
            <span key={index} className="rounded bg-sky-100 px-1.5 py-0.5 font-medium text-sky-700">
              @{allLabel}
            </span>
          );
        const name = part.match(/<mention>\s*([^<]+?)\s*<\/mention>/i)?.[1];
        return name ? (
          <span key={index} className="rounded bg-sky-100 px-1.5 py-0.5 font-medium text-sky-700">
            @{name}
          </span>
        ) : (
          part
        );
      })}
    </p>
  );
}

function CharacterSelection({
  characters,
  selectedIds,
  onChange,
  lockedIds = [],
  emptyLabel,
}: {
  characters: Entity[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  lockedIds?: string[];
  emptyLabel: string;
}) {
  if (!characters.length)
    return (
      <p className="rounded-lg border border-zinc-200 border-dashed px-4 py-8 text-center text-xs text-zinc-400">
        {emptyLabel}
      </p>
    );
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {characters.map((character) => {
        const selected = selectedIds.includes(character.id) || lockedIds.includes(character.id);
        const locked = lockedIds.includes(character.id);
        return (
          <button
            key={character.id}
            type="button"
            disabled={locked}
            onClick={() =>
              onChange(
                selected
                  ? selectedIds.filter((id) => id !== character.id)
                  : [...selectedIds, character.id],
              )
            }
            className={cn(
              "flex items-center gap-3 rounded-lg border p-3 text-left transition",
              selected ? "border-zinc-400 bg-zinc-50" : "border-zinc-200 hover:border-zinc-300",
              locked && "cursor-default opacity-75",
            )}
          >
            <span
              className={cn(
                "flex size-4 shrink-0 items-center justify-center rounded border",
                selected ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-300",
              )}
            >
              {selected ? <Check className="size-3" /> : null}
            </span>
            <span className="min-w-0 truncate font-medium text-sm">{character.name}</span>
          </button>
        );
      })}
    </div>
  );
}

function IdentitySelection({
  characters,
  value,
  onChange,
}: {
  characters: Character[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const t = useTranslations("CharacterChat");
  return (
    <div>
      <Label>{t("myIdentity")}</Label>
      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => onChange(null)}
          className={cn(
            "flex items-center gap-3 rounded-lg border p-3 text-left",
            value === null ? "border-zinc-400 bg-zinc-50" : "border-zinc-200",
          )}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-950 text-white">
            <UserRound className="size-3.5" />
          </span>
          <span className="min-w-0">
            <span className="block font-medium text-sm">{t("author")}</span>
            <span className="block truncate text-xs text-zinc-400">
              {t("authorIdentityDescription")}
            </span>
          </span>
        </button>
        {characters.map((character) => (
          <button
            key={character.id}
            type="button"
            onClick={() => onChange(character.id)}
            className={cn(
              "flex items-center gap-3 rounded-lg border p-3 text-left",
              value === character.id ? "border-zinc-400 bg-zinc-50" : "border-zinc-200",
            )}
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 font-medium text-xs">
              {character.name.slice(0, 1)}
            </span>
            <span className="min-w-0 truncate font-medium text-sm">{character.name}</span>
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-zinc-400">{t("identityCannotBeMember")}</p>
    </div>
  );
}

function ContextSettingsFields({
  value,
  onChange,
  members,
  userCharacter,
  entities,
  chapters,
}: {
  value: CharacterChatContextSettings;
  onChange: (value: CharacterChatContextSettings) => void;
  members: Character[];
  userCharacter: Character | null;
  entities: Entity[];
  chapters: Chapter[];
}) {
  const t = useTranslations("CharacterChat");
  const lockedIds = [
    ...members.map((member) => member.id),
    ...(userCharacter ? [userCharacter.id] : []),
  ];
  const selectedEntityIds = [...new Set([...lockedIds, ...value.entityIds])];
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-zinc-200 p-4">
        <Switch
          checked={value.includeStorySynopsis}
          onChange={(checked) => onChange({ ...value, includeStorySynopsis: checked })}
          label={t("includeStorySynopsis")}
          description={t("includeStorySynopsisDescription")}
        />
      </div>
      <div>
        <Label>{t("contextChapters")}</Label>
        <SelectionList
          items={chapters.map((chapter) => ({ id: chapter.id, label: chapter.title }))}
          selectedIds={value.chapterIds}
          onChange={(chapterIds) => onChange({ ...value, chapterIds })}
          emptyLabel={t("noChapters")}
        />
      </div>
      <div className="rounded-xl border border-zinc-200 p-4">
        <Switch
          checked={value.preferChapterSynopsis}
          onChange={(checked) => onChange({ ...value, preferChapterSynopsis: checked })}
          label={t("preferChapterSynopsis")}
          description={t("preferChapterSynopsisDescription")}
        />
      </div>
      <div>
        <Label>{t("contextEntities")}</Label>
        <CharacterSelection
          characters={entities}
          selectedIds={selectedEntityIds}
          lockedIds={lockedIds}
          onChange={(entityIds) => onChange({ ...value, entityIds })}
          emptyLabel={t("noEntities")}
        />
      </div>
      {members.length > 1 ? (
        <div className="rounded-xl border border-zinc-200 p-4">
          <Switch
            checked={value.allowCharacterMentions}
            onChange={(checked) => onChange({ ...value, allowCharacterMentions: checked })}
            label={t("allowCharacterMentions")}
            description={t("allowCharacterMentionsDescription")}
          />
        </div>
      ) : null}
    </div>
  );
}

function SelectionList({
  items,
  selectedIds,
  onChange,
  emptyLabel,
}: {
  items: Array<{ id: string; label: string }>;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  emptyLabel: string;
}) {
  if (!items.length)
    return (
      <p className="rounded-lg border border-zinc-200 border-dashed px-4 py-8 text-center text-xs text-zinc-400">
        {emptyLabel}
      </p>
    );
  return (
    <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-zinc-200 p-2">
      {items.map((item) => {
        const selected = selectedIds.includes(item.id);
        return (
          <button
            key={item.id}
            type="button"
            onClick={() =>
              onChange(
                selected ? selectedIds.filter((id) => id !== item.id) : [...selectedIds, item.id],
              )
            }
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-zinc-50"
          >
            <span
              className={cn(
                "flex size-4 shrink-0 items-center justify-center rounded border",
                selected ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-300",
              )}
            >
              {selected ? <Check className="size-3" /> : null}
            </span>
            <span className="min-w-0 truncate text-sm">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function formatMemberNames(names: string[], locale: string) {
  return new Intl.ListFormat(locale, { style: "short", type: "conjunction" }).format(names);
}

function formatDate(value: string, locale: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric" }).format(date);
}
