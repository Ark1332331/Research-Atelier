import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const SANDBOX = mkdtempSync(path.join(tmpdir(), "ra-api-handoff-"));
process.env.RA_DATA_DIR = SANDBOX;
mkdirSync(path.join(SANDBOX, "learning"), { recursive: true });
writeFileSync(path.join(SANDBOX, "projects.json"), JSON.stringify({
  schema: 1,
  projects: [{ id: "seed-1", title: "World Models 综述", paperSlug: "wm-2024", reproState: { current: "已跑通数据层" } }],
  groups: [],
}), "utf8");

const { POST } = await import("../src/app/api/handoff/route.ts");

function post(body) {
  return POST(new Request("http://localhost/api/handoff", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

test("POST 正常路径：生成交接词，含论文标题/阅读页/当前状态", async () => {
  const res = await post({ projectId: "seed-1" });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(typeof data.prompt === "string" && data.prompt.length > 50);
  assert.ok(data.prompt.includes("World Models 综述"), "交接词应含论文标题");
  assert.ok(data.prompt.includes("/read/wm-2024"), "交接词应含阅读页链接");
  assert.ok(data.prompt.includes("已跑通数据层"), "交接词应含当前复现状态");
  assert.ok(data.prompt.includes("AGENTS.md"), "交接词应指向 AGENTS.md 约定");
});

test("POST 失败路径：不存在的项目返回 404", async () => {
  const res = await post({ projectId: "no-such" });
  assert.equal(res.status, 404);
});

test("POST 失败路径：缺 projectId 返回 404", async () => {
  const res = await post({});
  assert.equal(res.status, 404);
});

test("POST 失败路径：非 JSON 请求体返回 400", async () => {
  const res = await POST(new Request("http://localhost/api/handoff", { method: "POST", body: "not json" }));
  assert.equal(res.status, 400);
});

test.after(() => rmSync(SANDBOX, { recursive: true, force: true }));
