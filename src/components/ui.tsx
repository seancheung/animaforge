// biome-ignore-all lint: correctness/useExhaustiveDependencies Floating UI callback refs are intentionally attached during render.
"use client";

import {
  autoUpdate,
  FloatingFocusManager,
  FloatingOverlay,
  FloatingPortal,
  flip,
  offset,
  shift,
  size,
  useClick,
  useDismiss,
  useFloating,
  useHover,
  useInteractions,
  useRole,
} from "@floating-ui/react";
import { Check, ChevronDown, LoaderCircle, Minus, Plus, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

function useCssPresence(open: boolean, exitDuration: number) {
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) {
      if (!mounted) setMounted(true);
      return;
    }
    if (!mounted) return;
    const timer = window.setTimeout(() => setMounted(false), exitDuration);
    return () => window.clearTimeout(timer);
  }, [exitDuration, mounted, open]);

  // Mount on the opening render so the dialog does not lose a frame before its entrance animation.
  return open || mounted;
}

export function Button({
  variant = "primary",
  size = "md",
  loading,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "icon";
  loading?: boolean;
}) {
  return (
    <button
      className={cn(
        "focus-ring inline-flex shrink-0 items-center justify-center gap-2 rounded-lg font-medium transition disabled:pointer-events-none disabled:opacity-45",
        size === "sm" && "h-8 px-3 text-xs",
        size === "md" && "h-9 px-3.5 text-sm",
        size === "icon" && "size-8 p-0",
        variant === "primary" && "bg-zinc-950 text-white shadow-sm hover:bg-zinc-800",
        variant === "secondary" &&
          "border border-zinc-200 bg-white text-zinc-800 shadow-sm hover:bg-zinc-50",
        variant === "ghost" && "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950",
        variant === "danger" && "bg-red-600 text-white hover:bg-red-500",
        className,
      )}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" /> : null}
      {size === "icon" && loading ? null : children}
    </button>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "focus-ring h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm placeholder:text-zinc-400",
        props.className,
      )}
    />
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        "focus-ring min-h-24 w-full resize-y rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm leading-6 placeholder:text-zinc-400",
        props.className,
      )}
    />
  );
}

export function Label({ children }: { children: React.ReactNode }) {
  return <label className="mb-1.5 block font-medium text-xs text-zinc-700">{children}</label>;
}

export type StepStatus = "complete" | "current" | "upcoming" | "skipped" | "error";

export interface StepItem {
  id: string;
  label: string;
  description?: string;
  status: StepStatus;
  selected?: boolean;
  onClick?: () => void;
}

