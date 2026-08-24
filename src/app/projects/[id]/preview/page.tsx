import { ProjectClient } from "@/components/project-client";

export default async function ProjectPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProjectClient projectId={id} initialChapterId={null} initialView="preview" />;
}
