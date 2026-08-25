"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Boxes, GitBranch, Pencil, Plus, Search, Tags, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AssistantPanelHeader } from "@/components/assistant-panel-header";
import { CreativeAssistant } from "@/components/creative-assistant";
import { ResizablePanel } from "@/components/resizable-panel";
import {
  Button,
  ConfirmDialog,
  Input,
  Label,
  Modal,
  Select,
  Switch,
  Textarea,
} from "@/components/ui";
import { api } from "@/lib/client";
import type { AssistantProposalItem, Entity, EntityRelation, EntityType } from "@/lib/types";
import { cn } from "@/lib/utils";

type EntityDraft = {
  typeId: string;
  name: string;
  description: string;
  alwaysInclude: boolean;
};
type RelationDraft = {
  sourceEntityId: string;
  targetEntityId: string;
  name: string;
  description: string;
  alwaysInclude: boolean;
};
type TypeDraft = { name: string; description: string };

const emptyEntity = (typeId = "system-character"): EntityDraft => ({
  typeId,
  name: "",
  description: "",
  alwaysInclude: false,
});
const emptyRelation = (entities: Entity[]): RelationDraft => ({
  sourceEntityId: entities[0]?.id ?? "",
  targetEntityId: entities[1]?.id ?? "",
  name: "",
  description: "",
  alwaysInclude: false,
});

