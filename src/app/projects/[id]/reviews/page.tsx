import { ProjectClient } from "@/components/project-client";

export default async function ProjectReviewsPage({
  params,
  searchParams,
}: PageProps<"/projects/[id]/reviews">) {
  const { id } = await params;
  const query = await searchParams;
  const initialReviewId = typeof query.review === "string" ? query.review : null;
  return (
    <ProjectClient
      projectId={id}
      initialChapterId={null}
      initialReviewId={initialReviewId}
      initialView="reviews"
    />
  );
}
