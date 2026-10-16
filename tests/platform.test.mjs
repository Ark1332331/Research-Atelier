import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { which, resolvePython, resolveConda, resolveSqlite, systemInfo } from "../src/lib/platform.ts";
import { DATA_DIR } from "../src/lib/store.ts";

test("which: 不存在的命令返回 null", () => {
  assert.equal(which("definitely-not-a-real-cmd-xyz-12345"), null);
});

test("which: 存在的命令能找到（Windows 用 where，POSIX 用 which）", () => {
  const known = process.platform === "win32" ? "where" : "sh";
  assert.ok(which(known), `应能找到 ${known}`);
});

test("resolvePython: 返回 null 或 {cmd, args}", () => {
  const py = resolvePython();
  if (py) {
    assert.ok(typeof py.cmd === "string" && py.cmd.length > 0);
    assert.ok(Array.isArray(py.args));
  }
});

test("resolveConda/resolveSqlite: 探测不抛异常，返回 string|null", () => {
  assert.ok(resolveConda() === null || typeof resolveConda() === "string");
  assert.ok(resolveSqlite() === null || typeof resolveSqlite() === "string");
});

test("systemInfo: 返回非空 os/arch/kernel，全平台无异常", () => {
  const info = systemInfo();
  assert.ok(info.os.length > 0);
  assert.ok(info.arch.length > 0);
  assert.ok(info.kernel.length > 0);
});

test("store DATA_DIR: Windows 落 %APPDATA%，不再走 ~/.config", () => {
  if (process.platform === "win32") {
    const expected = path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "Research Atelier", "data");
    assert.equal(DATA_DIR, expected);
    assert.ok(!DATA_DIR.includes(".config"));
  } else {
    assert.ok(DATA_DIR.includes("Research Atelier"));
  }
});
