import { TranslationProjectClient } from "@/components/translation-project-client";

export default async function TranslationProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TranslationProjectClient projectId={id} />;
}
