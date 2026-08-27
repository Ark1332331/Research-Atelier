/**
 * 实验复盘：从对话/日志提炼坑点并归档到复现记录。
 * POST { slug, link?, text? }
 *   link: codex://threads/<uuid>（读本机 ~/.codex 该会话） 或 指向 dsh/codex 的 .jsonl 路径
 *   text: 直接粘贴的对话/日志文本（兜底）
 * 提炼：DeepSeek 抽坑点（[text, env, stage]），成功后 upsert 进该论文 record.pitfalls（env=true 标记环境相关）。
 * 返回 { pitfalls: 新增的坑点 }。
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getReproduction, upsertReproduction, idFor } from "@/lib/reproduction";

const execFileAsync = promisify(execFile);
const SQLITE = process.env.RA_SQLITE_BIN ?? path.join(os.homedir(), "miniconda3", "bin", "sqlite3");
const CODEX_DB = path.join(os.homedir(), ".codex", "state_5.sqlite");

const EXTRACT_SYSTEM =
  "你是复现坑点提炼器。从用户提供的论文复现对话/日志里，提炼实际遇到的坑点（报错、环境问题、关键解决方式、经验教训）。" +
  "严格只提炼对话里真实出现的，不要编造、不要泛泛总结。每个坑点输出一个 JSON 对象：{\"text\":\"一句话描述这个坑点/解决办法\",\"env\":true或false(是否环境相关),\"stage\":\"属于复现哪个阶段如R5/R6，不知道就空\"}。" +
  "把所有坑点输出为 JSON 数组：[{...}]。不要输出 JSON 以外内容。";

interface PitOff { text: string; env: boolean; stage?: string }

async function readRolloutText(fp: string): Promise<string> {
  try {
    const lines = (await readFile(fp, "utf-8")).split("\n");
    const out: string[] = [];
    for (const l of lines) {
      try {
        const d = JSON.parse(l);
        const p = d?.payload;
        if (d?.type === "response_item" && p?.type === "message" && (p.role === "user" || p.role === "assistant")) {
          const t = (p.content || []).map((c: { text?: string }) => c.text || "").join(" ").trim();
          if (t) out.push(`[${p.role}] ${t}`);
        }
      } catch { /* */ }
    }
    return out.join("\n").slice(0, 30000);
  } catch {
    return "";
  }
}

async function readDshSession(fp: string): Promise<string> {
  try {
    const lines = (await readFile(fp, "utf-8")).split("\n");
    const out: string[] = [];
    const txt = (o: unknown): string => Array.isArray(o) ? o.map(txt).join(" ") : (o && typeof o === "object" ? ((o as { text?: string }).text || "") : "");
    for (const l of lines) {
      try {
        const d = JSON.parse(l);
        if (d?.type === "user/message") { const t = txt(d.data?.content).trim(); if (t) out.push(`[user] ${t}`); }
        else if (d?.type === "assistant/message") { const t = txt(d.data?.message?.content || d.data?.content).trim(); if (t) out.push(`[assistant] ${t}`); }
      } catch { /* */ }
    }
    return out.join("\n").slice(0, 30000);
  } catch {
    return "";
  }
}

async function sourceText(link?: string, text?: string): Promise<string> {
  if (text && text.trim()) return text.slice(0, 30000);
  if (link) {
    const m = link.match(/threads\/([\w-]+)/);
    if (m) {
      try {
        const { stdout } = await execFileAsync(SQLITE, [CODEX_DB, `SELECT rollout_path FROM threads WHERE id='${m[1]}'`]);
        const fp = stdout.trim();
        if (fp) {
          const t = await readRolloutText(fp);
          if (t) return `【来自 codex://threads/${m[1]}】\n${t}`;
        }
      } catch { /* 读不到 */ }
    }
    if (link.endsWith(".jsonl")) {
      const t = link.includes("/sessions/") ? await readRolloutText(link) : await readDshSession(link);
      if (t) return `【来自 ${link}】\n${t}`;
    }
  }
  return "";
}

async function extractPitfalls(text: string): Promise<PitOff[]> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) await new Promise((r) => setTimeout(r, 600 * 2 ** (attempt - 2)));
    try {
      const res = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [{ role: "system", content: EXTRACT_SYSTEM }, { role: "user", content: text.slice(0, 15000) }],
          stream: false,
          max_tokens: 3000,
        }),
        signal: AbortSignal.timeout(60000),
      });
      if (res.ok) {
        const d = await res.json();
        const c = d?.choices?.[0]?.message?.content ?? "";
        const start = c.indexOf("[");
        const end = c.lastIndexOf("]");
        if (start >= 0 && end > start) {
          const arr = JSON.parse(c.slice(start, end + 1));
          return (Array.isArray(arr) ? arr : []).filter((p: PitOff) => p && typeof p.text === "string");
        }
      }
    } catch { /* 重试 */ }
  }
  return [];
}

export async function POST(request: Request) {
  let body: { slug?: string; link?: string; text?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }
  const slug = body.slug;
  if (!slug) return Response.json({ error: "slug 必填" }, { status: 400 });
  const r = await getReproduction(slug);
  if (!r) return Response.json({ error: "记录不存在" }, { status: 404 });

  const text = await sourceText(body.link, body.text);
  if (!text) return Response.json({ error: "未能读取到对话文本（请确认深度链接可访问，或直接粘贴文本）" }, { status: 400 });

  const offs = await extractPitfalls(text);
  const added: PitOff[] = [];
  for (const p of offs) {
    r.pitfalls.push({
      id: idFor("pf"),
      text: p.text,
      env: Boolean(p.env),
      stage: p.stage || undefined,
      papers: [slug],
      createdAt: new Date().toISOString(),
    });
    added.push(p);
  }
  await upsertReproduction(r);
  return Response.json({ pitfalls: added, count: added.length });
}
