# Markdown 学习资料实施计划

用户已确认资料库、章节目录、Markdown 阅读以及手动新建、移动、排序、重命名目录，并要求实施。

**Goal:** 在独立学习入口导入 Markdown 和图片资料文件夹，自由整理目录并延用选区追问与笔记。

**Architecture:** 稳定 UUID 标识资料库、文件夹、文档与资源。显示目录与导入时的资源路径映射分离；修改显示目录不改文档内容和选区锚点。文件持久化在现有用户数据目录。学习阅读页使用 /study/[id]，旧 /learning 的个性化兼容地址保留。

**Tech Stack:** Next.js 16 App Router、React、现有 react-markdown / KaTeX、Node 文件存储、node:test、Playwright。

## 1. 存储与接口
- [x] 新增 src/lib/study-library.ts 和 types，支持资料库/文件夹创建、上传、树查询、改名、移动排序和删除。
- [x] 上传接受 multipart 文件、原始相对路径及 parentId，目录关系显式保存。文档使用稳定 URL，原图和文档相对链接根据导入路径映射解析。
- [x] 新增 /api/study-library、/api/study-library/import、/api/study-library/document、/api/study-library/asset；限制路径越界、文件类型、大小、目录循环，失败不提交半成品。
- [x] 临时目录单元测试：嵌套教材导入、相对图片、同名资料、移动后链接、排序、删除、非法路径和循环移动。

## 2. 学习页面
- [x] 新增 src/components/study-library.tsx 和 study-reader.tsx；首页加入“学习”入口，/study 与 /study/[id] 提供可回跳地址。
- [x] 单/多 MD 与文件夹上传，明确选择目标目录。目录树可折叠、改名、新建、删除、拖动移动与排序，并提供按钮操作替代拖动。
- [x] 阅读器保留公式、图片、表格；标题目录、阅读进度、前后文档跳转；复用 ReadingSurface 的独立追问和笔记。
- [x] 图片、MD 链接按服务端提供的稳定映射渲染；不因目录改名改变原文指纹。资料缺失显示可返回资料库的空态。

## 3. 验证
- [x] npm run check；修复本轮引入的问题。
- [x] 以本地 any-reader-ui 的微积分样本在隔离测试数据目录导入，验证公式、相对图片和章节结构。
- [x] 浏览器验证文件导入、文件夹导入、改名、移动排序、跨文档导航、笔记回跳、刷新恢复、移动端布局；不得修改参考项目。
- [x] npm run build；记录实际结果，不提交或覆盖用户其他未提交工作。

## 验收结果

- npm run check：TypeScript、ESLint 及 251 项测试通过。
- npm run build：通过；保留 5 条已有动态文件访问追踪警告。
- 隔离数据目录的浏览器验收通过：文件夹导入、公式与图片、内部链接、改名、移动排序、选区笔记及移动后回跳、移动端布局。
- 使用 any-reader-ui 的真实微积分小节与原始图片验证阅读效果。
- 独立复查发现的创建目录并发定位、引用式资源链接问题已修复，复查无阻塞项。
