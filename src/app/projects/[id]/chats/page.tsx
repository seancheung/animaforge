import { ProjectClient } from "@/components/project-client";

export default async function ProjectChatsPage({
  params,
  searchParams,
}: PageProps<"/projects/[id]/chats">) {
  const { id } = await params;
  const query = await searchParams;
  const initialChatId = typeof query.chat === "string" ? query.chat : null;
  return (
    <ProjectClient
      projectId={id}
      initialChapterId={null}
      initialChatId={initialChatId}
      initialView="chats"
    />
  );
}
