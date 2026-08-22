"use client";

/**
 * 页面头（无 eyebrow）：大标题自己说话，红色 folio 页码并列在右侧；
 * 说明与元信息在标题下方的 credit 行（印刷版式，不是标签堆叠）。
 */
export default function PageHead({
  num,
  name,
  title,
  desc,
  meta,
}: {
  num: string;
  name: string;
  title: string;
  desc?: string;
  meta?: string;
}) {
  return (
    <header className="page-head">
      <div className="page-head-row">
        <h1 className="page-head-title">{title}</h1>
        <span className="page-head-folio" aria-hidden="true">{num}</span>
      </div>
      {desc && <p className="page-head-desc">{desc}</p>}
      <div className="page-head-credit">
        <span className="mono-label">{num} · {name}</span>
        {meta && <span className="mono-label">{meta}</span>}
      </div>
    </header>
  );
}
