import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// DATA_DIR 在 store.ts 模块加载时读取环境变量，必须先设沙箱再 import 路由
const SANDBOX = mkdtempSync(path.join(tmpdir(), "ra-api-projects-"));
process.env.RA_DATA_DIR = SANDBOX;
mkdirSync(path.join(SANDBOX, "learning"), { recursive: true });
writeFileSync(path.join(SANDBOX, "projects.json"), JSON.stringify({
  schema: 1,
  projects: [{ id: "seed-1", title: "种子论文项目", paperSlug: "seed-paper" }],
  groups: [],
}), "utf8");

const { GET, POST } = await import("../src/app/api/projects/route.ts");

function post(body) {
  return POST(new Request("http://localhost/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

test("GET 无 id 返回项目列表与分组", async () => {
  const res = await GET(new Request("http://localhost/api/projects"));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data.projects) && data.projects.length >= 1);
  assert.equal(data.projects[0].title, "种子论文项目");
  assert.ok(Array.isArray(data.groups));
});

test("GET 带存在的 id 返回项目", async () => {
  const res = await GET(new Request("http://localhost/api/projects?id=seed-1"));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.project.id, "seed-1");
});

test("GET 带不存在的 id 返回 404", async () => {
  const res = await GET(new Request("http://localhost/api/projects?id=no-such"));
  assert.equal(res.status, 404);
  const data = await res.json();
  assert.ok(typeof data.error === "string");
});

test("POST create 正常路径：创建项目并落盘", async () => {
  const res = await post({ action: "create", title: "  新项目  " });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.project.title, "新项目");
  assert.equal(data.project.reproState.current, "尚未同步执行进展。");
});

test("POST create 失败路径：空 title 返回 400", async () => {
  const res = await post({ action: "create", title: "   " });
  assert.equal(res.status, 400);
});

test("POST 失败路径：非 JSON 请求体返回 400", async () => {
  const res = await POST(new Request("http://localhost/api/projects", { method: "POST", body: "not json" }));
  assert.equal(res.status, 400);
});

test("POST setLastModule 失败路径：非法 module 返回 400", async () => {
  const res = await post({ action: "setLastModule", id: "seed-1", module: "bogus" });
  assert.equal(res.status, 400);
});

test("POST setLastModule 失败路径：项目不存在返回 404", async () => {
  const res = await post({ action: "setLastModule", id: "no-such", module: "pdf" });
  assert.equal(res.status, 404);
});

test("POST delete 正常路径后项目消失", async () => {
  const created = await (await post({ action: "create", title: "待删除" })).json();
  const del = await post({ action: "delete", id: created.project.id });
  assert.equal(del.status, 200);
  const after = await GET(new Request("http://localhost/api/projects?id=" + created.project.id));
  assert.equal(after.status, 404);
});

test("POST 未知 action 返回 400", async () => {
  const res = await post({ action: "nonsense", id: "seed-1" });
  assert.equal(res.status, 400);
});

test.after(() => rmSync(SANDBOX, { recursive: true, force: true }));
