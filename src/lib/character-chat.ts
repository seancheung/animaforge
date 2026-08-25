import { ApiError } from "@/lib/api";
import {
  entitySelectColumns,
  loadBlocks,
  loadEntities,
  loadEntityRelations,
  loadServices,
  loadSettings,
  mapEntity,
  mapProject,
} from "@/lib/data";
import { getDb, newId, parseJson } from "@/lib/db";
import { formatEntityRelation } from "@/lib/entity-relation";
import { generateModelText } from "@/lib/model-generation";
import {
  type AppSettings,
  type Character,
  type CharacterChatContextSettings,
  type CharacterChatDetail,
  type CharacterChatMessage,
  type CharacterChatSession,
  type CharacterChatSummary,
  getBlockContent,
  type LlmModel,
  type LlmService,
  type Project,
} from "@/lib/types";

type Row = Record<string, unknown>;

const timestamp = (value: unknown) => String(value ?? "");
const uniqueStrings = (value: unknown) =>
  Array.isArray(value)
    ? [
        ...new Set(
          value.filter((item): item is string => typeof item === "string" && Boolean(item)),
        ),
      ]
    : [];

function escapeXml(value: unknown) {
  return String(value ?? "").replace(
    /[<>&"']/g,
    (character) =>
      ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[character] ??
      character,
  );
}

export function normalizeChatContextSettings(
  value: unknown,
  memberIds: string[],
): CharacterChatContextSettings {
  const input =
    value && typeof value === "object" ? (value as Partial<CharacterChatContextSettings>) : {};
  return {
    includeStorySynopsis: input.includeStorySynopsis !== false,
    chapterIds: uniqueStrings(input.chapterIds),
    entityIds: [...new Set([...memberIds, ...uniqueStrings(input.entityIds)])],
    preferChapterSynopsis: input.preferChapterSynopsis !== false,
    allowCharacterMentions: input.allowCharacterMentions === true,
  };
}

function mapSession(row: Row): CharacterChatSession {
  return {
    id: String(row.id),
    chatId: String(row.chat_id),
    sortOrder: Number(row.sort_order),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  };
}

function mapMessage(row: Row): CharacterChatMessage {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    role: row.role === "character" ? "character" : "author",
    characterId: row.speaker_entity_id ? String(row.speaker_entity_id) : null,
    content: String(row.content ?? ""),
    createdAt: timestamp(row.created_at),
  };
}

async function loadMembers(chatIds: string[]): Promise<Map<string, Character[]>> {
  if (!chatIds.length) return new Map();
  const conn = await getDb();
  const rows = (await conn("character_chat_members")
    .join("entities", "character_chat_members.entity_id", "entities.id")
    .join("entity_types", "entities.type_id", "entity_types.id")
    .whereIn("character_chat_members.chat_id", chatIds)
    .select(entitySelectColumns)
    .select("character_chat_members.chat_id as membership_chat_id")
    .orderBy("character_chat_members.sort_order", "asc")) as Row[];
  const result = new Map<string, Character[]>();
  for (const row of rows) {
    const chatId = String(row.membership_chat_id);
    result.set(chatId, [...(result.get(chatId) ?? []), mapEntity(row)]);
  }
  return result;
}

export async function loadProjectCharacterChats(
  projectId: string,
): Promise<CharacterChatSummary[]> {
  const conn = await getDb();
  const rows = (await conn("character_chats")
    .where({ project_id: projectId })
    .orderBy("updated_at", "desc")) as Row[];
  const members = await loadMembers(rows.map((row) => String(row.id)));
  const userCharacterIds = [
    ...new Set(
      rows.map((row) => (row.user_entity_id ? String(row.user_entity_id) : "")).filter(Boolean),
    ),
  ];
  const userCharacterRows = userCharacterIds.length
    ? await loadEntities(projectId, userCharacterIds)
    : [];
  const userCharacters = new Map(userCharacterRows.map((entity) => [entity.id, entity]));
  const sessionCounts = (await conn("character_chat_sessions")
    .whereIn(
      "chat_id",
      rows.map((row) => String(row.id)),
    )
    .groupBy("chat_id")
    .select("chat_id")
    .count({ count: "*" })) as Array<Row & { count: number | string }>;
  const counts = new Map(sessionCounts.map((row) => [String(row.chat_id), Number(row.count)]));
  return rows.map((row) => {
    const id = String(row.id);
    const chatMembers = members.get(id) ?? [];
    return {
      id,
      projectId: String(row.project_id),
      members: chatMembers,
      userCharacter: row.user_entity_id
        ? (userCharacters.get(String(row.user_entity_id)) ?? null)
        : null,
      contextSettings: normalizeChatContextSettings(
        parseJson(String(row.context_settings ?? "{}"), {}),
        [
          ...chatMembers.map((member) => member.id),
          ...(row.user_entity_id ? [String(row.user_entity_id)] : []),
        ],
      ),
      sessionCount: counts.get(id) ?? 0,
      updatedAt: timestamp(row.updated_at),
    };
  });
}

