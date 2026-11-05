# Research Atelier · 我的研究空间

面向个人的论文阅读与 Markdown 学习工作台。把原文、翻译、AI 追问和自己的笔记放在一起：选中不懂的内容提问，沿着高光回到对话，再把有用的理解留下来。

论文库与学习资料库分别管理。资料和阅读记录保存在本机；使用 AI 功能时，相关问题与上下文会发送到你配置的模型服务。

## 可以做什么

| 功能 | 使用方式 |
| --- | --- |
| 论文库 | 导入 PDF，整理分组、重命名、删除，并进入论文阅读器 |
| 对话导入 | 输入论文名称、链接、自然语言清单或 Markdown 表格，逐篇检索并尝试导入可获取的 PDF；可指定目标分组 |
| 学习资料 | 导入 Markdown 文件、包含图片的资料文件夹，或直接粘贴 Markdown；自行新建目录、移动、排序和改名 |
| 并排阅读 | 左边原文、右边问答画布；书目与章节目录可收起，阅读比例可调整 |
| 划线追问 | 从原文、翻译或 AI 回答中选择文字，附带上下文继续提问；高光可重新打开对应对话 |
| 自定义快捷 | 在学习页面配置「解题」「是什么」「为什么」等快捷提问指令 |
| 随心笔记 | 保存有用的选中文字并写下批注，从笔记库返回原文或对应回答 |
| 术语卡与生词本 | 先翻译或释义，再选择加入科研术语卡或生词本；保留出处并可按论文筛选 |
| 用户画像与讲解方式 | 独立观察者在后台整理对话中的证据；可以查看、修改、确认或停用画像与讲解建议 |
| 模型配置 | 保存多套 Base URL、模型 ID 和 API Key，随时切换 |

项目也保留代码导读、项目 AI 和实验复现工作区。代码导读中的 Python 调用链分析需要本机安装 Python。

## 快速开始

需要 Node.js 24 与 npm。Windows、Linux、macOS 均可在项目目录运行；CI 使用 Node.js 24.18.0。

```bash
git clone https://github.com/Ark1332331/Research-Atelier.git
cd Research-Atelier
npm ci
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。首次使用可先导入资料，再从工具栏打开「模型配置」。

生产模式：

```bash
npm run build
npm start
```

### 配置模型

首页、论文阅读器和学习阅读器都有「模型配置」入口。

1. 填写配置名称、Base URL、模型 ID 和 API Key。
2. 点击「测试连接」，检查服务是否接受这套配置。
3. 选择「仅保存」或「保存并启用」；之后可通过下拉菜单切换已保存的配置。

目前支持 **OpenAI 兼容的 Chat Completions 接口**。Base URL 可填 `https://服务地址/v1`，也接受完整的 `/chat/completions` 地址。仅支持 Responses API 的服务不能直接使用。

切换从下一次模型请求生效，正在生成的回答继续使用原配置。问答、翻译、论文导入整理和后台观察使用当前配置。测试连接只发送一条简短测试消息。

也可以复制 `.env.local.example` 为 `.env.local`，配置「环境默认」：

```dotenv
DEEPSEEK_API_KEY=你的密钥
# 可选，不填时使用 DeepSeek 默认地址与模型
# DEEPSEEK_BASE_URL=https://服务地址/v1
# DEEPSEEK_MODEL=模型ID
```

API Key 保存在本机后端的 `model-configs.json` 中，不写入浏览器存储，编辑时不回显。该文件包含明文密钥，备份时请按凭据保管。

## 阅读与学习

### 论文

在论文库上传 PDF，或通过「对话导入」输入清单，例如：

> 帮我找 AeroVLA、TravelUAV 和 OpenFly，导入 UAV 分组。

可提供标题、DOI、arXiv 或项目链接帮助匹配。导入任务逐篇显示检索、匹配和下载状态；找不到可靠候选或无法下载时，可以补充信息或重试。无法直接获取的 PDF 可自行下载后上传。

### Markdown 资料

在首页「学习」中创建资料库，点击「导入资料」：

- **粘贴 Markdown**：填写文档名称并粘贴正文，确认内容后导入。
- **文件 / 文件夹**：选择 `.md` 文件，或选择同时包含正文和图片的资料文件夹。

PDF 转 Markdown 由外部工具完成。使用文件夹导入时，相对图片和文档链接按导入路径关联；之后在应用内移动或改名，不会改变文档的稳定链接。

阅读时，左边看原文，右边看回答。选中文字即可翻译、追问、执行快捷指令或写随心笔记。

### 问答画布

