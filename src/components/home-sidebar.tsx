"use client";

import { BarChart3, BookOpen, Feather, Languages, PanelLeft, Settings2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import { useSettingsDialog } from "@/components/settings-dialog-provider";
import { Tooltip } from "@/components/ui";
import { cn } from "@/lib/utils";

export function HomeSidebar() {
  const t = useTranslations("Sidebar");
  const [collapsed, setCollapsed] = useState(false);
  const { openSettings } = useSettingsDialog();
  const pathname = usePathname();

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 64 : 224 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="sticky top-0 z-30 flex h-screen shrink-0 flex-col overflow-hidden border-zinc-200 border-r bg-white"
    >
      <div
        className={cn(
          "flex h-14 shrink-0 items-center border-zinc-100 border-b",
          collapsed ? "justify-center px-2" : "justify-between px-3",
        )}
      >
        {collapsed ? (
          <button
            type="button"
            aria-label={t("expand")}
            onClick={() => setCollapsed(false)}
            className="focus-ring group relative flex size-10 items-center justify-center rounded-lg border border-transparent hover:bg-zinc-100"
          >
            <span className="flex size-8 items-center justify-center rounded-lg bg-zinc-950 text-white transition-opacity group-hover:opacity-0">
              <Feather className="size-4" />
            </span>
            <PanelLeft className="absolute size-4 text-zinc-700 opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        ) : (
          <>
            <Link href="/" aria-label="AnimaForge" className="flex min-w-0 items-center gap-2.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-zinc-950 text-white">
                <Feather className="size-4" />
              </span>
              <span className="whitespace-nowrap font-semibold text-sm tracking-tight">
                AnimaForge
              </span>
            </Link>
            <button
              type="button"
              aria-label={t("collapse")}
              onClick={() => setCollapsed(true)}
              className="focus-ring flex size-8 items-center justify-center rounded-lg border border-transparent text-zinc-500 hover:bg-zinc-100 hover:text-zinc-950"
            >
              <PanelLeft className="size-4" />
            </button>
          </>
        )}
      </div>

      <div className="flex-1 p-2.5">
        <div className="space-y-1">
          <SidebarLink collapsed={collapsed} label={t("novels")} href="/" active={pathname === "/"}>
            <BookOpen className="size-4" />
          </SidebarLink>
          <SidebarLink
            collapsed={collapsed}
            label={t("translations")}
            href="/translations"
            active={pathname.startsWith("/translations")}
          >
            <Languages className="size-4" />
          </SidebarLink>
          <SidebarLink
            collapsed={collapsed}
            label={t("statistics")}
            href="/statistics"
            active={pathname.startsWith("/statistics")}
          >
            <BarChart3 className="size-4" />
          </SidebarLink>
        </div>
      </div>

      <div className="space-y-1 border-zinc-100 border-t p-2.5">
        <SidebarAction collapsed={collapsed} label={t("settings")} onClick={openSettings}>
          <Settings2 className="size-4" />
        </SidebarAction>
      </div>
    </motion.aside>
  );
}

function SidebarLink({
  collapsed,
  label,
  href,
  active,
  children,
}: {
  collapsed: boolean;
  label: string;
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  const link = (
    <Link
      href={href}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "focus-ring flex h-10 items-center rounded-lg border border-transparent font-medium text-sm transition-colors",
        collapsed ? "w-10 justify-center" : "w-full gap-3 px-3",
        active
          ? "bg-zinc-100 text-zinc-950"
          : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950",
      )}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">{children}</span>
      <AnimatePresence initial={false}>
        {!collapsed ? (
          <motion.span
            initial={{ opacity: 0, x: -5 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -5 }}
            transition={{ duration: 0.12 }}
            className="whitespace-nowrap"
          >
            {label}
          </motion.span>
        ) : null}
      </AnimatePresence>
    </Link>
  );

  return collapsed ? (
    <div className="flex justify-center">
      <Tooltip label={label}>{link}</Tooltip>
    </div>
  ) : (
    link
  );
}

function SidebarAction({
  collapsed,
  label,
  onClick,
  children,
}: {
  collapsed: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  const button = (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "focus-ring flex h-10 items-center rounded-lg border border-transparent font-medium text-sm transition-colors",
        collapsed ? "w-10 justify-center" : "w-full gap-3 px-3",
        "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950",
      )}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">{children}</span>
      <AnimatePresence initial={false}>
        {!collapsed ? (
          <motion.span
            initial={{ opacity: 0, x: -5 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -5 }}
            transition={{ duration: 0.12 }}
            className="whitespace-nowrap"
          >
            {label}
          </motion.span>
        ) : null}
      </AnimatePresence>
    </button>
  );

  return collapsed ? (
    <div className="flex justify-center">
      <Tooltip label={label}>{button}</Tooltip>
    </div>
  ) : (
    button
  );
}