export async function loadCharacterChat(
  chatId: string,
  requestedSessionId?: string | null,
): Promise<CharacterChatDetail> {
  const conn = await getDb();
  const row = (await conn("character_chats").where({ id: chatId }).first()) as Row | undefined;
  if (!row) throw new ApiError("chatNotFound", 404);
  const members = (await loadMembers([chatId])).get(chatId) ?? [];
  const userCharacterRow = row.user_entity_id
    ? (await loadEntities(String(row.project_id), [String(row.user_entity_id)]))[0]
    : undefined;
  const sessions = (
    (await conn("character_chat_sessions")
      .where({ chat_id: chatId })
      .orderBy("sort_order", "asc")) as Row[]
  ).map(mapSession);
  const activeSession =
    sessions.find((session) => session.id === requestedSessionId) ?? sessions.at(-1) ?? null;
  const messages = activeSession
    ? (
        (await conn("character_chat_messages")
          .where({ session_id: activeSession.id })
          .orderBy("created_at", "asc")) as Row[]
      ).map(mapMessage)
    : [];
  return {
    id: chatId,
    projectId: String(row.project_id),
    members,
    userCharacter: userCharacterRow ?? null,
    contextSettings: normalizeChatContextSettings(
      parseJson(String(row.context_settings ?? "{}"), {}),
      [
        ...members.map((member) => member.id),
        ...(userCharacterRow ? [String(userCharacterRow.id)] : []),
      ],
    ),
    sessionCount: sessions.length,
    updatedAt: timestamp(row.updated_at),
    sessions,
    activeSessionId: activeSession?.id ?? null,
    messages,
  };
}

export async function createCharacterChat(
  projectId: string,
  memberIds: string[],
  userCharacterId: string | null | undefined,
  contextSettings: unknown,
): Promise<CharacterChatDetail> {
  const conn = await getDb();
  const orderedMemberIds = uniqueStrings(memberIds);
  if (!orderedMemberIds.length) throw new ApiError("chatMembersRequired");
  const characters = await conn("entities")
    .join("entity_types", "entities.type_id", "entity_types.id")
    .where({ "entities.project_id": projectId, "entity_types.system_key": "character" })
    .whereIn("entities.id", orderedMemberIds);
  if (characters.length !== orderedMemberIds.length) throw new ApiError("chatMemberInvalid");
  const memberKey = [...orderedMemberIds].sort().join(":");
  const existing = (await conn("character_chats")
    .where({ project_id: projectId, member_key: memberKey })
    .first()) as Row | undefined;
  if (existing) return loadCharacterChat(String(existing.id));

  if (userCharacterId && orderedMemberIds.includes(userCharacterId))
    throw new ApiError("chatIdentityCannotBeMember");
  if (
    userCharacterId &&
    !(await conn("entities")
      .join("entity_types", "entities.type_id", "entity_types.id")
      .where({
        "entities.project_id": projectId,
        "entities.id": userCharacterId,
        "entity_types.system_key": "character",
      })
      .first())
  )
    throw new ApiError("chatIdentityInvalid");

  const chatId = newId();
  const sessionId = newId();
  const normalized = normalizeChatContextSettings(contextSettings, [
    ...orderedMemberIds,
    ...(userCharacterId ? [userCharacterId] : []),
  ]);
  await conn.transaction(async (trx) => {
    await trx("character_chats").insert({
      id: chatId,
      project_id: projectId,
      user_entity_id: userCharacterId || null,
      member_key: memberKey,
      context_settings: JSON.stringify(normalized),
    });
    await trx("character_chat_members").insert(
      orderedMemberIds.map((entityId, index) => ({
        chat_id: chatId,
        entity_id: entityId,
        sort_order: index,
      })),
    );
    await trx("character_chat_sessions").insert({ id: sessionId, chat_id: chatId, sort_order: 1 });
  });
  return loadCharacterChat(chatId, sessionId);
}

