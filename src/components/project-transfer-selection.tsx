"use client";

import { Check, LockKeyhole } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  allProjectTransferSections,
  normalizeProjectTransferSelection,
  type ProjectTransferSection,
  type ProjectTransferSelection,
  projectTransferSectionKeys,
} from "@/lib/project-transfer-selection";
import { cn } from "@/lib/utils";

export function ProjectTransferSelectionList({
  value,
  onChange,
  disabled = false,
}: {
  value: ProjectTransferSelection;
  onChange: (value: ProjectTransferSelection) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("ProjectTransfer");
  const allSelected = projectTransferSectionKeys.every((key) => value[key]);
  const chatRequiresEntities = value.chats;
  const historyRequiresManuscript = value.manuscriptHistory;

  const toggle = (section: ProjectTransferSection) => {
    if (
      disabled ||
      (section === "entities" && chatRequiresEntities) ||
      (section === "manuscript" && historyRequiresManuscript)
    )
      return;
    const next = { ...value, [section]: !value[section] };
    onChange(normalizeProjectTransferSelection(next));
  };

  return (
    <div>
      <button
        type="button"
        role="checkbox"
        aria-checked={allSelected}
        disabled={disabled}
        onClick={() =>
          onChange(
            allSelected ? normalizeProjectTransferSelection({}) : { ...allProjectTransferSections },
          )
        }
        className="focus-ring flex w-full items-center justify-between rounded-lg px-1 py-2 text-left disabled:opacity-50"
      >
        <span>
          <span className="block font-semibold text-sm text-zinc-900">{t("selectAll")}</span>
          <span className="mt-0.5 block text-[11px] text-zinc-400">{t("selectAllHint")}</span>
        </span>
        <SelectionMark checked={allSelected} />
      </button>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {projectTransferSectionKeys.map((section) => {
          const locked =
            (section === "entities" && chatRequiresEntities) ||
            (section === "manuscript" && historyRequiresManuscript);
          const dependencyDescription =
            section === "entities"
              ? t("entitiesRequiredByChats")
              : t("manuscriptRequiredByHistory");
          return (
            <button
              key={section}
              type="button"
              role="checkbox"
              aria-checked={value[section]}
              disabled={disabled || locked}
              onClick={() => toggle(section)}
              className={cn(
                "focus-ring flex min-h-20 items-start gap-3 rounded-xl border p-3 text-left transition disabled:cursor-not-allowed",
                value[section]
                  ? "border-zinc-400 bg-zinc-50"
                  : "border-zinc-200 bg-white hover:border-zinc-300",
                disabled && "opacity-50",
              )}
            >
              <SelectionMark checked={value[section]} className="mt-0.5" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 font-medium text-sm text-zinc-900">
                  {t(section)}
                  {locked ? <LockKeyhole className="size-3 text-zinc-400" /> : null}
                </span>
                <span className="mt-1 block text-[11px] text-zinc-500 leading-4">
                  {locked ? dependencyDescription : t(`${section}Description`)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SelectionMark({ checked, className }: { checked: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-md border transition",
        checked ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-300 bg-white",
        className,
      )}
    >
      {checked ? <Check className="size-3.5" /> : null}
    </span>
  );
}
