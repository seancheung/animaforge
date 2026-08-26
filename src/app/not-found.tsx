import { ArrowLeft, FileQuestion } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Brand } from "@/components/app-header";

export default async function NotFound() {
  const t = await getTranslations("NotFound");
  const common = await getTranslations("Common");

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-zinc-50 px-6 py-16">
      <div className="absolute top-6 left-6">
        <Brand />
      </div>
      <div className="w-full max-w-md text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-2xl border border-zinc-200 bg-white shadow-sm">
          <FileQuestion className="size-5 text-zinc-500" />
        </div>
        <p className="mt-5 font-mono text-xs text-zinc-400 tracking-[0.2em]">404</p>
        <h1 className="mt-2 font-semibold text-2xl text-zinc-950 tracking-tight">{t("title")}</h1>
        <p className="mx-auto mt-3 max-w-sm text-sm text-zinc-500 leading-6">{t("description")}</p>
        <Link
          href="/"
          className="focus-ring mt-7 inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-3.5 font-medium text-sm text-white shadow-sm transition hover:bg-zinc-800"
        >
          <ArrowLeft className="size-4" />
          {common("backHome")}
        </Link>
      </div>
    </main>
  );
}
