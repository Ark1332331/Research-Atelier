# frozen/ — 冻结归档

存放已停用但留作参考的设计与实现，**不参与构建**（无入口可达，TS/ESLint 不检查此目录）。

| 目录/文件 | 来源 | 说明 |
|---|---|---|
| `atelier/` | 原 `src/components/atelier/` | v1 界面设计的三种视觉变体（atelier / mori / os），最终采用样式并入全局 CSS。保留供后续换肤/视觉迭代参考。 |

需要复活某个模块时：`git mv src/frozen/<x> <原位置>`，然后跑 `npm run typecheck` 与 `node scripts/check-dead-code.cjs` 验证接线完整。
