# 学习资料持久化与恢复

日常启动使用固定用户目录。Windows 默认 `%APPDATA%/Research Atelier/data`，`npm run dev`、`npm start` 与桌面程序都应使用这里。本机 `.env.local` 已固定到该位置。更换端口或重启不会清空数据。

- `study-library/index.json`：目录、文件名、稳定文档 ID 和原文件摘要。
- `study-library/imports/<批次 ID>/<文件 ID>`：正文及图片，直接保存在磁盘。
- `reading-memory.json`：追问及回复。
- `reading-notes.json`：批注及原文定位。

项目内 `.build-cache`、`.next`、`build` 和 `out` 不得作为日常数据目录。使用这些目录做隔离测试必须显式设置 `RA_ALLOW_TEST_DATA_DIR=1`；未声明时启动报错，不会悄悄打开一个临时空库。测试不能针对日常用户目录执行写入。

## 2026-10-31 恢复

旧数据来自 `.build-cache/study-test-data`。已复制至固定目录，保留文档 ID，未删除旧目录。迁入 8 篇文档、11 条追问、5 条笔记；现有 28 条追问保持原记录内容。源/目标备份与本机配置备份位于 `%APPDATA%/Research Atelier/backups/study-recovery/` 的带时间戳子目录，`report.json` 记录完整性检查、冲突和已缺失的原文引用。备份内可能含私人对话及本机配置，请保持在本机用户目录，不要提交到仓库。

恢复脚本：

```text
node scripts/recover-study-data.mjs SOURCE TARGET BACKUPS
```

脚本获取与应用相同的写锁；校验原文件 SHA-256；先备份双方相关数据，再复制正文、合并记录并原子更新索引。已存在的记录优先，同 ID 的不同原文内容会中止迁移；源记录冲突保留在备份和报告中。可重复运行，不会重复添加相同 ID。它不会自动复活索引中已删除的文档，也不会猜测笔记应关联哪一篇原文。

恢复备份时应先停止服务，并依据报告选择所需文件，不要用旧目录整体覆盖正在使用的用户目录。
