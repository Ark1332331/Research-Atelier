/**
 * node:test 的 @/ 别名解析 loader：
 * 路由与 lib 用 "@/lib/x" 导入，node --experimental-strip-types 不认识别名。
 * 用法：node --import ./tests/helpers/alias-hooks.mjs --test tests/api-*.test.mjs
 */
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const SRC = path.resolve(import.meta.dirname, "..", "..", "src");

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
    const base = path.join(SRC, specifier.slice(2));
    for (const candidate of [base, base + ".ts", base + ".tsx", path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
      if (existsSync(candidate)) {
        return { url: pathToFileURL(candidate).href, shortCircuit: true, format: "module-typescript" };
      }
    }
    return nextResolve(specifier, context);
  },
});
