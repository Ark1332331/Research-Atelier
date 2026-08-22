/**
 * 研究工作流 P0–P5 定义（来源：workflow_v2_design_draft.md §2 — 用户自己定稿的路线图）
 * 任务/交付/验收 = 设计定稿（配置）；状态 = 全部从真实数据推导 + 手动验收记录覆盖。
 */

export interface Stage {
  id: string;
  name: string;
  brief: string;
  task: string;
  deliver: string;
  verify: string;
  status: "done" | "active" | "partial" | "pending";
  statusLabel: string;
}

/** 推导上下文：全部来自真实数据（文件存在性 / 论文状态 / 关键词命中） */
export interface StageCtx {
  screeningExists?: boolean;   // data/notes/screening.md 有内容
  domainMap?: boolean;         // profile 或洞察中出现「领域地图」
  firstPass?: boolean;         // 洞察中出现「第一遍导读」
  deepReading?: boolean;       // 当前论文状态 = 深度精读
  reproStarted?: boolean;      // data/repro-context.md 有内容
  handoffDone?: boolean;       // data/handoffs.md 有内容
}

export function buildStages(ctx: StageCtx = {}, manual: Record<string, string> = {}): Stage[] {
  const M = (id: string): Partial<Stage> | null => {
    const v = manual[id];
    return v ? { status: "done" as const, statusLabel: `验收 ✓ ${v}` } : null;
  };
  const merge = (id: string, base: Stage): Stage => ({ ...base, ...(M(id) ?? {}) });

  const mk = (id: string, s: Stage): Stage => merge(id, s);

  return [
    mk("P0", {
      id: "P0", name: "论文筛选", status: ctx.screeningExists ? "done" : "pending", statusLabel: ctx.screeningExists ? "完成" : "就绪",
      brief: "判断一篇论文值不值得读、读多深",
      task: "收集候选论文（单篇 10–20 分钟），逐篇六维评分：相关性、领域位置、与已有知识关联、阅读门槛、可复现性、出处可信度。",
      deliver: "筛选笔记：每篇带可点击来源、结论（值得读 / 跳过 / 待定）与一句话理由。",
      verify: "每条结论可溯源；你能说出「这几篇里先读哪篇、为什么、读多深」。",
    }),
    mk("P1", {
      id: "P1", name: "领域总地图", status: ctx.domainMap ? "done" : "pending", statusLabel: ctx.domainMap ? "完成" : "待做",
      brief: "读细节前，先知道这个领域长什么样",
      task: "画出领域结构：总任务、模块链、这篇论文在哪一层、它的输出给谁用、它不解决什么。",
      deliver: "一张总览图 + 一页说明（含接口转换说明：模块输出的数据怎么发给下游）。",
      verify: "你能指出「当前论文位于哪一层」并复述它的价值。",
    }),
    mk("P2", {
      id: "P2", name: "第一遍导读", status: ctx.firstPass ? "done" : "pending", statusLabel: ctx.firstPass ? "完成" : "待做",
      brief: "全篇过一遍，不跳过，同时沉淀概念",
      task: "逐节读：每节记大意 +「作者为什么写这段」；首次出现的术语当场建档；你冒出的问题进问题池。",
      deliver: "章节笔记、问题池、术语卡（首次出现即建档）。",
      verify: "读完能复述全文主线与各节关系；问题池能自然长出精读需求。",
    }),
    mk("P3", {
      id: "P3", name: "精读讲解", status: ctx.deepReading ? "active" : "pending", statusLabel: ctx.deepReading ? "当前" : "待做",
      brief: "把方法段从「功能比喻」降到「操作支架」",
      task: "针对卡住的方法/实现段：先答你的问题 → 最小操作支架 → 最小数据轨迹（输入值→计算规则→输出值）→ 训练闭环 → 挂回论文原句。",
      deliver: "能复述某个操作的「输入 → 计算 → 输出」、以及哪些数字会在训练中改变；复述不过就重讲。",
      verify: "复述通过 = 掌握；不通过 = 重讲，不前进。",
    }),
    mk("P4", {
      id: "P4", name: "复现", status: ctx.reproStarted ? "partial" : "pending", statusLabel: ctx.reproStarted ? "已开始" : "待做",
      brief: "从「跑起来」到「跑对了」，证据可追溯",
      task: "分层推进：概念 → 数据 → 模型 → 训练 → 指标 → 论文级对齐；每层先写清「这一步复现哪里、最小成功标准是什么」。",
      deliver: "实验证据账本（结论可追溯到命令/文件/行号）+ 以「超过明确 baseline」为验收的结论；负面结果如实记录。",
      verify: "你能独立解释一次实验「证明了什么、没证明什么、还差什么才能下结论」。",
    }),
    mk("P5", {
      id: "P5", name: "报告 / 交接", status: ctx.handoffDone ? "done" : "pending", statusLabel: ctx.handoffDone ? "完成" : "未开始",
      brief: "向未来的自己交付",
      task: "整理贡献定位与证据同层；生成自包含交接提示词；登记可复用资产（清单/模板/经验）。",
      deliver: "交接提示词（换会话/换模型可冷启动）+ 可复用资产登记。",
      verify: "你能复述「做了什么、证明了什么、没证明什么、资产在哪」。",
    }),
  ];
}
