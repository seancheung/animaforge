export const projectTransferSectionKeys = [
  "settings",
  "entities",
  "reviews",
  "revisions",
  "chapterOutlines",
  "manuscript",
  "manuscriptHistory",
  "chats",
  "assistant",
] as const;

export type ProjectTransferSection = (typeof projectTransferSectionKeys)[number];
export type ProjectTransferSelection = Record<ProjectTransferSection, boolean>;

export const allProjectTransferSections: ProjectTransferSelection = {
  settings: true,
  entities: true,
  reviews: true,
  revisions: true,
  chapterOutlines: true,
  manuscript: true,
  manuscriptHistory: true,
  chats: true,
  assistant: true,
};

export function normalizeProjectTransferSelection(
  value?: Partial<ProjectTransferSelection> | null,
): ProjectTransferSelection {
  const selection = Object.fromEntries(
    projectTransferSectionKeys.map((key) => [key, value?.[key] === true]),
  ) as ProjectTransferSelection;
  if (selection.chats) selection.entities = true;
  if (selection.manuscriptHistory) selection.manuscript = true;
  return selection;
}

export function hasProjectTransferSelection(selection: ProjectTransferSelection) {
  return projectTransferSectionKeys.some((key) => selection[key]);
}

export function selectedProjectTransferSections(selection: ProjectTransferSelection) {
  return projectTransferSectionKeys.filter((key) => selection[key]);
}
