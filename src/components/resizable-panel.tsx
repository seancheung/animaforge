"use client";

import { useTranslations } from "next-intl";
import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";

const DEFAULT_WIDTH = 320;
const MIN_WIDTH = 280;
const MAX_WIDTH = 640;

export function ResizablePanel({
  storageKey,
  children,
  className,
}: {
  storageKey: "chapter" | "setup-assistant";
  children: ReactNode;
  className?: string;
}) {
  const t = useTranslations("ResizablePanel");
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const widthRef = useRef(width);

  useEffect(() => {
    const saved = Number(window.localStorage.getItem(`animaforge:right-panel-width:${storageKey}`));
    if (!Number.isFinite(saved) || !saved) return;
    const frame = window.requestAnimationFrame(() => {
      const next = clampWidth(saved);
      widthRef.current = next;
      setWidth(next);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [storageKey]);

  function resizeBy(delta: number) {
    setWidth((current) => {
      const next = clampWidth(current + delta);
      widthRef.current = next;
      window.localStorage.setItem(`animaforge:right-panel-width:${storageKey}`, String(next));
      return next;
    });
  }

  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = widthRef.current;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handleMove = (moveEvent: PointerEvent) => {
      const next = clampWidth(startWidth + startX - moveEvent.clientX);
      widthRef.current = next;
      setWidth(next);
    };
    const handleEnd = () => {
      document.removeEventListener("pointermove", handleMove);
      document.removeEventListener("pointerup", handleEnd);
      document.removeEventListener("pointercancel", handleEnd);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.localStorage.setItem(
        `animaforge:right-panel-width:${storageKey}`,
        String(widthRef.current),
      );
    };

    document.addEventListener("pointermove", handleMove);
    document.addEventListener("pointerup", handleEnd);
    document.addEventListener("pointercancel", handleEnd);
  }

  return (
    <aside
      style={{ width }}
      className={cn("relative min-h-0 shrink-0 border-zinc-200 border-l bg-white", className)}
    >
      <div
        role="separator"
        aria-label={t("label")}
        aria-orientation="vertical"
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            resizeBy(16);
          }
          if (event.key === "ArrowRight") {
            event.preventDefault();
            resizeBy(-16);
          }
        }}
        className="group focus-ring absolute inset-y-0 -left-1 z-30 w-2 cursor-col-resize rounded-sm"
      >
        <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-zinc-400 group-focus:bg-zinc-500" />
      </div>
      {children}
    </aside>
  );
}

function clampWidth(width: number) {
  const viewportMax =
    typeof window === "undefined"
      ? MAX_WIDTH
      : Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, window.innerWidth * 0.55));
  return Math.round(Math.min(viewportMax, Math.max(MIN_WIDTH, width)));
}
