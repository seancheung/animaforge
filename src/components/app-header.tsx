"use client";

import { Feather } from "lucide-react";
import Link from "next/link";

export function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="flex size-7 items-center justify-center rounded-lg bg-zinc-950 text-white">
        <Feather className="size-3.5" />
      </span>
      <span className="font-semibold text-sm tracking-tight">AnimaForge</span>
    </Link>
  );
}
