/**
 * 论文 PDF 文件服务（react-pdf Document 读取用）
 * GET /api/paper/pdf?slug=<slug> → application/pdf
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/store";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug");
  if (!slug) return new Response("missing slug", { status: 400 });
  try {
    const file = path.join(DATA_DIR, "papers", slug, "original.pdf");
    const buf = await fs.readFile(file);
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${slug}.pdf"`,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