export async function updateCharacterChatContext(
  chatId: string,
  contextSettings: unknown,
): Promise<CharacterChatDetail> {
  const chat = await loadCharacterChat(chatId);
  const conn = await getDb();
  const [chapterRows, entityRows] = await Promise.all([
    conn("chapters").where({ project_id: chat.projectId }).select("id") as Promise<Row[]>,
    conn("entities").where({ project_id: chat.projectId }).select("id") as Promise<Row[]>,
  ]);
  const chapterIds = new Set(chapterRows.map((row) => String(row.id)));
  const entityIds = new Set(entityRows.map((row) => String(row.id)));
  const normalized = normalizeChatContextSettings(contextSettings, [
    ...chat.members.map((member) => member.id),
    ...(chat.userCharacter ? [chat.userCharacter.id] : []),
  ]);
  normalized.chapterIds = normalized.chapterIds.filter((id) => chapterIds.has(id));
  normalized.entityIds = normalized.entityIds.filter((id) => entityIds.has(id));
  await conn("character_chats")
    .where({ id: chatId })
    .update({ context_settings: JSON.stringify(normalized), updated_at: conn.fn.now() });
  return loadCharacterChat(chatId, chat.activeSessionId);
}

export async function createCharacterChatSession(chatId: string): Promise<CharacterChatSession> {
  const conn = await getDb();
  if (!(await conn("character_chats").where({ id: chatId }).first()))
    throw new ApiError("chatNotFound", 404);
  const last = (await conn("character_chat_sessions")
    .where({ chat_id: chatId })
    .max({ value: "sort_order" })
    .first()) as { value?: number } | undefined;
  const id = newId();
  await conn("character_chat_sessions").insert({
    id,
    chat_id: chatId,
    sort_order: Number(last?.value ?? 0) + 1,
  });
  await conn("character_chats").where({ id: chatId }).update({ updated_at: conn.fn.now() });
  return mapSession((await conn("character_chat_sessions").where({ id }).first()) as Row);
}

export async function deleteCharacterChatSession(sessionId: string): Promise<void> {
  const conn = await getDb();
  const session = (await conn("character_chat_sessions").where({ id: sessionId }).first()) as
    | Row
    | undefined;
  if (!session) throw new ApiError("chatSessionNotFound", 404);
  const count = Number(
    (
      (await conn("character_chat_sessions")
        .where({ chat_id: session.chat_id })
        .count({ count: "*" })
        .first()) as { count: number | string }
    ).count,
  );
  if (count <= 1) throw new ApiError("chatMustRetainSession");
  await conn("character_chat_sessions").where({ id: sessionId }).delete();
}

export async function deleteCharacterChatMessage(messageId: string): Promise<void> {
  const conn = await getDb();
  if (!(await conn("character_chat_messages").where({ id: messageId }).delete()))
    throw new ApiError("chatMessageNotFound", 404);
}

interface ResolvedChatModel {
  service: LlmService;
  model: LlmModel;
  settings: AppSettings;
  project: Project;
}

async function resolveChatModel(projectId: string): Promise<ResolvedChatModel> {
  const conn = await getDb();
  const projectRow = (await conn("projects").where({ id: projectId }).first()) as Row | undefined;
  if (!projectRow) throw new ApiError("projectNotFound", 404);
  const project = mapProject(projectRow);
  const [settings, services] = await Promise.all([loadSettings(), loadServices()]);
  const configuredModel =
    project.modelOverrides.chat || settings.taskModels.chat || settings.globalDefaultModel;
  if (!configuredModel) throw new ApiError("chatModelNotConfigured");
  const service = services.find((candidate) =>
    candidate.models.some((model) => model.id === configuredModel),
  );
  const model = service?.models.find((candidate) => candidate.id === configuredModel);
  if (!service || !model) throw new ApiError("chatModelMissing");
  return { service, model, settings, project };
}

async function requestModelText(
  resolved: ResolvedChatModel,
  system: string,
  prompt: string,
  maxTokens?: number,
  signal?: AbortSignal,
  onDelta?: (text: string) => void | Promise<void>,
): Promise<string> {
  const { service, model } = resolved;
  const content = await generateModelText({
    service,
    model,
    feature: "chat",
    system,
    prompt,
    maxTokens,
    signal,
    onDelta,
    project: { kind: "creative", id: resolved.project.id },
  });
  if (!content) throw new ApiError("modelEmptyContent", 502);
  return content;
}

