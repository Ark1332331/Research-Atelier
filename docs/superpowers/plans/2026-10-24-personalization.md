# 个性化页面精简实施清单

> 按用户已确认的方案在当前工作区实施；不扩展学习功能，不改观察者推断机制。

**Goal:** 一个个性化入口，画像和讲法各司其职，依据与管理操作按需展开。

**Architecture:** 共享数据加载与版本保护；列表只呈现已生效内容；原生模态侧栏承载编辑、待确认、详情和设置。旧链接转入统一入口并保留定位信息。回答底部移除候选轮询，保留反馈与实际回答快照。

**Tech Stack:** Next.js 16、React 19、TypeScript、原生 dialog、现有学习 API。

- [x] 浏览器测试先断言统一入口，验证旧界面不满足该断言。
- [x] 新建 personalization 组件目录：共享数据 hook、记录分组 helper、表单、详情、设置。详情保留证据/版本/关联讲法；设置保留暂停、历史、备份导入导出。
- [x] 更新 app/page、旧 profile/learning 路由与 layout；删除无引用的重复界面与悬浮观察计数。
- [x] 简化 learning-response，只在展开时展示反馈输入与当时画像/讲法版本。
- [x] 浏览器验收：画像与讲法分别确认、搜索、编辑草稿不被轮询覆盖、版本冲突保留草稿、停用/删除关联、旧链接、前进后退、键盘关闭与焦点恢复、移动端不溢出。
- [x] 运行 npm run check、浏览器回归、npm run build，检查截图和差异；修正独立审查发现的问题。

参考：[Open WebUI 个性化组件](https://github.com/open-webui/open-webui/blob/main/src/lib/components/chat/Settings/Personalization.svelte)、[LobeHub 设计规范](https://github.com/lobehub/lobehub/blob/canary/DESIGN.md)、[AnyReader](https://github.com/TeaFishMeow/any-reader-ui)。

验证记录：132 项自动测试通过；浏览器测试覆盖个性化、阅读追问与公式、论文生命周期和浮窗交互（隔离数据及模拟 API）；生产构建通过。独立审查发现的跳转残留侧栏、旧观察锚点兼容问题均已修复并加入浏览器断言。
