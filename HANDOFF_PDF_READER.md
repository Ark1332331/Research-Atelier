# 交接提示词：Research Atelier 全屏 PDF 阅读器 /read/<slug>

> 你是来接手的 AI。以下是完整背景 + 已诊断的事实 + 要修的问题。请先读本文件，再看代码，不要从零重做架构。

## 项目位置
- 根目录：`/media/ark/Data/devpy/projects/allinone/workflow-app`
- 技术栈：Next.js 16.3.2 (Turbopack) + TypeScript + react 19。dev server 在 `localhost:3000`（单实例锁，因 Turbo 只允许一个 dev）。
- 相关文件：`AGENTS.md`（协作协议）、`project_state.md`（项目状态）可先了解背景，但**本次改的就是 PDF 阅读器**。

## 目标
做一个「Edge 内置 PDF 阅读器」那种体验：点论文 → 进一个**占满整个屏幕的全屏阅读页**，能连续滚动、缩放、术语高亮精确落在词上、段落圆点可点翻译/提问、左栏切换文章。这个页面是一个独立路由 `/read/<slug>`，**不要内嵌**在别的分栏面板里。

## 已完成的架构（请保留，不要推翻）
- 路由：`src/app/read/[slug]/page.tsx`（async server page，`await params`，Next 16 的 params 是 Promise）。里面渲染 `FullReader`。
- 全屏阅读器：`src/components/full-reader.tsx`（client）：左栏论文列表 + 顶部工具条 + 滚动区 + 术语小卡 + 段落翻译抽屉 + 缩放(按钮/Ctrl滚轮/捏合)。
- 单页渲染：`src/components/full-pdf-page.tsx`（client）：自渲染 canvas + 覆盖层。
- 位置提取算法（**已验证对齐**）：`src/lib/pdf-alignment.ts` → `getPageItems` / `detectParagraphs` / `matchTerms` / `engName` / `norm`。
- 触发入口：`src/components/paper-library.tsx` 里点论文标题 /「全屏阅读」→ `router.push('/read/<slug>')`；`page.tsx` 全局搜索论文命中 → `/read/nsr-mt454tqk`。
- 论文数据：server 导入的论文在 `data/papers/<slug>/`，经 `/api/paper`（列表）/ `/api/paper/pdf?slug=`（PDF 文件）。内置 NSR 的 slug 是 `nsr-mt454tqk`。
- pdfjs 只在浏览器加载（client + 动态 import），避免 SSR `DOMMatrix` 崩溃。worker=`/pdf.worker.min.mjs`，字体/CMap=`/pdfjs/standard_fonts/`,`/pdfjs/cmaps/`，与 `pdfjs-dist@4.10.38`（import 的是顶层这个，worker 必须也是 4.10.38，别混 5.4.296）。

## ⚠️ 最重要的事：几何算法是对的（别重做算法）
我用 node（`pdfjs-dist/legacy` + `@napi-rs/canvas`）把 `getPageItems`+`matchTerms` 的框渲染到第 1 页真实 PDF 上，**术语框精确落在 `locomotion`/`point cloud`/`voxel grid`/`trajectory`/`occlusion` 的字形上**（scale=1.452 和 scale=1 都验证过）。`detectParagraphs` 的行/栏切分也正确（左栏 body 行 x≈88、右栏 x≈…，分栏干净）。

所以：**算法没错，浏览器里错位是 CSS/DOM 显示层的问题**。新对话不需要改 `pdf-alignment.ts` 的算法，只需要解决「为什么浏览器渲染出来对不上」。

## 要修的问题（按优先级）
1. **圆点/术语高亮在浏览器里错位**（用户截图：圆点散在左边、不贴正文；术语没有高亮）。
   - 调试方向：在浏览器 console 里对一个 `.pdf-dot` 和它对应 `getBoundingClientRect()`，和 canvas 上文字实际位置对比，找偏移量（很可能是 `.pdf-page` 的 `width`、`.pdf-overlay` 的定位、或 `devicePixelRatio`/viewport scale 不一致）。
   - 检查 `.pdf-page`(border+`overflow:hidden`)、`.pdf-canvas`(display:block)、`.pdf-overlay`(`position:absolute; inset:0`) 三者坐标原点是否真的对齐。
   - `full-pdf-page.tsx` 里 `data.w=vp.width, data.h=vp.height`；`vp.width === width === pageWidth`（因为 `scale = width/base.width`）。
