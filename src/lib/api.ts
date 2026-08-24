import { getTranslations } from "next-intl/server";

export class ApiError extends Error {
  constructor(
    public key: string,
    public status = 400,
    public values?: Record<string, string | number>,
  ) {
    super(key);
  }
}

export function ok<T>(data: T, init?: ResponseInit) {
  return Response.json(data, init);
}

export async function localizeApiError(error: unknown) {
  const t = await getTranslations("Errors");
  if (error instanceof ApiError) return t(error.key as never, error.values as never);
  return t("unknown");
}

export async function apiDefault(key: string) {
  const t = await getTranslations("Defaults");
  return t(key as never);
}

export async function fail(error: unknown) {
  console.error(error);
  if (error instanceof ApiError) {
    return Response.json({ error: await localizeApiError(error) }, { status: error.status });
  }
  return Response.json({ error: await localizeApiError(error) }, { status: 500 });
}

export async function jsonBody<T>(request: Request) {
  return (await request.json()) as T;
}