function extractMentionedCharacterIds(content: string, members: Character[]): string[] {
  if (/<mention\s*\/>/i.test(content)) return members.map((member) => member.id);
  const names = [...content.matchAll(/<mention>\s*([^<]+?)\s*<\/mention>/gi)].map((match) =>
    match[1].trim(),
  );
  return members.filter((member) => names.includes(member.name)).map((member) => member.id);
}

function conversationXml(
  messages: CharacterChatMessage[],
  members: Character[],
  participantName: string,
) {
  const names = new Map(members.map((member) => [member.id, member.name]));
  return messages
    .map((message) =>
      message.role === "author"
        ? `  <message speaker="${escapeXml(participantName)}">${escapeXml(message.content)}</message>`
        : `  <message speaker="${escapeXml(names.get(message.characterId ?? "") ?? "Character")}">${escapeXml(message.content)}</message>`,
    )
    .join("\n");
}

async function buildChatContext(
  chat: CharacterChatDetail,
  project: Project,
  appSettings: AppSettings,
): Promise<string> {
  const conn = await getDb();
  const contextSettings = chat.contextSettings;
  const [chapterRows, entityRows] = await Promise.all([
    contextSettings.chapterIds.length
      ? (conn("chapters")
          .where({ project_id: chat.projectId })
          .whereIn("id", contextSettings.chapterIds)
          .orderBy("sort_order", "asc") as Promise<Row[]>)
      : [],
    contextSettings.entityIds.length ? loadEntities(chat.projectId, contextSettings.entityIds) : [],
  ]);
  const relations = await loadEntityRelations(
    chat.projectId,
    entityRows.map((entity) => entity.id),
  );
  const contextEntityIds = new Set(entityRows.map((entity) => entity.id));
  relations.forEach((relation) => {
    contextEntityIds.add(relation.sourceEntityId);
    contextEntityIds.add(relation.targetEntityId);
  });
  const contextEntities = await loadEntities(chat.projectId, [...contextEntityIds]);
  const entityNames = new Map(contextEntities.map((entity) => [entity.id, entity.name]));
  const chapters = (
    await Promise.all(
      chapterRows.map(async (row) => {
        const synopsis = String(row.synopsis ?? "").trim();
        if (contextSettings.preferChapterSynopsis && synopsis) {
          return `  <chapter id="${escapeXml(row.id)}"><title>${escapeXml(row.title)}</title><synopsis>${escapeXml(synopsis)}</synopsis></chapter>`;
        }
        const blocks = await loadBlocks(String(row.id));
        const prose = blocks
          .filter((block) => block.type === "text")
          .map(getBlockContent)
          .filter(Boolean)
          .join("\n\n");
        if (prose)
          return `  <chapter id="${escapeXml(row.id)}"><title>${escapeXml(row.title)}</title><prose>${escapeXml(prose)}</prose></chapter>`;
        if (synopsis)
          return `  <chapter id="${escapeXml(row.id)}"><title>${escapeXml(row.title)}</title><synopsis>${escapeXml(synopsis)}</synopsis></chapter>`;
        return null;
      }),
    )
  ).filter((chapter): chapter is string => chapter !== null);
  return `<project_context>
${contextSettings.includeStorySynopsis ? `  <story_synopsis>${escapeXml(project.synopsis)}</story_synopsis>` : ""}
  <output_language>${escapeXml(project.language || appSettings.language)}</output_language>
  <entities>
${contextEntities.map((entity) => `    <entity id="${escapeXml(entity.id)}" type="${escapeXml(entity.type.systemKey ?? entity.type.name)}" name="${escapeXml(entity.name)}">${escapeXml(entity.description)}</entity>`).join("\n")}
  </entities>
  <entity_relations>
${relations.map((relation) => `    <relation source_entity_id="${escapeXml(relation.sourceEntityId)}" target_entity_id="${escapeXml(relation.targetEntityId)}" expression="${escapeXml(relation.name)}"><statement>${escapeXml(formatEntityRelation(relation.name, entityNames.get(relation.sourceEntityId) ?? relation.sourceEntityId, entityNames.get(relation.targetEntityId) ?? relation.targetEntityId))}</statement><description>${escapeXml(relation.description)}</description></relation>`).join("\n")}
  </entity_relations>
  <chapters>
${chapters.join("\n")}
  </chapters>
</project_context>`;
}

