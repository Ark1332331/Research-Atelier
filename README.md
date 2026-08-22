# Research Atelier · 我的研究空间

> 个人论文学习一体化工具：论文库管理、论文筛选、精读翻译、术语卡、代码导读与实验复现检查点。数据全部存在本机，是「本地优先」的个人知识工作台，也可一键打包成 Electron 桌面 App（双击即开）。

## 功能

| 视图 | 作用 |
|---|---|
| **论文库** | 分组/文件夹管理论文，挑一篇设为「当前在读」，驱动后续导读与复现 |
| **论文筛选** | 与 AI 对话式筛选：入口澄清 → 收集候选 → 六维评分 → 筛完停在筛选笔记（`data/notes/screening.md`） |
| **精读讲解** | PDF 阅读器 + 逐段翻译 + 全文翻译（上传 PDF 自动生成 `translation.md`） |
| **术语卡** | 阅读中沉淀的术语：角色/掌握状态/复用范围，自动进入全局搜索 |
| **代码导读** | 读本机代码 + 跨文件调用链（Python 用 `scripts/py_chain.py` 做 AST 解析），并把「用户会卡的点/学会了什么」写回代码能力画像（`data/code-profile.json`），越用越懂你 |
| **实验复现** | 复现六层（概念→数据→模型→训练→指标→对齐），每层可勾验收规则，全部勾完才推进；含「给 Codex 的指挥话术」与 环境管理/放行检查/交接 三个工具 |

## 技术栈

- **Next.js 16.3**（App Router + Route Handlers，Turbopack 构建）+ **React 19** + **TypeScript**
- **react-pdf / pdfjs-dist**（PDF 阅读与文本层提取）
- **Electron 43**（桌面壳，见下）
- 数据层：纯文件（`data/` 目录），无数据库；可选 Vercel KV

## 快速开始（开发模式）

```bash
npm install
npm run dev          # http://localhost:3000
```

依赖与配置：

- 对话/翻译需要 DeepSeek API Key：复制 `.env.local.example` 为 `.env.local` 填入 `DEEPSEEK_API_KEY`
- 代码导读的跨文件调用链需要本机 `python3`（`scripts/py_chain.py`）

## 桌面壳（Electron）— 双击即开

用 Electron 包一层壳：保留整套 Next 前后端与 `/api/*`、`data/` 读写、代码导读，只加桌面启动器。主进程用 **Electron 内置 Node**（`ELECTRON_RUN_AS_NODE`）拉起本地 `next build + next start`，窗口加载 `http://127.0.0.1:<随机端口>`，**不依赖系统 Node**。

### 构建命令

```bash
npm run desktop:dev   # 开发热更：next dev + electron 直连（concurrently 一起跑）
npm run desktop:dir   # next build + electron-builder --dir（linux-unpacked，最快验证）
npm run desktop       # 完整分发：AppImage + deb（产物在 release/）
```

产物：

- `release/Research Atelier-<version>.AppImage` — 双击运行（需可执行权限 + FUSE）
- `release/<name>_<version>_amd64.deb` — 安装后从应用菜单打开
- `release/linux-unpacked/` — 免安装调试版

### 数据在哪（重要）

- **打包后**：数据目录 = 系统用户数据目录（Linux 为 `~/.config/Research Atelier/data`）。首次启动自动把随包 `data/` 种子拷贝过去，之后所有改动都写用户目录，持久不丢；重装/更新不覆盖。
- **开发时**：读写项目内 `data/`（与 `npm run dev` 完全一致）。
- 注意：GitHub 仓库**不含** `data/`（个人数据，已被 `.gitignore` 排除）。克隆后首次运行会得到空数据目录，把本机旧 `data/` 拷进用户数据目录（或直接在应用里重新导入论文）即可恢复。

### 代码导读的「代码根」

- 打包时 `scripts/gen-runtime-config.mjs` 把本机项目根（`workflow-app` 的上级，即 `allinone/`，含 `reproduction/`）写入 `electron/runtime-config.json`；首次启动写入用户数据目录的 `data/code-roots.json`。
- 换机器/换路径后：直接编辑用户数据目录的 `data/code-roots.json`（`{ "roots": [{ "id": "project", "name": "项目根", "root": "<绝对路径>" }] }`），或启动前设环境变量 `RA_DEFAULT_CODE_ROOT`。

### 桌面壳环境变量

