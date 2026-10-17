# Plan 01-03 Summary: 文档双平台化

## 完成内容

**Task 1 — README Windows 快速开始**
- 快速开始改为 Windows（PowerShell）/ Linux-macOS（bash）双列
- "数据在哪"小节：Windows `%APPDATA%\Research Atelier\data`（含资源管理器直达提示）、Linux `~/.config/Research Atelier/data`；说明 dev 与桌面版共用用户数据目录、旧 Windows `~/.config` 数据自动迁移
- "AI 讲解配置"：DeepSeek key 在项目根 `.env.local`，标注获取入口与"不入库"提醒
- 构建命令小节：Windows 产物（NSIS Setup exe）与 Linux 产物（AppImage/deb）并列；`dist:win` 用法
- 代理说明：PowerShell `$env:HTTPS_PROXY=...` 与 bash `export` 并列
- 早期更新段落中的 `~/.config` 数据路径描述改为双平台表述
- Python 依赖说明改为"Windows 自动找 python/py，POSIX 找 python3"

**Task 2 — .env.local.example 修正**
- 注释与 electron/main.js 实际读取路径对齐（项目根目录 `.env.local`，桌面版读打包目录内随包文件）
- 补充 DeepSeek key 获取入口与"不要提交此文件"提醒

## 验证
- README 中 `export`/bash-only 命令均已提供 PowerShell 等价物
- `.env.local.example` 注释路径与 `electron/main.js` 的 `loadDotEnv(path.join(projectDir, ".env.local"))` 一致
- 数据目录描述与 01-02 实现的 `%APPDATA%` 行为一致