async function selectResponders(
  resolved: ResolvedChatModel,
  chat: CharacterChatDetail,
  messages: CharacterChatMessage[],
  context: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const memberList = chat.members
    .map((member) => `- ${member.id}: ${member.name} — ${member.description}`)
    .join("\n");
  const participantName = chat.userCharacter?.name ?? "Author";
  const prompt = `${context}\n<human_participant>${escapeXml(participantName)}</human_participant>\n<members>\n${memberList}\n</members>\n<conversation_history>\n${conversationXml(messages, chat.members, participantName)}\n</conversation_history>\nChoose which one or more characters should directly respond to the participant's latest message. Base the choice on the conversational exchange, not on advancing the story plot. Return JSON only: {"characterIds":["exact-id"]}. Preserve member order when several should reply.`;
  const response = await requestModelText(
    resolved,
    "You select the most natural next speakers in a calm, out-of-scene character conversation. Do not roleplay, continue the plot, or use tools.",
    prompt,
    512,
    signal,
  );
  try {
    const fenced = response.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? response;
    const start = fenced.indexOf("{");
    const end = fenced.lastIndexOf("}");
    const parsed = JSON.parse(
      start >= 0 && end > start ? fenced.slice(start, end + 1) : fenced,
    ) as { characterIds?: unknown };
    const allowed = new Set(chat.members.map((member) => member.id));
    const selected = uniqueStrings(parsed.characterIds).filter((id) => allowed.has(id));
    return selected.length ? selected : [chat.members[0].id];
  } catch {
    return [chat.members[0].id];
  }
}

async function generateCharacterResponse(
  resolved: ResolvedChatModel,
  chat: CharacterChatDetail,
  character: Character,
  messages: CharacterChatMessage[],
  context: string,
  signal?: AbortSignal,
  onDelta?: (text: string) => void | Promise<void>,
): Promise<string> {
  const mentionInstruction =
    chat.members.length > 1 && chat.contextSettings.allowCharacterMentions
      ? "You may request another member's immediate reply using <mention>Name</mention>, or all members using <mention/>. Use these expressions only when the story naturally calls for another speaker."
      : "Do not output mention expressions; the Author controls the next turn.";
  const participantName = chat.userCharacter?.name ?? "Author";
  const participantInstruction = chat.userCharacter
    ? `The human participant speaks as ${chat.userCharacter.name}. Their character profile is provided only so you understand their identity and relationship to you: ${chat.userCharacter.description}`
    : "The human participant is the Author. Speak openly and sincerely, as in a candid personal interview where you are willing to share genuine thoughts and feelings.";
  const system = `You are ${character.name} in a calm conversation outside any active story scene. Remain psychologically consistent with this character profile without performing the plot:\n${character.description}\n${participantInstruction}\nProject and chapter context is background knowledge and memory only. It is not a plan, current scene, or sequence of events to enact. Do not advance, continue, reenact, predict, or narrate the story unless the participant explicitly asks you to do so. Do not repeat your motives, goals, history, relationships, or profile merely to demonstrate character; mention them only when directly relevant to the latest message. Respond naturally and directly. You may reflect, hesitate, admit uncertainty, or reveal contradictions. By default, use spoken dialogue only: no stage directions, action beats, environmental description, or narration. Reply only as ${character.name}; never write ${participantName}'s words and never reply for another character. Do not use tools. ${mentionInstruction}`;
  const prompt = `${context}\n<conversation_history>\n${conversationXml(messages, chat.members, participantName)}\n</conversation_history>\nRespond directly to ${escapeXml(participantName)}'s latest message as ${escapeXml(character.name)}. Return only the spoken reply. Do not summarize the conversation or restate background context.`;
  return requestModelText(
    resolved,
    system,
    prompt,
    resolved.settings.replyCaps.chat ?? undefined,
    signal,
    onDelta,
  );
}

function trailingCharacterMessageCount(messages: CharacterChatMessage[]) {
  let count = 0;
  for (
    let index = messages.length - 1;
    index >= 0 && messages[index].role === "character";
    index -= 1
  )
    count += 1;
  return count;
}

