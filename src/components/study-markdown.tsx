"use client";

import { memo, useState } from 'react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { remarkStudyHeadings, resolveStudyLink } from '@/lib/study-markdown';
import { remarkStudyImports } from '@/lib/study-import-markdown';

function StudyImage({ src, alt, title }: { src: string; alt: string; title?: string }) {
  const [failed, setFailed] = useState(false);
  return <span className={`study-image${failed ? ' study-image--missing' : ''}`} data-study-missing={`图片暂时无法显示${alt ? `：${alt}` : ''}`} role={failed ? 'img' : undefined} aria-label={failed ? `图片暂时无法显示：${alt}` : undefined}>
    {/* Imported image sizes are unknown; retain natural dimensions and local asset URLs. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={src} alt={alt} title={title} loading="lazy" hidden={failed} onError={() => setFailed(true)} />
  </span>;
}

export default memo(function StudyMarkdown({ content, links }: { content: string; links: Record<string, string> }) {
  return <div className="study-markdown md-body"><ReactMarkdown
    remarkPlugins={[remarkGfm, remarkMath, remarkStudyImports, remarkStudyHeadings]}
    rehypePlugins={[[rehypeKatex, { strict: false, trust: false, throwOnError: false }]]}
    skipHtml
    urlTransform={value => value}
    components={{
      a({ href, children, title }) {
        const resolved = resolveStudyLink(href ?? '', links);
        if (!resolved) return <span className="study-missing-link" title="未找到对应文档，请将它一起导入">{children}<small>（链接未导入）</small></span>;
        if (resolved.external) return <a href={resolved.href} target="_blank" rel="noopener noreferrer" title={title}>{children}</a>;
        if (resolved.href.startsWith('/study/')) return <Link href={resolved.href} title={title}>{children}</Link>;
        return <a href={resolved.href} title={title}>{children}</a>;
      },
      img({ src, alt, title }) {
        const resolved = resolveStudyLink(typeof src === 'string' ? src : '', links, true);
        if (!resolved) return <span className="study-image study-image--missing" role="img" aria-label={`图片未导入：${alt ?? ''}`} data-study-missing={`图片未导入${alt ? `：${alt}` : ''} · 请同时导入 Markdown 引用的图片`} />;
        return <StudyImage key={resolved.href} src={resolved.href} alt={alt ?? ''} title={title} />;
      },
    }}
  >{content}</ReactMarkdown></div>;
});
