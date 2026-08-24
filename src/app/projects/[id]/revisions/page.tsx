import { ProjectClient } from "@/components/project-client";

export default async function ProjectRevisionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const initialRevisionId = typeof query.revision === "string" ? query.revision : null;
  return (
    <ProjectClient
      projectId={id}
      initialChapterId={null}
      initialRevisionId={initialRevisionId}
      initialView="revisions"
    />
  );
}
