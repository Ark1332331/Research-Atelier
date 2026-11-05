import type { ReadingAnchor } from './reading-memory.ts';

export interface ReadingNote {
  id: string;
  anchor: ReadingAnchor;
  comment: string;
  createdAt: string;
  updatedAt: string;
}

export function validateNoteComment(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 2000) {
    throw Error('请输入自己的笔记（最多 2000 字符）');
  }
  return value.trim();
}