| 变量 | 用途 |
|---|---|
| `RA_DATA_DIR` | 数据目录（桌面壳自动设为用户目录；一般不用手动设） |
| `RA_DEV_URL` | 开发模式：直连已运行的 next dev |
| `RA_NODE_BIN` | 子进程 node 二进制（桌面壳自动设为 Electron 二进制） |
| `RA_DEFAULT_CODE_ROOT` | 代码导读默认根（覆盖运行时配置） |
| `RA_DEVTOOLS=1` | 启动时打开 DevTools |
| `RA_DEBUG_SHOT=<png>` / `RA_DEBUG_DUMP=<txt>` | 加载完成后截图/转储页面文本（无头验证用） |

## 数据层

`data/` 目录是真相源，读写走 `src/lib/store.ts`：

```text
data/
├── library.json        # 论文库（分组 + 论文 + 当前在读）
├── glossary.json       # 术语卡
├── code-profile.json   # 代码能力画像（自更新）
├── profile.md          # 知识水平画像
├── repro-context.md    # 复现上下文
├── environment.md      # 环境卡
├── handoffs.md         # 交接词
├── ops.md              # 操作记录
├── notes/screening.md  # 筛选笔记（追加式）
└── papers/<slug>/      # 导入的论文：original.pdf + page_XX.txt + translation.md + meta.json
```

`store.ts` 本地用 Node fs 读写 `process.cwd()/data`；若配置 `VERCEL_KV_REST_API_URL + VERCEL_KV_REST_API_TOKEN` 自动切换 Vercel KV（本地不配）。桌面壳通过环境变量 `RA_DATA_DIR` 把数据目录指向用户可写目录。

## API 一览

| 路由 | 说明 |
|---|---|
| `POST /api/chat` | DeepSeek 对话（大脑入口） |
| `GET/POST /api/paper` | 论文导入（PDF 提取 + 全文翻译）/ 列表与详情 |
| `GET /api/paper/pdf?slug=` | 论文 PDF 文件服务（react-pdf 读取） |
| `GET/POST /api/library` | 论文库（分组/增删改/当前在读） |
| `GET/POST /api/code-read` | 代码导读（目录树 / 文件内容 / Python 调用链） |
| `GET/POST /api/code-profile` | 代码能力画像（手动更新 / 掌握标记 / 导读日志） |
| `GET/POST /api/terms` | 术语卡 |
| `GET/POST /api/memory` | 记忆层（profile / environment / handoff / screening / ops） |
| `GET /api/context` | 工具对话自动上下文（repro / environment） |

## 目录结构

```text
workflow-app/
├── electron/               # 桌面壳：main.js（主进程）、runtime-config.json（构建时生成，不入库）
├── scripts/                # py_chain.py（Python 调用链）、extract-pdf.mjs（PDF 文本提取）、
│                           # translate-full.mjs（全文翻译 CLI）、gen-runtime-config.mjs（打包时生成代码根）
├── public/                 # 静态资源：pdf.worker / pdfjs cmaps / papers/nsr.pdf（内置论文）
├── src/
│   ├── app/
│   │   ├── page.tsx        # 主界面（论文库/筛选/术语/代码导读/复现）
│   │   ├── read/[slug]/    # 精读讲解全屏页
│   │   └── api/            # 全部后端 Route Handlers
│   ├── components/         # 各视图组件
│   └── lib/                # store.ts（数据层）、data.ts、pdf-alignment.ts 等
├── data/                   # 运行时数据（不入库，见上）
├── electron-builder.yml    # 桌面壳打包配置（asar:false，Next 子进程需真实文件）
└── package.json
```

## 注意事项

- **字体**：界面字体走 Google Fonts（`globals.css` 的 `@import`），离线时回退系统字体，不影响功能。
- **文件系统**：项目如放在 NTFS 分区（ntfs3 驱动）上，偶发目录索引损坏会导致 `next build` 挂起、目录遍历卡死（内核层，`kill -9` 无效）。遇到构建无输出先查 `.next/` 是否可正常 `ls`；建议将项目放在 ext4 等原生 Linux 分区。桌面壳的代码导读遍历已跳过常见构建缓存目录（`.build-cache`/`.cache`/`release` 等）。
- **pdfjs 与 SSR**：PDF 阅读器用 `next/dynamic({ssr:false})` 客户端加载，pdfjs-dist 在服务端仅用于文本层提取（`serverExternalPackages`），Electron 打包不破坏该链路。
- 桌面壳采用 `asar:false`（Next server 是独立 node 子进程，读不了 asar 内的文件），体积较大属预期，后续可用 Next standalone 输出优化。
