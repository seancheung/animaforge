import { ProjectClient } from "@/components/project-client";

export default async function ProjectSetupPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const initialSetupSection =
    query.section === "outline" || query.section === "models" ? query.section : "basics";
  return (
    <ProjectClient
      projectId={id}
      initialChapterId={null}
      initialSetupSection={initialSetupSection}
      initialView="setup"
    />
  );
}
