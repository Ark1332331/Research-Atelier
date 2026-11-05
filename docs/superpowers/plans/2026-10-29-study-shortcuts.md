# 学习页自定义快捷提问

用户需求：参考本地 AnyReader，在划线追问之外提供「解题」「是什么」「为什么」及自定义快捷指令。

## 实现

- 学习原文、AI 回答及翻译中已有的 ReadingSurface 选区菜单显示启用的快捷项。点击直接提交指令，同时保留原始选区、数学 Markdown、周边上下文和来源。
- 复用现有 reading-memory 问答、观察者与高光存储；同一选区继续原对话，回答选区产生独立子对话，保持右侧并列阅读。
- 每个对话有自己的待发送队列；同一指令在处理中重复点击会合并，不同指令顺序提交，使用最新消息版本。失败后保留输入供手动重试，不自动循环。
- 顶栏及选区菜单提供「自定义快捷」，允许编辑名称和指令、新增、删除、排序、启停，最多 12 项。
- 设置保存到应用数据目录 study-shortcuts.json。版本校验和原子更新避免多窗口互相覆盖；允许主动清空全部快捷项。
- 选区菜单根据实际大小限制在屏幕内；设置抽屉保留键盘焦点与保存失败时的草稿。

## 参考

只读参考 D:/devpy/projects/anyreader/any-reader-ui/src/components/AskMenu.tsx、SettingsWindow.tsx 及 src/lib/defaults.ts。

## 验证

- study-shortcuts.test.mjs：默认项、自定义持久化、空列表、并发版本冲突、非法输入，2 项通过。
- browser/study-shortcuts.mjs：直接提交、队列、公式和上下文、子母对话、自定义修改排序停用及重载、保存/请求失败恢复、键盘和窄屏，通过；AI 请求均为模拟响应。
- browser/reading-highlights.mjs、browser/notes-and-windows.mjs：通过。
- npm run check：类型检查和全量 lint 通过；255 项测试中 254 项通过，paper-import.test.mjs 的队列中间状态断言遇到已有时序波动（not_found/queued）。未改动该功能；单独复跑其 28 项全部通过。
- 界面截图：.build-cache/shortcut-qa/menu.png、editor.png、mobile.png。
- npm run build：通过。
