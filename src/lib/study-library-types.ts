export type StudyNode = {
  id: string;
  parentId: string | null;
  kind: 'library' | 'folder' | 'document';
  name: string;
  order: number;
  createdAt: string;
  updatedAt: string;
};

export type StudyDocument = {
  node: StudyNode;
  content: string;
  links: Record<string, string>;
};

export type StudyLibraryResult = {nodes: StudyNode[]; createdId?: string};
export type StudyImportResult = StudyLibraryResult & {documentIds: string[]; warnings?: string[]};
