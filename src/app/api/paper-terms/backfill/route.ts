/**
 * 补抽术语：为所有已导入论文补做「术语抽查→记入术语卡」。
 * 用于术语功能上线前导入的旧论文。POST 触发后后台逐篇抽取，返回将补抽的篇数。
 */
import { backfillTermsForAllPapers } from "@/lib/terms-extract";

export async function POST() {
  try {
    const r = await backfillTermsForAllPapers();
    return Response.json({ ok: true, ...r });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
