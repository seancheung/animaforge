"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, Coins, Database, Hash, Sparkles } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { HomeSidebar } from "@/components/home-sidebar";
import { Select } from "@/components/ui";
import { api } from "@/lib/client";
import type { TaskType, UsageBreakdown, UsageReport } from "@/lib/types";
import { formatCompactNumber, formatDollarAmount } from "@/lib/utils";

const tokenVolume = (item: UsageBreakdown) => item.input + item.cached + item.output;

export function StatisticsClient() {
  const t = useTranslations("Statistics");
  const settings = useTranslations("Settings");
  const locale = useLocale();
  const [days, setDays] = useState("30");
  const query = useQuery({
    queryKey: ["usage", days],
    queryFn: () => api<UsageReport>(`/api/usage?days=${days}`),
  });
  const report = query.data;
  const exact = new Intl.NumberFormat(locale);
  const featureLabels: Record<TaskType, string> = {
    writing: settings("writing"),
    summary: settings("summary"),
    assistant: settings("assistant"),
    chat: settings("chat"),
    review: settings("review"),
    revisionPlan: settings("revisionPlan"),
    revisionExecution: settings("revisionExecution"),
    translationBlueprint: settings("translationBlueprint"),
    translationDraft: settings("translationDraft"),
    translationProofread: settings("translationProofread"),
    translationFidelity: settings("translationFidelity"),
    translationPolish: settings("translationPolish"),
  };
  const formatCost = (value: number | null) =>
    value == null
      ? t("unpriced")
      : value > 0 && value < 0.0001
        ? "< $0.0001"
        : formatDollarAmount(value, locale);
  const maxDaily = Math.max(1, ...(report?.byDay.map(tokenVolume) ?? []));

  return (
    <div className="flex min-h-screen bg-zinc-50">
      <HomeSidebar />
      <main className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-[1500px] px-5 py-8 lg:px-8">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
            <div className="min-w-0">
              <p className="mb-1 font-medium text-xs text-zinc-400 uppercase tracking-[0.16em]">
                {t("eyebrow")}
              </p>
              <h1 className="font-semibold text-2xl tracking-tight">{t("title")}</h1>
              <p className="mt-2 text-sm text-zinc-500">{t("description")}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2 text-sm text-zinc-500">
              <span className="whitespace-nowrap">{t("range")}</span>
              <Select
                className="w-40 shrink-0"
                value={days}
                onChange={setDays}
                options={[7, 30, 90, 365].map((value) => ({
                  value: String(value),
                  label: t("days", { count: value }),
                }))}
              />
            </div>
          </div>

          {query.isLoading ? (
            <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[1, 2, 3, 4].map((item) => (
                <div
                  key={item}
                  className="h-32 animate-pulse rounded-xl border border-zinc-200 bg-white"
                />
              ))}
            </div>
          ) : null}
          {report ? (
            <>
              <section className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Metric
                  icon={<Database className="size-4" />}
                  label={t("inputTokens")}
                  value={formatCompactNumber(report.totals.input + report.totals.cached)}
                  detail={
                    report.totals.cached
                      ? t("cachedDetail", { count: formatCompactNumber(report.totals.cached) })
                      : t("noCachedTokens")
                  }
                />
                <Metric
                  icon={<Sparkles className="size-4" />}
                  label={t("outputTokens")}
                  value={formatCompactNumber(report.totals.output)}
                  detail={t("exactTokens", { count: formatCompactNumber(report.totals.output) })}
                />
                <Metric
                  icon={<Hash className="size-4" />}
                  label={t("calls")}
                  value={exact.format(report.totals.calls)}
                  detail={t("trackedRequests")}
                />
                <Metric
                  icon={<Coins className="size-4" />}
                  label={t("estimatedCost")}
                  value={formatCost(report.totals.cost)}
                  detail={
                    report.totals.unpriced
                      ? t("unpricedDetail", { count: formatCompactNumber(report.totals.unpriced) })
                      : t("allPriced")
                  }
                />
              </section>

              {!report.totals.calls ? (
                <div className="mt-6 flex min-h-72 flex-col items-center justify-center rounded-xl border border-zinc-300 border-dashed bg-white text-center">
                  <span className="flex size-11 items-center justify-center rounded-xl bg-zinc-100">
                    <Activity className="size-5 text-zinc-500" />
                  </span>
                  <h2 className="mt-4 font-medium text-sm">{t("emptyTitle")}</h2>
                  <p className="mt-1 max-w-md text-xs text-zinc-500 leading-5">
                    {t("emptyDescription")}
                  </p>
                </div>
              ) : (
                <>
                  <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
                    <div>
                      <h2 className="font-semibold text-sm">{t("dailyUsage")}</h2>
                      <p className="mt-1 text-xs text-zinc-500">{t("dailyUsageDescription")}</p>
                    </div>
                    <div className="mt-6 flex h-44 items-end gap-1.5 overflow-hidden">
                      {report.byDay.map((item) => {
                        const total = tokenVolume(item);
                        return (
                          <div
                            key={item.day}
                            className="group flex h-full min-w-1 flex-1 flex-col justify-end"
                            title={`${item.day}: ${formatCompactNumber(total)}`}
                          >
                            <div
                              className="relative min-h-1 rounded-sm bg-zinc-900/80 transition group-hover:bg-zinc-950"
                              style={{ height: `${Math.max(2, (total / maxDaily) * 100)}%` }}
                            />
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-2 flex justify-between text-[10px] text-zinc-400">
                      <span>{report.byDay[0]?.day}</span>
                      <span>{report.byDay.at(-1)?.day}</span>
                    </div>
                  </section>
                  <section className="mt-6 grid gap-4 xl:grid-cols-2">
                    <Breakdown
                      title={t("byFeature")}
                      rows={report.byFeature.map((item) => ({
                        key: item.feature,
                        label: featureLabels[item.feature] ?? item.feature,
                        item,
                      }))}
                      formatCost={formatCost}
                      labels={{
                        input: t("inputShort"),
                        output: t("outputShort"),
                        calls: t("callsShort"),
                      }}
                    />
                    <Breakdown
                      title={t("byModel")}
                      rows={report.byModel.map((item) => ({
                        key: `${item.service}-${item.model}`,
                        label: `${item.service} · ${item.model}`,
                        item,
                      }))}
                      formatCost={formatCost}
                      labels={{
                        input: t("inputShort"),
                        output: t("outputShort"),
                        calls: t("callsShort"),
                      }}
                    />
                  </section>
                </>
              )}
            </>
          ) : null}
        </div>
      </main>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 font-medium text-xs text-zinc-500">
        {icon}
        {label}
      </div>
      <div className="mt-3 font-semibold text-2xl text-zinc-950 tracking-tight">{value}</div>
      <p className="mt-1.5 truncate text-xs text-zinc-400">{detail}</p>
    </article>
  );
}

function Breakdown({
  title,
  rows,
  formatCost,
  labels,
}: {
  title: string;
  rows: Array<{ key: string; label: string; item: UsageBreakdown }>;
  formatCost: (value: number | null) => string;
  labels: { input: string; output: string; calls: string };
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="border-zinc-100 border-b px-5 py-4 font-semibold text-sm">{title}</div>
      <div className="divide-y divide-zinc-100">
        {rows.map(({ key, label, item }) => (
          <div key={key} className="flex items-center justify-between gap-5 px-5 py-3.5">
            <div className="min-w-0">
              <div className="truncate font-medium text-sm">{label}</div>
              <div className="mt-1 text-[11px] text-zinc-400">
                {labels.input} {formatCompactNumber(item.input + item.cached)} · {labels.output}{" "}
                {formatCompactNumber(item.output)} · {labels.calls} {item.calls}
              </div>
            </div>
            <div className="shrink-0 font-medium text-sm text-zinc-700">
              {formatCost(item.cost)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
