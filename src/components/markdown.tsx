"use client";

import MarkdownContent from './markdown-content';
import { ReadingSurface } from './reading-memory';
import type {ReadingOrigin} from '@/lib/reading-memory';

/**
 * Markdown 渲染组件：把 AI 回复渲染成编辑感排版（标题/表格/列表/代码块/引用）。
 * 设计：md-body 排版体系见 globals.css（衬线标题 + 发丝线表格 + 衬线引用 + 等宽代码）。
 * 依据：node_modules/next/dist/docs 客户端组件约定（'use client' 边界）。
 */
export default function Markdown({children,sourceKey,sourceUrl,label='AI 回答',context,interactive=true,slug,origin}:{children:string;sourceKey?:string;sourceUrl?:string;label?:string;context?:string;interactive?:boolean;slug?:string;origin?:ReadingOrigin}) {
  if(!interactive)return <MarkdownContent>{children}</MarkdownContent>;
  return <ReadingSurface content={children} sourceKey={sourceKey} sourceUrl={sourceUrl} label={label} context={context} slug={slug} origin={origin}><MarkdownContent>{children}</MarkdownContent></ReadingSurface>;
}
