import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const SANDBOX = mkdtempSync(path.join(tmpdir(), "ra-api-sync-"));
process.env.RA_DATA_DIR = SANDBOX;
mkdirSync(path.join(SANDBOX, "learning"), { recursive: true });
writeFileSync(path.join(SANDBOX, "projects.json"), JSON.stringify({
  schema: 1,
  projects: [{ id: "seed-1", title: "种子项目", executionSessions: [] }],
  groups: [],
}), "utf8");

const { POST } = await import("../src/app/api/sync/route.ts");

function post(body) {
  return POST(new Request("http://localhost/api/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

test("POST 失败路径：非 JSON 请求体返回 400", async () => {
  const res = await POST(new Request("http://localhost/api/sync", { method: "POST", body: "not json" }));
  assert.equal(res.status, 400);
});

test("POST 失败路径：缺 projectId 返回 400", async () => {
  const res = await post({ action: "collect" });
  assert.equal(res.status, 400);
});

test("POST 失败路径：项目不存在返回 404", async () => {
  const res = await post({ projectId: "no-such", action: "collect" });
  assert.equal(res.status, 404);
});

test("POST collect 正常路径：无会话项目返回空 pending 并落盘", async () => {
  const res = await post({ projectId: "seed-1", action: "collect" });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.pending.projectId, "seed-1");
  assert.equal(data.pending.hasEvidence, false);
  assert.deepEqual(data.pending.evidence.conversations, []);
  // collect 会把 pending 持久化到 sync/<projectId>.json
  const pendingFile = path.join(SANDBOX, "sync-pending", "seed-1.json");
  assert.ok(existsSync(pendingFile), "pending 应落盘");
  const saved = JSON.parse(readFileSync(pendingFile, "utf8"));
  assert.equal(saved.projectId, "seed-1");
});

test("POST rebuildHistory 失败路径：无绑定会话返回 400", async () => {
  const res = await post({ projectId: "seed-1", action: "rebuildHistory" });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.ok(data.error.includes("绑定会话"));
});

test("POST explain 失败路径：无待讲解内容返回 400", async () => {
  const res = await post({ projectId: "seed-1", action: "explain" });
  assert.equal(res.status, 400);
});

test("POST refreshState 失败路径：无可用的同步记录返回 400", async () => {
  const res = await post({ projectId: "seed-1", action: "refreshState" });
  assert.equal(res.status, 400);
});

test("POST 未知 action 返回 400", async () => {
  const res = await post({ projectId: "seed-1", action: "nonsense" });
  assert.equal(res.status, 400);
});

test.after(() => rmSync(SANDBOX, { recursive: true, force: true }));
