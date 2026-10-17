/**
 * 旧手工回归脚本（tests/legacy/*.mjs）的 node:test 收口：
 * 每个脚本作为子进程运行（自带 pass/fail 汇总与 exit code），
 * RA_DATA_DIR 指向临时沙箱，互不污染、不碰真实 data/。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readdirSync } from "node:fs";

const legacyDir = path.join(import.meta.dirname, "legacy");
const scripts = readdirSync(legacyDir).filter((f) => f.endsWith(".mjs")).sort();

assert.ok(scripts.length >= 10, "tests/legacy 至少应有 10 个脚本");

for (const name of scripts) {
  test("legacy: " + name, { timeout: 120_000 }, () => {
    const sandbox = mkdtempSync(path.join(tmpdir(), "ra-legacy-"));
    try {
      const res = spawnSync(process.execPath, ["--experimental-strip-types", path.join(legacyDir, name)], {
        env: { ...process.env, RA_DATA_DIR: sandbox, RA_CONCEPT_MOCK: process.env.RA_CONCEPT_MOCK ?? "" },
        encoding: "utf8",
        timeout: 110_000,
      });
      if (res.status !== 0) {
        assert.fail(`退出码 ${res.status}\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
      }
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
}
