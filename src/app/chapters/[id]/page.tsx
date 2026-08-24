import { notFound, redirect } from "next/navigation";
import { getDb } from "@/lib/db";

export default async function ChapterPage({ params }: PageProps<"/chapters/[id]">) {
  const { id } = await params;
  const conn = await getDb();
  const chapter = await conn("chapters").where({ id }).select("project_id").first();
  if (!chapter) notFound();
  redirect(`/projects/${chapter.project_id}?chapter=${encodeURIComponent(id)}`);
}
