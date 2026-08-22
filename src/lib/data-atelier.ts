/* Research Atelier · 用户真实数据（2026-08-22 重写：不再使用设计稿示例数据）
 * 来源：project_state.md（R 阶段记录）、paper_first_pass.md（第一遍导读）、user_model_draft.md（画像）
 * 原则：只记录真实发生过的事；未读的论文不出现；待核对信息显式标注。 */

export const papers = [
  {
    id: "01",
    title: "Neural Scene Representation for Locomotion on Structured Terrain",
    authors: "作者待核对",
    year: "待核对",
    venue: "待核对",
    status: "深度精读",
    statusColor: "#8B2635",
    tags: ["Scene Completion", "4D Sparse U-Net", "MinkowskiEngine", "Locomotion"],
    firstEncounter: "2026-07-20",
    lastEngaged: "2026-08-21",
    insights: [
      { date: "07/20", text: "第一遍导读完成。这篇论文不是直接教机器人走路，而是先学会把残缺噪声的地形点云补完整，再把可靠的场景表示交给 locomotion。" },
      { date: "08/05", text: "R1–R3 toy 闭环跑通：c_i/f_i/k 表示、逐格最大合并基线、最小学习模型——基线补不回盲格，学习模型补回 15/15 但多出 7 个额外格。" },
      { date: "08/21", text: "R5–R7：4D U-Net + 逐层 pruning + autoregressive rollout 已实现；但完整模型始终未超过 merge baseline——不能把 loss 下降当成功，下一步先对齐论文的 IsaacGym 数据分布。" },
    ],
    aiNote: "从 R5 开始你建立了'失败=证据'的纪律：不调阈值掩盖、不把训练 loss 当成功。这是复现方法论上真正的转折。",
    connections: [],
  },
];

export const researchPhases = [
  { phase: "P1", label: "论文与领域理解", period: "Jul 2026", done: true },
  { phase: "P2", label: "数据与 toy 闭环", period: "Jul–Aug 2026", done: true },
  { phase: "P3", label: "稀疏模型与时间线", period: "Aug 2026", done: false, active: true },
  { phase: "P4", label: "数据对齐与完整复现", period: "Sep 2026", done: false },
];

export const turningPoints = [
  { date: "08/02", shift: "代码导读从'功能比喻'转向'数据合同'——没有掌控感的讲解留不下东西；复述不过不前进。" },
  { date: "08/19", shift: "R5 验收纪律确立：loss 下降不等于场景补全能力，必须超过明确 baseline；负面结果如实记录。" },
  { date: "08/21", shift: "R6 闭环实证：官方 checkpoint 真实接受 R6 的 187 维 height_scan——接口对齐从合同推断变成实证。" },
];
