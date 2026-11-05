# 学习问答窗口交互修正

用户反馈：多次提问全部纵向展示，要求对照本地 AnyReader 问答 UI 和交互代码。

## 参考代码与差异

只读检查本地 any-reader-ui 的 App.tsx（createQaRecordWidget / openRecordWidget / focusWidget）、QaWidget.tsx、WindowFrame.tsx、qaConversation.ts 以及 styles/content.css、styles/window.css。

AnyReader 将独立问答窗口绝对定位、错位叠放，点击已有窗口或高光会置顶并展开；底部输入继续同一对话时才追加消息。它并不把独立窗口纵向排成列表，也不隐藏同一对话中的历史消息。

## 修改

- 保留原文和回答左右分区，将右侧改为限定范围的窗口画布；独立窗口错位叠放，最近操作的窗口置顶。
- FloatingPanel 在学习画布中支持拖动、键盘移动、缩放、放大/还原、收起和重置；尺寸随着左右分区与浏览器大小调整，始终限制在右侧。
- 学习画布与普通浮窗分别保存几何信息，首次保存对话时转移临时窗口的几何信息，避免窗口跳回初始位置。
- 使用更紧凑的标题栏、引用详情、消息和输入区。关闭、删除、高光和子母对话独立存储语义保持不变。

## 验证

- npm run check：类型检查、全量 lint、255 项测试通过。
- browser/reading-highlights.mjs：左右分区、高光、窗口叠放/置顶、草稿保留、键盘缩放、鼠标拖动、范围内放大还原、首次保存后几何保持、收起、关闭和删除、移动端通过。
- browser/study-shortcuts.mjs：快捷指令与连续提问通过。
- browser/notes-and-windows.mjs：普通浮窗、并发发送、笔记和来源定位回归通过。
- npm run build：通过；保留既有动态文件访问追踪警告。
- 截图：.build-cache/highlight-qa/stacked-answers.png。
