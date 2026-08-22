#!/usr/bin/env python3
"""跨文件 Python 调用链分析（供 /api/code-read 调用，只读不执行）。

用法：
  python3 py_chain.py <root_dir> <relative_file.py>

输出到 stdout 的 JSON：
  {
    "file": "<relative_file.py>",
    "functions": ["当前文件定义的函数"],
    "imports": [ {"module": "x", "names": ["a","b"], "is_local": true} ],
    "callees_outside": [ {"name": "...", "defined_in": "other.py", "line": 123} ],  # 调用了外部（其他文件）定义的函数
    "callers": [ {"name": "...", "caller_file": "calling.py", "caller_func": "fn"} ] # 谁调用了当前文件定义的函数
  }
解析以函数名做近似匹配（同名视为同目标），对 THIS 项目（非同名重载）够用且不误报。
"""
import ast, json, os, sys

def collect(files):
    """files: {rel_path: abs_path}"""
    funcs = {}  # name -> list of (rel_path, lineno, qualified)
    imports = {}  # rel_path -> list of (module, names)
    calls = {}  # rel_path -> set of called attribute/name ids
    defs = {}  # rel_path -> {func: lineno}
    for rel, abs_ in files.items():
        try:
            src = open(abs_, encoding="utf-8", errors="ignore").read()
            tree = ast.parse(src)
        except Exception:
            continue
        imports[rel] = []
        calls[rel] = set()
        defs[rel] = {}
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                funcs.setdefault(node.name, []).append((rel, node.lineno))
                defs[rel][node.name] = node.lineno
            elif isinstance(node, ast.Import):
                imports[rel].append(("", [a.name for a in node.names]))
            elif isinstance(node, ast.ImportFrom):
                imports[rel].append((node.module or "", [a.name for a in node.names]))
            elif isinstance(node, ast.Call):
                fn = node.func
                if isinstance(fn, ast.Name):
                    calls[rel].add(fn.id)
                elif isinstance(fn, ast.Attribute):
                    calls[rel].add(fn.attr)
    return funcs, imports, calls, defs

def is_local_import(mod, names, defined):
    # 本地 import：module 或 imported name 恰好是某个本地文件模块名
    cand = mod.split(".")[0]
    if cand in defined or mod in defined:
        return True
    if any(n for n in names if n in defined):
        return True
    return False

def main():
    root, relfile = sys.argv[1], sys.argv[2]
    files = {}
    for dirpath, _, names in os.walk(root):
        if "__pycache__" in dirpath or ".git" in dirpath:
            continue
        for n in names:
            if n.endswith(".py"):
                abs_ = os.path.join(dirpath, n)
                rel = os.path.relpath(abs_, root).replace(os.sep, "/")
                files[rel] = abs_
    if relfile not in files:
        print(json.dumps({"error": "file not in root"}))
        return

    defined = set()
    for k in files:
        stem = k.rstrip(".py").replace("/", ".")
        defined.add(stem)
        defined.add(stem.rsplit(".", 1)[-1])

    funcs, imports, calls, defs = collect(files)
    cur_imports = [{"module": m, "names": ns, "is_local": is_local_import(m, ns, defined)} for m, ns in imports.get(relfile, [])]
    cur_funcs = defs.get(relfile, {})

    # callees_outside：当前文件调用、但定义在其他文件的函数
    callees = []
    for name in sorted(calls.get(relfile, [])):
        targets = funcs.get(name, [])
        outside = [t for t in targets if t[0] != relfile]
        if outside:
            # 取第一个外部定义（近似）
            orel, oline = outside[0]
            callees.append({"name": name, "defined_in": orel, "line": oline})

    # callers：谁调用了当前文件里的函数
    caller_map = {}
    for other_rel, other_calls in calls.items():
        if other_rel == relfile:
            continue
        for name in other_calls:
            if name in cur_funcs:
                caller_map.setdefault(name, []).append(other_rel)
    callers = [{"name": name, "caller_files": sorted(set(fs))} for name, fs in sorted(caller_map.items())]

    print(json.dumps({
        "file": relfile,
        "functions": list(cur_funcs.keys()),
        "imports": cur_imports,
        "callees_outside": callees,
        "callers": callers,
    }))

if __name__ == "__main__":
    main()