export function Steps({ items, className }: { items: StepItem[]; className?: string }) {
  return (
    <ol className={cn("flex min-w-max", className)}>
      {items.map((item, index) => {
        const interactive = Boolean(item.onClick);
        const content = (
          <>
            <span className="flex w-full items-center">
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full border font-semibold text-[11px] transition-colors",
                  item.status === "complete" && "border-zinc-950 bg-zinc-950 text-white",
                  item.status === "current" &&
                    "border-zinc-950 bg-white text-zinc-950 ring-4 ring-zinc-100",
                  item.status === "upcoming" && "border-zinc-200 bg-white text-zinc-400",
                  item.status === "skipped" &&
                    "border-zinc-300 border-dashed bg-zinc-50 text-zinc-400",
                  item.status === "error" &&
                    "border-red-600 bg-red-50 text-red-600 ring-4 ring-red-50",
                )}
              >
                {item.status === "complete" ? (
                  <Check className="size-3.5" />
                ) : item.status === "current" ? (
                  <span className="size-2 rounded-full bg-zinc-950" />
                ) : item.status === "skipped" ? (
                  <Minus className="size-3.5" />
                ) : item.status === "error" ? (
                  <X className="size-3.5" />
                ) : (
                  index + 1
                )}
              </span>
              {index < items.length - 1 ? (
                <span
                  className={cn(
                    "mx-2 h-px min-w-8 flex-1",
                    item.status === "complete" || item.status === "skipped"
                      ? "bg-zinc-800"
                      : "bg-zinc-200",
                  )}
                />
              ) : null}
            </span>
            <span
              className={cn(
                "mt-2 block truncate pr-4 font-medium text-xs",
                item.status === "upcoming" || item.status === "skipped"
                  ? "text-zinc-400"
                  : item.status === "error"
                    ? "text-red-700"
                    : "text-zinc-800",
              )}
            >
              {item.label}
            </span>
            {item.description ? (
              <span
                className={cn(
                  "mt-0.5 block truncate pr-4 text-[11px]",
                  item.status === "error" ? "text-red-500" : "text-zinc-400",
                )}
              >
                {item.description}
              </span>
            ) : null}
          </>
        );

        return (
          <li key={item.id} className="min-w-28 flex-1 last:min-w-20">
            {interactive ? (
              <button
                type="button"
                onClick={item.onClick}
                aria-current={item.selected ? "step" : undefined}
                className={cn(
                  "focus-ring -m-1 w-[calc(100%+0.5rem)] rounded-lg p-1 text-left",
                  item.selected && "bg-white shadow-sm ring-1 ring-zinc-200",
                )}
              >
                {content}
              </button>
            ) : (
              <div>{content}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function Modal({
  open,
  onOpenChange,
  onExitComplete,
  title,
  description,
  children,
  width = "max-w-lg",
  scrollable = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onExitComplete?: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  width?: string;
  scrollable?: boolean;
}) {
  const t = useTranslations("Common");
  const { refs, context } = useFloating({ open, onOpenChange });
  const { getFloatingProps } = useInteractions([
    useDismiss(context, { outsidePressEvent: "mousedown" }),
    useRole(context, { role: "dialog" }),
  ]);
  const mounted = useCssPresence(open, 140);
  const wasMounted = useRef(mounted);
  useEffect(() => {
    if (wasMounted.current && !mounted) onExitComplete?.();
    wasMounted.current = mounted;
  }, [mounted, onExitComplete]);
  if (!mounted) return null;
  return (
    <FloatingPortal>
      <FloatingOverlay
        lockScroll
        data-state={open ? "open" : "closed"}
        className="modal-overlay z-50 flex items-center justify-center bg-black/35 p-4 backdrop-blur-[2px]"
      >
        <FloatingFocusManager context={context}>
          <div
            ref={refs.setFloating}
            data-state={open ? "open" : "closed"}
            className={cn(
              "modal-panel max-h-[90vh] w-full rounded-xl border border-zinc-200 bg-white shadow-2xl",
              scrollable ? "overflow-y-auto" : "flex flex-col overflow-hidden",
              width,
            )}
            {...getFloatingProps()}
          >
            <div
              className={cn(
                "flex shrink-0 justify-between border-zinc-100 border-b px-5 py-4",
                description ? "items-start" : "items-center",
              )}
            >
              <div>
                <h2 className="font-semibold text-sm text-zinc-950">{title}</h2>
                {description ? (
                  <p className="mt-1 text-xs text-zinc-500 leading-5">{description}</p>
                ) : null}
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onOpenChange(false)}
                aria-label={t("close")}
              >
                <X className="size-4" />
              </Button>
            </div>
            {children}
          </div>
        </FloatingFocusManager>
      </FloatingOverlay>
    </FloatingPortal>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText,
  onConfirm,
  loading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmText?: string;
  onConfirm: () => void;
  loading?: boolean;
}) {
  const t = useTranslations("Common");
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} width="max-w-sm">
      <div className="px-5 py-4 text-sm text-zinc-600 leading-6">{description}</div>
      <div className="flex justify-end gap-2 border-zinc-100 border-t px-5 py-3">
        <Button variant="secondary" onClick={() => onOpenChange(false)}>
          {t("cancel")}
        </Button>
        <Button variant="danger" loading={loading} onClick={onConfirm}>
          {confirmText ?? t("delete")}
        </Button>
      </div>
    </Modal>
  );
}

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
}

export function Select({
  value,
  onChange,
  options,
  placeholder,
  className,
  action,
}: {
  value?: string | null;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  action?: { label: string; onSelect: () => void };
}) {
  const t = useTranslations("Common");
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: "bottom-start",
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(5),
      flip(),
      shift({ padding: 8 }),
      size({
        apply({ rects, elements }) {
          Object.assign(elements.floating.style, {
            width: `${Math.max(rects.reference.width, 224)}px`,
          });
        },
      }),
    ],
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useClick(context),
    useDismiss(context, { outsidePressEvent: "pointerdown" }),
    useRole(context, { role: "listbox" }),
  ]);
  const menuMounted = useCssPresence(open, 100);

  useEffect(() => {
    if (!open) return;

    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;

      const reference = refs.reference.current;
      const floating = refs.floating.current;
      if (
        (reference instanceof Element && reference.contains(target)) ||
        floating?.contains(target)
      )
        return;

      setOpen(false);
    };

    document.addEventListener("pointerdown", handleOutsidePointerDown, true);
    return () => document.removeEventListener("pointerdown", handleOutsidePointerDown, true);
  }, [open, refs.floating, refs.reference]);
  const selected = options.find((option) => option.value === value);
  return (
    <>
      <button
        ref={refs.setReference}
        type="button"
        className={cn(
          "focus-ring flex h-9 w-full items-center justify-between rounded-lg border border-zinc-200 bg-white px-3 text-left text-sm",
          className,
        )}
        {...getReferenceProps()}
      >
        <span className={cn("truncate", !selected && "text-zinc-400")}>
          {selected?.label ?? placeholder ?? t("select")}
        </span>
        <ChevronDown className="size-3.5 text-zinc-400" />
      </button>
      {menuMounted ? (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            className="z-[70]"
            {...getFloatingProps()}
          >
            <div
              data-state={open ? "open" : "closed"}
              className="popover-panel max-h-72 w-full overflow-y-auto rounded-lg border border-zinc-200 bg-white p-1 shadow-xl"
            >
              {options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className="flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-zinc-100"
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mt-0.5 size-3.5",
                      value === option.value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span>
                    <span className="block text-sm text-zinc-800">{option.label}</span>
                    {option.description ? (
                      <span className="block text-xs text-zinc-400">{option.description}</span>
                    ) : null}
                  </span>
                </button>
              ))}
              {!options.length ? (
                <div className="px-3 py-5 text-center text-xs text-zinc-400">{t("noOptions")}</div>
              ) : null}
              {action ? (
                <button
                  type="button"
                  className="mt-1 flex w-full items-center gap-2 border-zinc-100 border-t px-2.5 pt-2.5 pb-2 text-left font-medium text-sm text-zinc-700 hover:bg-zinc-50"
                  onClick={() => {
                    setOpen(false);
                    action.onSelect();
                  }}
                >
                  <Plus className="size-3.5" />
                  {action.label}
                </button>
              ) : null}
            </div>
          </div>
        </FloatingPortal>
      ) : null}
    </>
  );
}

