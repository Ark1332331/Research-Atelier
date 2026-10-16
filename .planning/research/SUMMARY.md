# Research: 综合结论（SUMMARY）

三路调研（项目现状 / allinone 原始设计 / 市场对标）的综合判断，驱动本里程碑（v1.1「Windows 优化与学习闭环真实化」）的路线图。

## 核心判断

1. **Windows 是发布阻断项，不是优化项。** electron-builder 只有 linux target；conda/python3/sqlite3/zenity 全是硬编码 Linux 路径；SIGTERM 杀进程不可靠。目标用户是 Windows 上的中文科研入门者——当前根本无法分发。
2. **工程化地基缺失会让后续所有改进失去兜底。** 无 CI、无 typecheck、关键路由（sync/projects/handoff）零测试、死代码与 .orig 残留。先清地基再动功能。
3. **产品最大的"名不副实"是 AI 讲解。** 设计蓝图的核心主张是"越用越懂你"的 AI 助手，但 Paper Project 的讲解目前是规则模板拼串（V1 P3 缺 /api/sync/explain）。补完它 = 兑现产品核心价值主张。
4. **设计蓝图与市场调研在同一处收敛：学习记忆闭环。** 设计要求"术语首次出现即建档、数据即记忆、成长账自动适配"；市场教训是制卡负担与复习积压是弃坑主因。两者共同指向：标注一键变卡 + FSRS + glossery 预扫。
5. **不铺新功能。** 设计自己的评审原则与市场失败模式都指向同一结论：把"读一篇论文"的单一闭环做顺，冻结模块不激活。

## 技术要点
- FSRS：用成熟开源库 `ts-fsrs`，不自研；旧 study-model 数据需平滑迁移。
- AI 讲解：DeepSeek API 已配置（.env.local，DEEPSEEK_API_KEY）；讲解需带引用锚定与"诚实的不确定性"标注。
- Windows 打包：electron-builder 增 nsis target；跨平台命令探测（where vs which、python vs python3）；数据目录走 %APPDATA%。
- 测试/CI：GitHub Actions windows-latest 跑 typecheck + lint + node:test。

## 里程碑结构（Coarse，5 阶段）
1. Windows 一等公民（发布阻断项）
2. 工程化地基（CI/清理/测试）
3. AI 讲解闭环真实化（V1 P3/P5 补完）
4. 学习记忆升级（FSRS/一键制卡/glossary 预扫）
5. 单篇闭环打磨与 v1.1 发布
