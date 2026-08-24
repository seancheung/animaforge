import { ProjectClient } from "@/components/project-client";

export default async function ProjectPage({ params, searchParams }: PageProps<"/projects/[id]">) {
  const { id } = await params;
  const query = await searchParams;
  const initialChapterId = typeof query.chapter === "string" ? query.chapter : null;
  return <ProjectClient projectId={id} initialChapterId={initialChapterId} />;
}