export interface CharacterChatTurnEvents {
  onAuthorMessage?: (message: CharacterChatMessage) => void | Promise<void>;
  onCharacterStart?: (message: CharacterChatMessage) => void | Promise<void>;
  onCharacterDelta?: (messageId: string, text: string) => void | Promise<void>;
  onCharacterComplete?: (message: CharacterChatMessage) => void | Promise<void>;
}

export async function runCharacterChatTurn(
  sessionId: string,
  body: { content?: string; characterIds?: string[] },
  signal?: AbortSignal,
  events: CharacterChatTurnEvents = {},
): Promise<CharacterChatDetail> {
  signal?.throwIfAborted();
  const conn = await getDb();
  const sessionRow = (await conn("character_chat_sessions").where({ id: sessionId }).first()) as
    | Row
    | undefined;
  if (!sessionRow) throw new ApiError("chatSessionNotFound", 404);
  const chat = await loadCharacterChat(String(sessionRow.chat_id), sessionId);
  const content = body.content?.trim() ?? "";
  const allowedIds = new Set(chat.members.map((member) => member.id));
  const directIds = uniqueStrings(body.characterIds).filter((id) => allowedIds.has(id));
  if (!content && !directIds.length) throw new ApiError("messageRequired");
  if (content.length > 12000) throw new ApiError("messageTooLong");

  const messages = [...chat.messages];
  if (content) {
    const authorMessage: CharacterChatMessage = {
      id: newId(),
      sessionId,
      role: "author",
      characterId: null,
      content,
      createdAt: new Date().toISOString(),
    };
    await conn("character_chat_messages").insert({
      id: authorMessage.id,
      session_id: sessionId,
      role: "author",
      content,
      created_at: authorMessage.createdAt,
    });
    messages.push(authorMessage);
    await events.onAuthorMessage?.(authorMessage);
  }

  signal?.throwIfAborted();
  const resolved = await resolveChatModel(chat.projectId);
  const maxReplies = resolved.settings.characterChatMaxConsecutiveReplies;
  let usedReplies = content ? 0 : trailingCharacterMessageCount(messages);
  if (usedReplies >= maxReplies) throw new ApiError("chatAuthorTurnRequired");
  const context = await buildChatContext(chat, resolved.project, resolved.settings);
  let targets = directIds;
  if (content && !targets.length) {
    if (chat.members.length === 1) {
      targets = [chat.members[0].id];
    } else {
      targets = extractMentionedCharacterIds(content, chat.members);
      if (!targets.length)
        targets = await selectResponders(resolved, chat, messages, context, signal);
    }
  }

  const queue = [...targets];
  while (queue.length && usedReplies < maxReplies) {
    signal?.throwIfAborted();
    const characterId = queue.shift();
    const character = chat.members.find((member) => member.id === characterId);
    if (!character) continue;
    const messageId = newId();
    const createdAt = new Date().toISOString();
    await events.onCharacterStart?.({
      id: messageId,
      sessionId,
      role: "character",
      characterId: character.id,
      content: "",
      createdAt,
    });
    const response = await generateCharacterResponse(
      resolved,
      chat,
      character,
      messages,
      context,
      signal,
      (text) => events.onCharacterDelta?.(messageId, text),
    );
    signal?.throwIfAborted();
    const characterMessage: CharacterChatMessage = {
      id: messageId,
      sessionId,
      role: "character",
      characterId: character.id,
      content: response,
      createdAt,
    };
    await conn("character_chat_messages").insert({
      id: characterMessage.id,
      session_id: sessionId,
      role: "character",
      speaker_entity_id: character.id,
      content: response,
      created_at: characterMessage.createdAt,
    });
    messages.push(characterMessage);
    await events.onCharacterComplete?.(characterMessage);
    usedReplies += 1;
    if (chat.members.length > 1 && chat.contextSettings.allowCharacterMentions) {
      for (const mentionedId of extractMentionedCharacterIds(response, chat.members)) {
        if (mentionedId !== character.id && !queue.includes(mentionedId)) queue.push(mentionedId);
      }
    }
  }

  await Promise.all([
    conn("character_chat_sessions").where({ id: sessionId }).update({ updated_at: conn.fn.now() }),
    conn("character_chats").where({ id: chat.id }).update({ updated_at: conn.fn.now() }),
  ]);
  return loadCharacterChat(chat.id, sessionId);
}
