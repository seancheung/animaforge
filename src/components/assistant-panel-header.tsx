import { Bot } from "lucide-react";

export function AssistantPanelHeader({ title }: { title: string }) {
  return (
    <div className="flex h-14 shrink-0 items-center gap-2.5 border-zinc-200 border-b px-4">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100">
        <Bot className="size-4 text-zinc-600" />
      </span>
      <h2 className="min-w-0 truncate font-semibold text-sm text-zinc-900">{title}</h2>
    </div>
  );
}
