/**
 * Reproduction Fact Taxonomy（Step 4）—— 有限、封闭的事实注册表。
 *
 * 原则（评审约束）：
 *  - 正式 Facts 不允许自由生成 key；key 必须来自本注册表（KNOWN_FACTS）。
 *  - 六类：data / preprocessing / model / training / evaluation / runtime。
 *  - 每类含：key / 中文标签 / importance（required|recommended|optional）/
 *    sides（该 key 在 paper/repo 哪一侧有意义）/ valueType（归一化类型）。
 *  - 未知 key → normalize 时拒绝（不进入正式 Facts）。
 *  - 这是 Step 4 的有限 taxonommy；后续要加 key 必须改本文件（走 schema 演进，不是自由生成）。
 */
import type { FactImportance } from "@/lib/reproduction-spec";

export type FactCategory = "data" | "preprocessing" | "model" | "training" | "evaluation" | "runtime";

export interface FactDef {
  key: string;
  category: FactCategory;
  label: string;
  importance: FactImportance;
  sides: ("paper" | "repo")[];
  /** valueType：normalize 的归一化目标 */
  valueType: "number" | "string" | "bool" | "enum" | "array" | "unknown";
  /** enum 时的合法取值（valueType=enum） */
  enumValues?: string[];
  /** 归一化提示（给 LLM 抽取与用户展示） */
  hint?: string;
}

/** enum 的显式别名表（valueType=enum 时用）：canonical → 实际归一化值。
 *  只做精确映射，禁止 substring 猜测（AdamW 绝不能被猜成 adam）。 */
export const ENUM_ALIASES: Record<string, Record<string, string>> = {
  optimizer: {
    "adam": "adam",
    "adamw": "adamw",
    "adam_w": "adamw",
    "adam-w": "adamw",
    "adam weight decay": "adamw",
    "weight decay adam": "adamw",
    "sgd": "sgd",
    "momentum sgd": "sgd",
    "rmsprop": "rmsprop",
    "adamax": "adamax",
  },
};

/** 有限 taxonomy：所有允许的 fact key。新增 key 必须在这里登记。 */
export const KNOWN_FACTS: FactDef[] = [
  /* —— data（数据） —— */
  { key: "data.dataset_name", category: "data", label: "数据集名称", importance: "required", sides: ["paper", "repo"], valueType: "string" },
  { key: "data.dataset_version", category: "data", label: "数据集版本", importance: "recommended", sides: ["paper", "repo"], valueType: "string" },
  { key: "data.split", category: "data", label: "数据划分（train/val/test）", importance: "required", sides: ["paper", "repo"], valueType: "string" },
  { key: "data.num_observations", category: "data", label: "观测数量", importance: "recommended", sides: ["paper"], valueType: "number" },
  { key: "data.input_format", category: "data", label: "输入格式（点云/图像/…）", importance: "required", sides: ["paper", "repo"], valueType: "string" },

  /* —— preprocessing（预处理） —— */
  { key: "preprocessing.input_size", category: "preprocessing", label: "输入尺寸（体素网格/图像分辨率）", importance: "required", sides: ["paper", "repo"], valueType: "string" },
  { key: "preprocessing.voxel_resolution", category: "preprocessing", label: "体素分辨率（如 0.05m）", importance: "required", sides: ["paper", "repo"], valueType: "number" },
  { key: "preprocessing.normalization", category: "preprocessing", label: "归一化/标准化", importance: "recommended", sides: ["paper", "repo"], valueType: "string" },
  { key: "preprocessing.augmentation", category: "preprocessing", label: "数据增强", importance: "recommended", sides: ["paper", "repo"], valueType: "string" },
  { key: "preprocessing.coordinate_system", category: "preprocessing", label: "坐标系/对齐约定", importance: "recommended", sides: ["paper", "repo"], valueType: "string" },

  /* —— model（模型） —— */
  { key: "model.architecture", category: "model", label: "模型架构", importance: "required", sides: ["paper", "repo"], valueType: "string" },
  { key: "model.backbone", category: "model", label: "骨干网络", importance: "required", sides: ["paper", "repo"], valueType: "string" },
  { key: "model.channels", category: "model", label: "通道数", importance: "recommended", sides: ["paper", "repo"], valueType: "array" },
  { key: "model.kernel_sizes", category: "model", label: "卷积核大小", importance: "recommended", sides: ["paper", "repo"], valueType: "string" },
  { key: "model.loss", category: "model", label: "损失函数", importance: "required", sides: ["paper", "repo"], valueType: "string" },
  { key: "model.pruning_alpha", category: "model", label: "剪枝阈值 alpha", importance: "recommended", sides: ["paper", "repo"], valueType: "number" },

  /* —— training（训练） —— */
  { key: "training.optimizer", category: "training", label: "优化器", importance: "required", sides: ["paper", "repo"], valueType: "enum", enumValues: ["adam", "adamw", "sgd", "rmsprop", "adamax"], hint: "归一化为小写：Adam→adam" },
  { key: "training.lr", category: "training", label: "学习率", importance: "required", sides: ["paper", "repo"], valueType: "number" },
  { key: "training.batch_size", category: "training", label: "Batch size", importance: "required", sides: ["paper", "repo"], valueType: "number" },
  { key: "training.epochs", category: "training", label: "训练轮数（epochs）", importance: "recommended", sides: ["paper", "repo"], valueType: "number" },
  { key: "training.steps", category: "training", label: "训练步数（steps/iterations）", importance: "recommended", sides: ["paper", "repo"], valueType: "number" },
  { key: "training.lr_schedule", category: "training", label: "学习率调度", importance: "recommended", sides: ["paper", "repo"], valueType: "string" },
  { key: "training.seed", category: "training", label: "随机种子", importance: "recommended", sides: ["paper", "repo"], valueType: "number" },

  /* —— evaluation（评估） —— */
  { key: "evaluation.metric", category: "evaluation", label: "评估指标", importance: "required", sides: ["paper", "repo"], valueType: "array" },
  { key: "evaluation.protocol", category: "evaluation", label: "评估协议（后处理/阈值）", importance: "required", sides: ["paper", "repo"], valueType: "string" },
  { key: "evaluation.baseline", category: "evaluation", label: "对比基线", importance: "required", sides: ["paper", "repo"], valueType: "string" },

  /* —— runtime（运行环境） —— */
  { key: "runtime.python_version", category: "runtime", label: "Python 版本", importance: "recommended", sides: ["repo"], valueType: "string" },
  { key: "runtime.pytorch_version", category: "runtime", label: "PyTorch 版本", importance: "recommended", sides: ["repo"], valueType: "string" },
  { key: "runtime.cuda_version", category: "runtime", label: "CUDA 版本", importance: "recommended", sides: ["repo"], valueType: "string" },
  { key: "runtime.gpu", category: "runtime", label: "GPU 型号", importance: "recommended", sides: ["repo"], valueType: "string" },
];

export const FACT_BY_KEY: Map<string, FactDef> = new Map(KNOWN_FACTS.map((f) => [f.key, f]));

/** key 是否合法（必须是注册表里的 key，不允许自由生成） */
export function isKnownFactKey(key: string): boolean {
  return FACT_BY_KEY.has(key);
}

export function factDef(key: string): FactDef | undefined {
  return FACT_BY_KEY.get(key);
}

export function categoryLabel(c: FactCategory): string {
  return { data: "数据", preprocessing: "预处理", model: "模型", training: "训练", evaluation: "评估", runtime: "运行环境" }[c];
}