2. **边框/边缘随放大变化**（用户：边框不该跟着放大、应可收缩或固定）。缩放时 `.pdf-page` 宽度随 zoom 变，边框和留白跟着变大。需要让阅读内容在缩放时保持固定观感（例如纸张定宽、缩放只改纸张内容比例，或边框固定）。
3. **重新接回「导读 AI / 讲解对话」**（用户：这个版本没接 AI 了）。全屏页要能调出 AI 讲解（复用 `/api/chat` 或 `ChatPanel`）。现在的 `full-reader.tsx` 只做了术语卡和段落翻译，没接讲解对话。
4. **「论文能力画像」**：需要一个展示用户当前对这篇论文掌握程度/术语状态/进度的侧栏或区块。参考现有 `user_model_draft.md`、术语 `Term.status`（未接触/有直觉/能解释/能对应论文/能实现）、`data/papers/<slug>/` 的翻译页，或在 `full-reader` 里加一个画像卡片/侧栏。

## 用户明确的替代方案（若对齐实在难修）
用户说了：「如果不好做，可以做成**自己选择 1 2 3 4 页**的分页阅读器」。即放弃自动连续滚动+自动定位，改成**显式分页**（顶部/底部页码条 1..N，点哪页看哪页）。分页后每页是一个独立离散单元，不用处理"连续滚动+覆盖层随滚动偏移"，错位问题会简单很多。**如果连续滚动方案在浏览器里仍修不好对齐，就果断切到分页模式**——这是被授权的、稳妥的兜底。

## 验证方式
- `npx tsc --noEmit -p tsconfig.json`（注意 `.next/dev/types/*.ts` 是生成文件、可能并发写入报错，过滤掉那些，看 `src/` 源码是否 0 error）。
- 因为 Turbo 只允许一个 dev server（单实例锁），不要另开端口；直接在你的 `localhost:3000` 上硬刷新（Ctrl+Shift+R）看效果。之前那个 `Invalid page request` 报错是旧 react-pdf 缓存的，不是现在的 canvas 版。
- 若锁文件 `.next/dev/lock` 卡住（写着一个已经死掉的 pid），删掉它再起 dev。

## 一句话总结给你
保留 `pdf-alignment.ts` 和对齐算法；重点在浏览器里用 getBoundingClientRect 对比 canvas 和覆盖层坐标找错位根因；修边框随缩放变化；接回讲解 AI + 加能力画像；对齐真修不动就用「显式分页」兜底（用户已同意）。

## ✅ 2026-08-22 修复记录（四项问题已全部修复，算法未动）
用 headless Chromium + 画布墨迹分析定位了两个真正的错位根因，都不是算法问题：
1. **`.pdf-term` 缺 `position: absolute`**（globals.css）→ left/top 失效，所有术语高亮按钮堆在每页覆盖层左上角 → "术语没有高亮"。
2. **dpr>1 的离屏渲染路径错误**（full-pdf-page.tsx）：旧代码给渲染 viewport 传 `{...vp, scale: vp.scale*dpr, width/height}` 但 **transform 没重建**，pdf.js 的 `beginDrawing` 只用 `viewport.transform` 定位 → dpr>1 时文字按 CSS 比例画进 dpr 尺寸的位图再被 downscale（dpr=2 整页墨迹率从 9.5% 掉到 2.5%）。已改为 `page.getViewport({scale: scale*dpr})` 直接渲染到可见 canvas。
3. 顺带修了渲染竞态：effect 因 width/doc/terms 变化重跑时先 `task.cancel()` 上一个 RenderTask，否则 pdf.js 抛 "Cannot use the same canvas during multiple render() operations"（之前会让覆盖层永远不出现）。
4. **边框随缩放**：纸张定宽（`.pdf-page` 固定 = 适应宽度），缩放只放大内容条（`.pdf-page-scroll` 可横向平移），边框/留白不再随 zoom 变大。
5. **讲解 AI 已接回**：工具栏「AI 讲解」→ 右缘抽屉复用 ChatPanel（toolKey=p3，打开时自动附 `/api/paper?slug=` 的译文作上下文）；段落抽屉新增「就这一段问 AI」。
6. **能力画像已加**：左栏底部卡片 = 术语状态分布（NSR 相关）+ 已读页进度（IntersectionObserver + localStorage `reader-progress:<slug>`，观察启动延迟 800ms 防止布局未定时误判全读）。