每个追问有独立窗口，子追问与原对话可以并列存在。窗口可拖动、缩放、收起或放大。

| 操作 | 结果 |
| --- | --- |
| 关闭窗口「×」 | 保留对话与高光，之后可以重新打开 |
| 删除对话 | 删除该对话及其高光 |
| 清空画布 | 一次关闭当前画布上的问答框，保留记录、草稿和高光 |
| 停止回答 | 中止当前请求，保留已有完整对话和输入的问题 |

关闭窗口或清空画布后，正在生成的回答继续完成；刷新或关闭整个页面则可能中断请求。回答流式显示，打开历史对话时不会强制跳到底部。

划线追问按输出进度判断超时：首段正文最多等待 180 秒，开始输出后连续 90 秒没有新内容才停止。未完成的文字会暂留在当前窗口，但不会当作完整回答保存。

## 数据保存与备份

正常本地启动使用固定用户数据目录，更新代码或重启应用不会把资料放到另一个临时目录。

| 运行方式 | 默认位置 |
| --- | --- |
| Windows 本地开发 / 桌面版 | `%APPDATA%/Research Atelier/data` |
| Linux / macOS 本地开发 | `$XDG_CONFIG_HOME/Research Atelier/data`，未设置时为 `~/.config/Research Atelier/data` |
| Electron 桌面版 | Electron 的 `userData/data` 目录，由系统决定 |
| 指定目录 | 设置 `RA_DATA_DIR` 为固定的绝对路径 |

主要数据文件：

```text
data/
├── library.json             # 论文分组与条目
├── papers/                  # PDF、提取文本、翻译与元信息
├── study-library/           # 学习目录、Markdown 正文和图片
├── reading-memory.json      # 划线追问与已完成的回答
├── reading-notes.json       # 随心笔记与来源定位
├── glossary.json            # 手动收藏的术语
├── paper-import-chat.json   # 对话导入记录
├── model-configs.json       # 模型配置，包含密钥
└── learning/                # 用户画像、讲解建议和观察记录
```

备份前先停止应用，复制整个用户数据目录。恢复时先备份当前目录，避免直接用旧备份覆盖新记录。迁移脚本及恢复流程见 [存储与恢复说明](docs/storage-recovery.md)。

`.env.local`、本地 `data/`、构建缓存和桌面运行配置均不提交到 Git。克隆仓库不会带上原机器的个人资料。日常使用不能将 `RA_DATA_DIR` 指向 `.next`、`.build-cache`、`build` 或 `out`；`RA_ALLOW_TEST_DATA_DIR=1` 仅用于隔离测试。

当前学习、笔记和模型配置功能以本地文件存储为基础，需要可持久化、可写的磁盘；仅配置远程 KV 不能替代这些目录。

## 桌面版

Electron 使用本地 Next.js 服务，打包后的应用无需系统另装 Node.js。

```bash
npm run desktop:dir   # 当前平台的免安装目录
npm run desktop       # 当前平台安装包
npm run dist:win      # Windows 安装包
```

产物位于 `release/`。Windows 使用 NSIS 安装包，Linux 配置了 AppImage 和 deb。桌面数据写入用户目录。

当前打包配置会包含项目中的 `.env.local` 和 `data/`（如果存在）；向他人分发安装包前，应清除其中的个人密钥和资料。

## 开发与验证

技术栈：Next.js 16.3、React 19、TypeScript、react-pdf / PDF.js、react-markdown / KaTeX、Electron；本地文件保存资料和状态。

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

单元与 API 测试使用 Node 内置测试运行器。交互回归脚本在 `tests/browser/`，需要可用的 Playwright 和本地应用服务；可通过 `PLAYWRIGHT_MODULE` 指定 Playwright 模块路径。各脚本的服务地址及测试数据隔离方式见脚本本身。

公式渲染器与样式使用同一套 KaTeX 版本，避免补集横线、方框等符号缺失。升级时应保留版本一致性检查，并验证实际浏览器中的显示。

```text
src/app/          页面、样式与 API
src/components/   阅读器、问答画布、资料库与配置界面
src/lib/          数据存储、模型请求、导入与阅读逻辑
electron/         桌面启动器
scripts/          PDF 提取、数据恢复与打包工具
tests/            单元、API、浏览器测试及导入样本
docs/             设计记录、恢复说明和性能验证
```

## 参考

阅读与问答交互参考了 [AnyReader UI](https://github.com/TeaFishMeow/any-reader-ui)。流式回答与长对话性能改进参考了 Streamdown 和 assistant-ui 的实现思路，见 [性能验证记录](docs/chat-performance-2026-11-02.md)。