export function EntityWorkspace({
  projectId,
  entities,
  entityTypes,
  relations,
  onAssistantApplied,
}: {
  projectId: string;
  entities: Entity[];
  entityTypes: EntityType[];
  relations: EntityRelation[];
  onAssistantApplied: (item: AssistantProposalItem) => void;
}) {
  const t = useTranslations("Entities");
  const projectT = useTranslations("Project");
  const common = useTranslations("Common");
  const client = useQueryClient();
  const [tab, setTab] = useState<"entities" | "relations" | "types">("entities");
  const [typeFilter, setTypeFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [typeKindFilter, setTypeKindFilter] = useState<"all" | "system" | "custom">("all");
  const [typeSearchQuery, setTypeSearchQuery] = useState("");
  const [entityOpen, setEntityOpen] = useState(false);
  const [relationOpen, setRelationOpen] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
  const [editingEntity, setEditingEntity] = useState<Entity | null>(null);
  const [editingRelation, setEditingRelation] = useState<EntityRelation | null>(null);
  const [editingType, setEditingType] = useState<EntityType | null>(null);
  const [entityDraft, setEntityDraft] = useState<EntityDraft>(emptyEntity());
  const [relationDraft, setRelationDraft] = useState<RelationDraft>(emptyRelation(entities));
  const [typeDraft, setTypeDraft] = useState<TypeDraft>({ name: "", description: "" });
  const [deleteTarget, setDeleteTarget] = useState<{
    kind: "entity" | "relation" | "type";
    id: string;
    name: string;
  } | null>(null);

  const typeName = (type: EntityType) =>
    type.systemKey ? t(`systemTypes.${type.systemKey}` as never) : type.name;
  const typeDescription = (type: EntityType) =>
    type.systemKey ? t(`systemTypeDescriptions.${type.systemKey}` as never) : type.description;
  const entityById = useMemo(
    () => new Map(entities.map((entity) => [entity.id, entity])),
    [entities],
  );
  const refresh = () => {
    client.invalidateQueries({ queryKey: ["project", projectId] });
    client.invalidateQueries({ queryKey: ["chapter"] });
    client.invalidateQueries({ queryKey: ["chats", projectId] });
  };

  const saveEntity = useMutation({
    mutationFn: () =>
      editingEntity
        ? api(`/api/entities/${editingEntity.id}`, {
            method: "PATCH",
            body: JSON.stringify(entityDraft),
          })
        : api(`/api/projects/${projectId}/entities`, {
            method: "POST",
            body: JSON.stringify(entityDraft),
          }),
    onSuccess: () => {
      refresh();
      setEntityOpen(false);
    },
    onError: (error) => toast.error(error.message),
  });
  const saveRelation = useMutation({
    mutationFn: () =>
      editingRelation
        ? api(`/api/entity-relations/${editingRelation.id}`, {
            method: "PATCH",
            body: JSON.stringify(relationDraft),
          })
        : api(`/api/projects/${projectId}/entity-relations`, {
            method: "POST",
            body: JSON.stringify(relationDraft),
          }),
    onSuccess: () => {
      refresh();
      setRelationOpen(false);
    },
    onError: (error) => toast.error(error.message),
  });
  const saveType = useMutation({
    mutationFn: () =>
      editingType
        ? api(`/api/entity-types/${editingType.id}`, {
            method: "PATCH",
            body: JSON.stringify(typeDraft),
          })
        : api(`/api/projects/${projectId}/entity-types`, {
            method: "POST",
            body: JSON.stringify(typeDraft),
          }),
    onSuccess: () => {
      refresh();
      setTypeOpen(false);
      setEditingType(null);
      setTypeDraft({ name: "", description: "" });
    },
    onError: (error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: (target: NonNullable<typeof deleteTarget>) =>
      api(
        target.kind === "entity"
          ? `/api/entities/${target.id}`
          : target.kind === "relation"
            ? `/api/entity-relations/${target.id}`
            : `/api/entity-types/${target.id}`,
        { method: "DELETE" },
      ),
    onSuccess: () => {
      refresh();
      setDeleteTarget(null);
    },
    onError: (error) => toast.error(error.message),
  });

  const openEntity = (entity?: Entity) => {
    setEditingEntity(entity ?? null);
    setEntityDraft(
      entity
        ? {
            typeId: entity.typeId,
            name: entity.name,
            description: entity.description,
            alwaysInclude: entity.alwaysInclude,
          }
        : emptyEntity(entityTypes[0]?.id),
    );
    setEntityOpen(true);
  };
  const openRelation = (relation?: EntityRelation) => {
    setEditingRelation(relation ?? null);
    setRelationDraft(
      relation
        ? {
            sourceEntityId: relation.sourceEntityId,
            targetEntityId: relation.targetEntityId,
            name: relation.name,
            description: relation.description,
            alwaysInclude: relation.alwaysInclude,
          }
        : emptyRelation(entities),
    );
    setRelationOpen(true);
  };
  const openType = (type?: EntityType) => {
    setEditingType(type ?? null);
    setTypeDraft(
      type ? { name: type.name, description: type.description } : { name: "", description: "" },
    );
    setTypeOpen(true);
  };
  const normalizedSearch = searchQuery.trim().toLocaleLowerCase();
  const visibleEntities = entities.filter((entity) => {
    if (typeFilter !== "all" && entity.typeId !== typeFilter) return false;
    if (!normalizedSearch) return true;
    return [entity.name, entity.description, typeName(entity.type)].some((value) =>
      value.toLocaleLowerCase().includes(normalizedSearch),
    );
  });
  const normalizedTypeSearch = typeSearchQuery.trim().toLocaleLowerCase();
  const visibleEntityTypes = entityTypes.filter((type) => {
    if (typeKindFilter === "system" && !type.systemKey) return false;
    if (typeKindFilter === "custom" && type.systemKey) return false;
    if (!normalizedTypeSearch) return true;
    return [typeName(type), typeDescription(type)].some((value) =>
      value.toLocaleLowerCase().includes(normalizedTypeSearch),
    );
  });

  return (
    <div className="flex h-full min-h-0 bg-zinc-50">
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-zinc-200 border-b bg-white px-5">
          <div className="flex rounded-lg bg-zinc-100 p-1">
            {(["entities", "relations", "types"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setTab(item)}
                className={cn(
                  "rounded-md px-3 py-1.5 font-medium text-xs transition",
                  tab === item ? "bg-white text-zinc-950 shadow-sm" : "text-zinc-500",
                )}
              >
                {t(item)}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={tab === "relations" && entities.length < 2}
              onClick={() => {
                if (tab === "entities") openEntity();
                else if (tab === "relations") openRelation();
                else openType();
              }}
            >
              <Plus className="size-3.5" />
              {tab === "entities"
                ? t("newEntity")
                : tab === "relations"
                  ? t("newRelation")
                  : t("newCustomType")}
            </Button>
          </div>
        </header>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-6 pt-7 pb-10">
          <div className="mb-6">
            <h1 className="font-semibold text-2xl tracking-tight">
              {tab === "entities"
                ? t("title")
                : tab === "relations"
                  ? t("relationsTitle")
                  : t("typesTitle")}
            </h1>
            <p className="mt-1.5 text-sm text-zinc-500">
              {tab === "entities"
                ? t("description")
                : tab === "relations"
                  ? t("relationsDescription")
                  : t("typesDescription")}
            </p>
          </div>
          {tab === "entities" ? (
            <>
              <div className="mb-5 flex max-w-2xl flex-col gap-3 sm:flex-row">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400" />
                  <Input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder={t("searchPlaceholder")}
                    aria-label={t("searchPlaceholder")}
                    className="pl-9"
                  />
                </div>
                <div className="w-full sm:w-56">
                  <Select
                    value={typeFilter}
                    onChange={setTypeFilter}
                    options={[
                      { value: "all", label: t("allTypes") },
                      ...entityTypes.map((type) => ({ value: type.id, label: typeName(type) })),
                    ]}
                  />
                </div>
              </div>
              {visibleEntities.length ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-3">
                  {visibleEntities.map((entity) => (
                    <article
                      key={entity.id}
                      className="group relative h-48 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm"
                    >
                      <button
                        type="button"
                        onClick={() => openEntity(entity)}
                        className="h-full w-full text-left"
                      >
                        <span className="flex items-center gap-3 pr-16">
                          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-zinc-100">
                            <Boxes className="size-4 text-zinc-600" />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-semibold text-sm">
                              {entity.name}
                            </span>
                            <span className="mt-0.5 block text-xs text-zinc-400">
                              {typeName(entity.type)}
                            </span>
                          </span>
                        </span>
                        <span className="mt-3 line-clamp-3 text-sm text-zinc-500 leading-6">
                          {entity.description || t("noDescription")}
                        </span>
                        {entity.alwaysInclude ? (
                          <span className="mt-3 inline-flex rounded-md bg-zinc-100 px-2 py-1 text-[11px] text-zinc-600">
                            {t("alwaysIncluded")}
                          </span>
                        ) : null}
                      </button>
                      <Button
                        className="absolute top-3 right-3 opacity-0 group-hover:opacity-100"
                        variant="ghost"
                        size="icon"
                        onClick={() =>
                          setDeleteTarget({ kind: "entity", id: entity.id, name: entity.name })
                        }
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={
                    entities.length ? <Search className="size-6" /> : <Boxes className="size-6" />
                  }
                  title={entities.length ? t("noMatches") : t("empty")}
                  action={entities.length ? t("clearFilters") : t("newEntity")}
                  onClick={() => {
                    if (entities.length) {
                      setSearchQuery("");
                      setTypeFilter("all");
                    } else openEntity();
                  }}
                />
              )}
            </>
          ) : tab === "relations" ? (
            relations.length ? (
              <div className="space-y-3">
                {relations.map((relation) => (
                  <article
                    key={relation.id}
                    className="group relative rounded-xl border border-zinc-200 bg-white p-4 shadow-sm"
                  >
                    <button
                      type="button"
                      onClick={() => openRelation(relation)}
                      className="w-full pr-16 text-left"
                    >
                      <div className="flex flex-wrap items-center gap-2 font-medium text-sm">
                        <span>
                          {entityById.get(relation.sourceEntityId)?.name ?? t("missingEntity")}
                        </span>
                        <ArrowRight className="size-3.5 text-zinc-400" />
                        <span className="rounded-md bg-zinc-100 px-2 py-1 text-xs">
                          {relation.name}
                        </span>
                        <ArrowRight className="size-3.5 text-zinc-400" />
                        <span>
                          {entityById.get(relation.targetEntityId)?.name ?? t("missingEntity")}
                        </span>
                      </div>
                      {relation.description ? (
                        <p className="mt-3 text-sm text-zinc-500 leading-6">
                          {relation.description}
                        </p>
                      ) : null}
                    </button>
                    <Button
                      className="absolute top-3 right-3 opacity-0 group-hover:opacity-100"
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        setDeleteTarget({ kind: "relation", id: relation.id, name: relation.name })
                      }
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<GitBranch className="size-6" />}
                title={t("relationsEmpty")}
                action={t("newRelation")}
                onClick={() => openRelation()}
                disabled={entities.length < 2}
              />
            )
          ) : (
            <>
              <div className="mb-5 flex max-w-2xl flex-col gap-3 sm:flex-row">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400" />
                  <Input
                    value={typeSearchQuery}
                    onChange={(event) => setTypeSearchQuery(event.target.value)}
                    placeholder={t("typeSearchPlaceholder")}
                    aria-label={t("typeSearchPlaceholder")}
                    className="pl-9"
                  />
                </div>
                <div className="w-full sm:w-56">
                  <Select
                    value={typeKindFilter}
                    onChange={(value) => setTypeKindFilter(value as "all" | "system" | "custom")}
                    options={[
                      { value: "all", label: t("allTypeKinds") },
                      { value: "system", label: t("systemType") },
                      { value: "custom", label: t("customType") },
                    ]}
                  />
                </div>
              </div>
              {visibleEntityTypes.length ? (
                <div className="space-y-3">
                  {visibleEntityTypes.map((type) => (
                    <article
                      key={type.id}
                      className="flex items-center justify-between gap-4 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm"
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-zinc-100">
                          <Tags className="size-4 text-zinc-600" />
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="font-semibold text-sm">{typeName(type)}</h2>
                            <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-500">
                              {type.systemKey ? t("systemType") : t("customType")}
                            </span>
                          </div>
                          <p className="mt-1 text-sm text-zinc-500 leading-6">
                            {typeDescription(type) || t("noTypeDescription")}
                          </p>
                        </div>
                      </div>
                      {!type.systemKey ? (
                        <div className="flex shrink-0 gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openType(type)}>
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                              setDeleteTarget({ kind: "type", id: type.id, name: type.name })
                            }
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={<Search className="size-6" />}
                  title={t("noTypeMatches")}
                  action={t("clearTypeFilters")}
                  onClick={() => {
                    setTypeSearchQuery("");
                    setTypeKindFilter("all");
                  }}
                />
              )}
            </>
          )}
        </div>
      </section>

      <ResizablePanel storageKey="project-assistant" className="flex flex-col">
        <AssistantPanelHeader title={projectT("assistant")} />
        <CreativeAssistant
          projectId={projectId}
          scope="project"
          embedded
          onApplied={onAssistantApplied}
        />
      </ResizablePanel>

      <Modal
        open={entityOpen}
        onOpenChange={setEntityOpen}
        title={editingEntity ? t("editEntity") : t("newEntity")}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            saveEntity.mutate();
          }}
        >
          <div className="space-y-4 p-5">
            <div>
              <Label>{t("type")}</Label>
              <Select
                value={entityDraft.typeId}
                onChange={(typeId) => setEntityDraft({ ...entityDraft, typeId })}
                options={entityTypes.map((type) => ({
                  value: type.id,
                  label: typeName(type),
                  description: typeDescription(type),
                }))}
              />
            </div>
            <div>
              <Label>{t("name")}</Label>
              <Input
                autoFocus
                required
                value={entityDraft.name}
                onChange={(event) => setEntityDraft({ ...entityDraft, name: event.target.value })}
              />
            </div>
            <div>
              <Label>{t("entityDescription")}</Label>
              <Textarea
                className="min-h-48"
                value={entityDraft.description}
                onChange={(event) =>
                  setEntityDraft({ ...entityDraft, description: event.target.value })
                }
                placeholder={t("descriptionPlaceholder")}
              />
            </div>
            <div className="rounded-lg border border-zinc-200 p-3">
              <Switch
                checked={entityDraft.alwaysInclude}
                onChange={(alwaysInclude) => setEntityDraft({ ...entityDraft, alwaysInclude })}
                label={t("alwaysInclude")}
                description={t("alwaysIncludeDescription")}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 border-zinc-100 border-t p-3">
            <Button type="button" variant="secondary" onClick={() => setEntityOpen(false)}>
              {common("cancel")}
            </Button>
            <Button type="submit" loading={saveEntity.isPending}>
              {common("save")}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={relationOpen}
        onOpenChange={setRelationOpen}
        title={editingRelation ? t("editRelation") : t("newRelation")}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            saveRelation.mutate();
          }}
        >
          <div className="space-y-4 p-5">
            <div>
              <Label>{t("sourceEntity")}</Label>
              <Select
                value={relationDraft.sourceEntityId}
                onChange={(sourceEntityId) =>
                  setRelationDraft({ ...relationDraft, sourceEntityId })
                }
                options={entities.map((entity) => ({
                  value: entity.id,
                  label: entity.name,
                  description: typeName(entity.type),
                }))}
              />
            </div>
            <div>
              <Label>{t("relationName")}</Label>
              <Input
                required
                value={relationDraft.name}
                onChange={(event) =>
                  setRelationDraft({ ...relationDraft, name: event.target.value })
                }
                placeholder={t("relationNamePlaceholder")}
              />
            </div>
            <div>
              <Label>{t("targetEntity")}</Label>
              <Select
                value={relationDraft.targetEntityId}
                onChange={(targetEntityId) =>
                  setRelationDraft({ ...relationDraft, targetEntityId })
                }
                options={entities.map((entity) => ({
                  value: entity.id,
                  label: entity.name,
                  description: typeName(entity.type),
                }))}
              />
            </div>
            <div>
              <Label>{t("relationDescription")}</Label>
              <Textarea
                className="min-h-36"
                value={relationDraft.description}
                onChange={(event) =>
                  setRelationDraft({ ...relationDraft, description: event.target.value })
                }
              />
            </div>
            <div className="rounded-lg border border-zinc-200 p-3">
              <Switch
                checked={relationDraft.alwaysInclude}
                onChange={(alwaysInclude) => setRelationDraft({ ...relationDraft, alwaysInclude })}
                label={t("alwaysInclude")}
                description={t("relationAlwaysIncludeDescription")}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 border-zinc-100 border-t p-3">
            <Button type="button" variant="secondary" onClick={() => setRelationOpen(false)}>
              {common("cancel")}
            </Button>
            <Button type="submit" loading={saveRelation.isPending}>
              {common("save")}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={typeOpen}
        onOpenChange={setTypeOpen}
        title={editingType ? t("editCustomType") : t("newCustomType")}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            saveType.mutate();
          }}
        >
          <div className="space-y-4 p-5">
            <div>
              <Label>{t("typeName")}</Label>
              <Input
                autoFocus
                required
                value={typeDraft.name}
                onChange={(event) => setTypeDraft({ ...typeDraft, name: event.target.value })}
              />
            </div>
            <div>
              <Label>{t("typeDescription")}</Label>
              <Textarea
                value={typeDraft.description}
                onChange={(event) =>
                  setTypeDraft({ ...typeDraft, description: event.target.value })
                }
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 border-zinc-100 border-t p-3">
            <Button type="button" variant="secondary" onClick={() => setTypeOpen(false)}>
              {common("cancel")}
            </Button>
            <Button type="submit" loading={saveType.isPending}>
              {editingType ? common("save") : t("addType")}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t("deleteTitle", { name: deleteTarget?.name ?? "" })}
        description={t(
          deleteTarget?.kind === "type"
            ? "deleteTypeDescription"
            : deleteTarget?.kind === "relation"
              ? "deleteRelationDescription"
              : "deleteEntityDescription",
        )}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget)}
        loading={remove.isPending}
      />
    </div>
  );
}

function EmptyState({
  icon,
  title,
  action,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  title: string;
  action: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex min-h-72 w-full flex-col items-center justify-center rounded-xl border border-zinc-200 border-dashed text-zinc-400 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
    >
      {icon}
      <span className="mt-3 font-medium text-sm">{title}</span>
      <span className="mt-1 text-xs">{action}</span>
    </button>
  );
}