export function MultiSelect({
  values,
  onChange,
  options,
  placeholder,
  emptyLabel,
  lockedValues = [],
  className,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  options: SelectOption[];
  placeholder?: string;
  emptyLabel?: string;
  lockedValues?: string[];
  className?: string;
}) {
  const t = useTranslations("Common");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: "bottom-start",
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(5),
      flip(),
      shift({ padding: 8 }),
      size({
        apply({ rects, elements }) {
          Object.assign(elements.floating.style, {
            width: `${Math.max(rects.reference.width, 224)}px`,
          });
        },
      }),
    ],
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useClick(context),
    useDismiss(context, { outsidePressEvent: "pointerdown" }),
    useRole(context, { role: "listbox" }),
  ]);
  const menuMounted = useCssPresence(open, 100);
  const selectedLabels = options
    .filter((option) => values.includes(option.value))
    .map((option) => option.label);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredOptions = normalizedQuery
    ? options.filter((option) => option.label.toLocaleLowerCase().includes(normalizedQuery))
    : options;

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;

      const reference = refs.reference.current;
      const floating = refs.floating.current;
      if (
        (reference instanceof Element && reference.contains(target)) ||
        floating?.contains(target)
      )
        return;

      setOpen(false);
    };

    document.addEventListener("pointerdown", handleOutsidePointerDown, true);
    return () => document.removeEventListener("pointerdown", handleOutsidePointerDown, true);
  }, [open, refs.floating, refs.reference]);

  return (
    <>
      <button
        ref={refs.setReference}
        type="button"
        className={cn(
          "focus-ring flex h-9 w-full items-center justify-between rounded-lg border border-zinc-200 bg-white px-3 text-left text-sm",
          className,
        )}
        title={selectedLabels.join(", ")}
        {...getReferenceProps()}
      >
        <span className={cn("truncate", !selectedLabels.length && "text-zinc-400")}>
          {selectedLabels.length ? selectedLabels.join(", ") : (placeholder ?? t("select"))}
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-zinc-400" />
      </button>
      {menuMounted ? (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            className="z-[70]"
            {...getFloatingProps()}
          >
            <div
              data-state={open ? "open" : "closed"}
              aria-multiselectable="true"
              className="popover-panel max-h-72 w-full overflow-y-auto rounded-lg border border-zinc-200 bg-white p-1 shadow-xl"
            >
              <div className="sticky top-0 z-10 bg-white p-1">
                <div className="flex h-8 items-center gap-2 rounded-md border border-zinc-200 bg-white px-2.5">
                  <Search className="size-3.5 shrink-0 text-zinc-400" />
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t("searchOptions")}
                    className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-400"
                  />
                </div>
              </div>
              {filteredOptions.map((option) => {
                const selected = values.includes(option.value);
                const locked = lockedValues.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    disabled={locked}
                    className={cn(
                      "flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-zinc-100",
                      locked && "cursor-default opacity-60",
                    )}
                    onClick={() =>
                      onChange(
                        selected
                          ? values.filter((value) => value !== option.value)
                          : [...values, option.value],
                      )
                    }
                  >
                    <Check
                      className={cn(
                        "mt-0.5 size-3.5 shrink-0",
                        selected ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="min-w-0 truncate text-sm text-zinc-800">
                      {option.label}
                      {option.description ? (
                        <span className="text-zinc-400"> · {option.description}</span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
              {!filteredOptions.length ? (
                <div className="px-3 py-5 text-center text-xs text-zinc-400">
                  {options.length ? t("noMatchingOptions") : (emptyLabel ?? t("noOptions"))}
                </div>
              ) : null}
            </div>
          </div>
        </FloatingPortal>
      ) : null}
    </>
  );
}

export function Tooltip({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: "top",
    whileElementsMounted: autoUpdate,
    middleware: [offset(7), flip(), shift()],
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useHover(context, { delay: { open: 250, close: 80 } }),
    useDismiss(context),
    useRole(context, { role: "tooltip" }),
  ]);
  return (
    <>
      {
        <span ref={refs.setReference} {...getReferenceProps()}>
          {children}
        </span>
      }
      {open ? (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            className="z-[80] max-w-xs rounded-md bg-zinc-950 px-2.5 py-1.5 text-white text-xs leading-5 shadow-lg"
            {...getFloatingProps()}
          >
            {label}
          </div>
        </FloatingPortal>
      ) : null}
    </>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-start justify-between gap-4 text-left"
    >
      <span>
        <span className="block font-medium text-sm text-zinc-800">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-xs text-zinc-500 leading-5">{description}</span>
        ) : null}
      </span>
      <span
        className={cn(
          "relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors",
          checked ? "bg-zinc-950" : "bg-zinc-200",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out",
            checked ? "translate-x-4" : "translate-x-0",
          )}
        />
      </span>
    </button>
  );
}
