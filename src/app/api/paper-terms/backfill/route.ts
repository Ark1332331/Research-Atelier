/**
 * 补抽术语：为所有已导入论文补做「术语抽查→记入术语卡」。
 * 用于术语功能上线前导入的旧论文。POST 触发后后台逐篇抽取，返回将补抽的篇数。
 */

export async function POST() {
  return Response.json({error:'已停止自动抽取术语。请在阅读或对话中选择要收藏的术语。'},{status:410});
}
