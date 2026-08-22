/**
 * 代码能力画像接口：代码导读的“越用越懂你”底座
 * GET  /api/code-profile                       → { profile }
 * POST /api/code-profile  { action:"update", patch }      → 手动编辑背景/卡点/偏好/分层
 * POST /api/code-profile  { action:"mastered", terms:[..] }→ 学会的卡点/语法标记为已掌握（自动）
 * POST /api/code-profile  { action:"log", entry:{...} }   → AI 追加上次导读的更新（卡在哪/解释了什么/是否通过）
 * 存储：本地 data/code-profile.json；生产（Vercel）自动切 KV（见 src/lib/store.ts）
 */
import { readStore, writeStore } from "@/lib/store";

const FILE = "code-profile.json";

interface CodeProfile {
  version?: number;
  updatedAt?: string;
  background: string;
  gaps: string[];
  preferences: string[];
  depth: string;
  mastered: string[];
  log: { at?: string; file?: string; explained?: string[]; blocked?: string[]; passed?: boolean; note?: string }[];
}

export type { CodeProfile };

async function readProfile(): Promise<CodeProfile> {
  const raw = await readStore(FILE);
  if (raw) {
    try {
      const d = JSON.parse(raw);
      return {
        version: d.version ?? 1,
        updatedAt: d.updatedAt ?? "",
        background: d.background ?? "",
        gaps: Array.isArray(d.gaps) ? d.gaps : [],
        preferences: Array.isArray(d.preferences) ? d.preferences : [],
        depth: d.depth ?? "",
        mastered: Array.isArray(d.mastered) ? d.mastered : [],
        log: Array.isArray(d.log) ? d.log : [],
      };
    } catch { /* fallthrough */ }
  }
  return {
    version: 1, updatedAt: "", background: "", gaps: [],
    preferences: [], depth: "", mastered: [], log: [],
  };
}

export async function GET() {
  const profile = await readProfile();
  return Response.json({ profile });
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }

  const profile = await readProfile();
  const action = body.action as string | undefined;
  const now = new Date().toISOString();
  profile.updatedAt = now;

  if (action === "update") {
    const patch = (body.patch ?? {}) as Partial<CodeProfile>;
    if (typeof patch.background === "string") profile.background = patch.background;
    if (Array.isArray(patch.gaps)) profile.gaps = patch.gaps;
    if (Array.isArray(patch.preferences)) profile.preferences = patch.preferences;
    if (typeof patch.depth === "string") profile.depth = patch.depth;
    if (Array.isArray(patch.mastered)) profile.mastered = patch.mastered;
  } else if (action === "mastered") {
    const terms = (body.terms ?? []) as string[];
    const set = new Set(profile.mastered);
    terms.forEach((t) => t.trim() && set.add(t.trim()));
    profile.mastered = [...set];
    // 学会的从 gaps 里移除
    profile.gaps = profile.gaps.filter((g) => !terms.some((t) => t.trim() && g.includes(t.trim())));
  } else if (action === "log") {
    interface Entry { file?: string; explained?: string[]; blocked?: string[]; passed?: boolean; note?: string }
    const entry = (body.entry ?? {}) as Entry;
    profile.log.push({
      at: now,
      file: entry.file ?? "",
      explained: Array.isArray(entry.explained) ? entry.explained : [],
      blocked: Array.isArray(entry.blocked) ? entry.blocked : [],
      passed: Boolean(entry.passed),
      note: entry.note ?? "",
    });
    // 限制历史长度，避免无限膨胀
    if (profile.log.length > 80) profile.log = profile.log.slice(-80);
    // 若通过，把 blocked 里已解释的标记为已掌握（去重）
    if (entry.passed && Array.isArray(entry.blocked)) {
      const set = new Set(profile.mastered);
      entry.blocked.forEach((t) => t.trim() && set.add(t.trim()));
      profile.mastered = [...set];
    }
  } else {
    return Response.json({ error: `未知 action：${action}` }, { status: 400 });
  }

  await writeStore(FILE, JSON.stringify(profile, null, 2));
  return Response.json({ profile });
}
