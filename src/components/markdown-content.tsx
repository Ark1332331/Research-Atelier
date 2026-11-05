"use client";
import {memo} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { normalizeMathMarkdown } from '@/lib/math-markdown';
export default memo(function MarkdownContent({children}:{children:string}) {
  return <div className="md-body"><ReactMarkdown remarkPlugins={[remarkGfm,remarkMath]} rehypePlugins={[[rehypeKatex,{strict:false,trust:false,throwOnError:false}]]}>{normalizeMathMarkdown(children)}</ReactMarkdown></div>;
});
