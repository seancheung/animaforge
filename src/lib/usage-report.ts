import { getDb } from "@/lib/db";
import type { TaskType, UsageBreakdown, UsageReport } from "@/lib/types";

type UsageRow = Record<string, unknown>;
type MutableBreakdown = UsageBreakdown & { unpriced: number };

const blank = (): MutableBreakdown => ({
  input: 0,
  cached: 0,
  output: 0,
  calls: 0,
  cost: null,
  unpriced: 0,
});
const numeric = (value: unknown) => Number(value ?? 0) || 0;

export async function loadUsageReport(
  days: number | null,
  project?: { kind: "creative" | "translation"; id: string },
): Promise<UsageReport> {
  const conn = await getDb();
  const usageQuery = conn("token_usage").orderBy("created_at", "asc");
  if (days !== null)
    usageQuery.whereRaw("datetime(created_at) >= datetime(?)", [
      new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString(),
    ]);
  if (project) usageQuery.where({ project_kind: project.kind, project_id: project.id });
  const [usageRows, priceRows] = await Promise.all([
    usageQuery as Promise<UsageRow[]>,
    conn("llm_models as m")
      .join("llm_services as s", "s.id", "m.service_id")
      .select(
        "s.name as service_name",
        "m.model_id",
        "m.input_price",
        "m.cache_read_price",
        "m.cache_write_price",
        "m.output_price",
      ) as Promise<UsageRow[]>,
  ]);
  const prices = new Map(priceRows.map((row) => [`${row.service_name}\u0000${row.model_id}`, row]));
  const totals = blank();
  const featureGroups = new Map<string, MutableBreakdown>();
  const modelGroups = new Map<string, MutableBreakdown>();
  const dayGroups = new Map<string, MutableBreakdown>();

  const add = (target: MutableBreakdown, row: UsageRow, price: UsageRow | undefined) => {
    const input = numeric(row.input_tokens);
    const cacheRead = numeric(row.cache_read_tokens);
    const cacheWrite = numeric(row.cache_write_tokens);
    const output = numeric(row.output_tokens);
    const tokens = input + cacheRead + cacheWrite + output;
    target.input += input + cacheWrite;
    target.cached += cacheRead;
    target.output += output;
    target.calls += 1;
    const unpriced =
      !price ||
      [
        price.input_price,
        price.cache_read_price,
        price.cache_write_price,
        price.output_price,
      ].every((value) => value == null);
    if (unpriced) {
      target.unpriced += tokens;
      return;
    }
    const inputPrice = numeric(price.input_price);
    const cost =
      (input * inputPrice +
        cacheRead * numeric(price.cache_read_price ?? price.input_price) +
        cacheWrite * numeric(price.cache_write_price ?? price.input_price) +
        output * numeric(price.output_price)) /
      1_000_000;
    target.cost = (target.cost ?? 0) + cost;
  };

  for (const row of usageRows) {
    const service = String(row.service_name);
    const model = String(row.model_id);
    const feature = String(row.feature);
    const day = String(row.created_at).slice(0, 10);
    const price = prices.get(`${service}\u0000${model}`);
    const featureTarget = featureGroups.get(feature) ?? blank();
    const modelTarget = modelGroups.get(`${service}\u0000${model}`) ?? blank();
    const dayTarget = dayGroups.get(day) ?? blank();
    add(totals, row, price);
    add(featureTarget, row, price);
    add(modelTarget, row, price);
    add(dayTarget, row, price);
    featureGroups.set(feature, featureTarget);
    modelGroups.set(`${service}\u0000${model}`, modelTarget);
    dayGroups.set(day, dayTarget);
  }

  const volume = (item: UsageBreakdown) => item.input + item.cached + item.output;
  const strip = (value: MutableBreakdown): UsageBreakdown => ({
    input: value.input,
    cached: value.cached,
    output: value.output,
    calls: value.calls,
    cost: value.cost,
  });
  return {
    totals,
    byFeature: [...featureGroups.entries()]
      .map(([feature, value]) => ({ feature: feature as TaskType, ...strip(value) }))
      .sort((a, b) => volume(b) - volume(a)),
    byModel: [...modelGroups.entries()]
      .map(([key, value]) => {
        const [service, model] = key.split("\u0000");
        return { service, model, ...strip(value) };
      })
      .sort((a, b) => volume(b) - volume(a)),
    byDay: [...dayGroups.entries()]
      .map(([day, value]) => ({ day, ...strip(value) }))
      .sort((a, b) => a.day.localeCompare(b.day)),
  };
}