验证（headless Chromium，`getBoundingClientRect` + 画布墨迹）：dpr=1 术语框内墨迹均值 17%（0/30 落空）、圆点右侧墨迹 15%；dpr=2 同样达标；zoom 1.3 时外框 1184 不变、内容 1539、横向可滚且右侧术语仍对齐；`npx tsc --noEmit` 0 error。**连续滚动方案修好了，没有切分页兜底。**

## ✅ 2026-08-22 第二轮（用户新需求，全部完成）
1. **段落圆点已删**（full-pdf-page.tsx）：只保留术语高亮；段落级翻译抽屉（seg panel）一并移除，段落翻译由上传时的全文翻译替代。`pdf-alignment.ts` 的 `detectParagraphs` 保留未动（旧内嵌阅读器 pdf-reader-page.tsx 仍用）。
2. **上传时全文翻译 → Markdown**（`/api/paper` POST + `scripts/translate-full.mjs`）：
   - 文本层方案（deepseek-chat，非视觉）：`scripts/extract-pdf.mjs` v2 把每页 text items 按 baseline 聚行、按「行内最大空隙 > 8pt」拆左右栏（NSR 栏沟 12pt）、连字符断词合并 → 段落结构进模型；
   - 全文按章节标题边界分块（14k/18k），**并行请求**（总耗时≈单块），首块不带续段提示、后续块带"同一篇论文续段"提示；
   - 产物 `data/papers/<slug>/translation.md`（NSR 已生成 18k 字符，`# 标题 / ## 节 / ### 小节 / 术语「英文（中文）」`）；GET /api/paper?slug= 新增 `translation` 字段；
   - 扫描版（无文本层）422 报错；DeepSeek 视觉端点（`deepseek-v4-flash-vision-exp`，2026-08-21 上线）留作后续扫描版兜底（需服务端渲染页图，未接）。
   - 单次请求整篇翻译会被 8k token 输出上限截断（实测），所以必须分块。
3. **左栏「中」按钮**：每篇论文行右侧「中」→ 主区切到中文翻译视图（`/read/<slug>?view=zh`，history.replaceState 同步 URL，刷新保持；PDF 不重载）；工具栏变「查看原文 PDF」回跳。zh 视图下不加载 PDF（省 7MB）。
4. **AI 讲解框可拖动/缩放**：拖头部移动、左下角把手缩放（最小 320×240），位置尺寸存 localStorage `reader-chat-box`，重开恢复；去掉了入场 slideIn 动画（与 left/top 定位冲突）。

验证：无圆点、术语墨迹均值 18%（0 落空）、中视图 h1=1/h2=6/17.7k 字符、刷新保持、回跳 PDF、拖拽(1008,16,440,720)→(684,0,560,870) 且重开恢复；`npx tsc --noEmit` 0 error。

## ✅ 2026-08-22 第三轮（入口收敛）
- 「精读讲解」不再渲染 explain-workbench 内嵌页（该组件已删除）：左栏「精读讲解」、论文库「带正文去精读」、全局搜索命中都直接 `router.push('/read/<第一个导入论文的 slug>')`（兜底 nsr-mt454tqk），讲解对话统一在全屏页右上角 AI 讲解抽屉。
