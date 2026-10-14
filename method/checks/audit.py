#!/usr/bin/env python3
"""
The mechanical audit for a retrofit — see modularization.md.

    python3 audit.py <path-to-repo> [--top N] [--json]

It measures, and only measures: size and shape per directory, the internal import graph, fan-in and
fan-out, cycles (strongly connected components), and orphans. It makes no claim about where the seams
should be — that is the judgement the map has to make, against the placement rule.

No dependencies. Understands relative ES imports and requires, and resolves `compilerOptions.paths` aliases
from tsconfig/jsconfig; when it still cannot place a specifier it says so under `unresolved relative imports`
rather than counting it as external. Only relative imports and aliases are resolved — a package specifier
(`react`, `@/…` with no alias found) is external by definition, not a missing file.
"""
import os, re, sys, json, collections

SKIP_DIRS = {".git", "node_modules", "dist", "build", ".next", "coverage", "vendor", ".venv", "__pycache__"}
SRC_EXT = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte"}
IMPORT_RE = re.compile(
    r"""(?:from\s+['"]([^'"]+)['"])"""
    r"""|(?:import\s*\(\s*['"]([^'"]+)['"]\s*\))"""
    r"""|(?:require\(\s*['"]([^'"]+)['"]\s*\))"""
    r"""|(?:^\s*import\s+['"]([^'"]+)['"])"""          # side-effect import — invisible before this fix
    r"""|(?:^\s*export\s+\*?\s*(?:\{[^}]*\}\s*)?from\s+['"]([^'"]+)['"])""",
    re.M)


def walk(root):
    files = []
    for dp, dn, fn in os.walk(root):
        dn[:] = [d for d in dn if d not in SKIP_DIRS]
        for f in fn:
            if os.path.splitext(f)[1] in SRC_EXT:
                files.append(os.path.relpath(os.path.join(dp, f), root))
    return sorted(files)


def line_count(path):
    try:
        return sum(1 for _ in open(path, errors="ignore"))
    except OSError:
        return 0


def load_aliases(root):
    """Read path aliases from tsconfig/jsconfig (compilerOptions.paths). Without these, an `@/`-style
    import looks external and the internal graph comes back empty."""
    import json
    aliases = {}
    for name in ("tsconfig.json", "tsconfig.app.json", "tsconfig.base.json", "jsconfig.json"):
        p = os.path.join(root, name)
        if not os.path.isfile(p):
            continue
        try:
            raw = open(p, errors="ignore").read()
        except OSError:
            continue
        # A tsconfig is *almost* JSON. Parse it as-is first — the cleaning below is only for the files that
        # really carry comments or trailing commas. Cleaning first is what broke this: the DOTALL block-comment
        # pattern matches from `"@/*"` to the `*/` inside a later `"**/*.ts"`, so it deleted the whole `paths`
        # block and an `@/`-heavy repo reported `aliases: {}` — the graph came back measured and wrong.
        try:
            cfg = json.loads(raw)
        except Exception:
            raw = re.sub(r"(?:^|(?<=\s))/\*.*?\*/", "", raw, flags=re.S)   # block comments, never inside a string
            raw = re.sub(r"^\s*//.*$", "", raw, flags=re.M)                # line comments
            raw = re.sub(r",(\s*[}\]])", r"\1", raw)                       # trailing commas
            try:
                cfg = json.loads(raw)
            except Exception:
                continue
        co = cfg.get("compilerOptions", {}) or {}
        base = co.get("baseUrl", ".") or "."
        for k, v in (co.get("paths") or {}).items():
            tgt = (v[0] if isinstance(v, list) and v else "")
            key, t = k.split("*")[0], tgt.split("*")[0]
            if key and t:
                aliases[key] = os.path.normpath(os.path.join(base, t))
    return aliases


def resolve(root, src, spec, aliases=None):
    """Resolve a relative import specifier to a file in the tree, or None if it is external/aliased."""
    if spec.startswith("."):
        base = os.path.normpath(os.path.join(os.path.dirname(src), spec))
    else:
        base = None
        for key, target in (aliases or {}).items():
            if spec.startswith(key):
                base = os.path.normpath(os.path.join(target, spec[len(key):]))
                break
        if base is None:
            return None
    for cand in (base, base + ".ts", base + ".tsx", base + ".js", base + ".jsx",
                 os.path.join(base, "index.ts"), os.path.join(base, "index.tsx"), os.path.join(base, "index.js")):
        if os.path.isfile(os.path.join(root, cand)):
            return cand
    return None


def analyse(root, top=15):
    files = walk(root)
    aliases = load_aliases(root)
    imports = collections.defaultdict(set)      # file -> files it imports
    imported_by = collections.defaultdict(set)
    external = collections.Counter()
    aliased = set()
    per_dir = collections.defaultdict(lambda: {"files": 0, "lines": 0})
    sizes = []

    for f in files:
        p = os.path.join(root, f)
        d = os.path.dirname(f) or "."
        n = line_count(p)
        per_dir[d]["files"] += 1
        per_dir[d]["lines"] += n
        sizes.append((n, f))
        try:
            text = open(p, errors="ignore").read()
        except OSError:
            continue
        for m in IMPORT_RE.finditer(text):
            spec = next((g for g in m.groups() if g), None)
            if not spec:
                continue
            target = resolve(root, f, spec, aliases)
            if target:
                imports[f].add(target); imported_by[target].add(f)
            elif not spec.startswith("."):
                ext = spec.split("/")[0]
                if spec.startswith("@") and "/" in spec:
                    ext = "/".join(spec.split("/")[:2])
                external[ext] += 1
            else:
                aliased.add(spec)

    # cycles: strongly connected components with >1 member (iterative Tarjan)
    index, low, on_stack, stack, counter, sccs = {}, {}, set(), [], [0], []
    for start in files:
        if start in index:
            continue
        work = [(start, iter(sorted(imports[start])))]
        index[start] = low[start] = counter[0]; counter[0] += 1
        stack.append(start); on_stack.add(start)
        while work:
            node, it = work[-1]
            advanced = False
            for nxt in it:
                if nxt not in index:
                    index[nxt] = low[nxt] = counter[0]; counter[0] += 1
                    stack.append(nxt); on_stack.add(nxt)
                    work.append((nxt, iter(sorted(imports[nxt]))))
                    advanced = True
                    break
                if nxt in on_stack:
                    low[node] = min(low[node], index[nxt])
            if advanced:
                continue
            work.pop()
            if work:
                parent = work[-1][0]
                low[parent] = min(low[parent], low[node])
            if low[node] == index[node]:
                comp = []
                while True:
                    w = stack.pop(); on_stack.discard(w); comp.append(w)
                    if w == node:
                        break
                if len(comp) > 1:
                    sccs.append(sorted(comp))

    # directory-level edges
    dir_edges = collections.Counter()
    for f, targets in imports.items():
        a = os.path.dirname(f) or "."
        for t in targets:
            b = os.path.dirname(t) or "."
            if a != b:
                dir_edges[(a, b)] += 1

    orphans = sorted(f for f in files if not imported_by.get(f))

    return {
        "root": root, "files": len(files), "lines": sum(n for n, _ in sizes), "aliases": aliases,
        "per_dir": {k: v for k, v in sorted(per_dir.items(), key=lambda kv: -kv[1]["lines"])},
        "largest": sorted(sizes, reverse=True)[:top],
        "fan_in": sorted(((len(v), k) for k, v in imported_by.items()), reverse=True)[:top],
        "fan_out": sorted(((len(v), k) for k, v in imports.items()), reverse=True)[:top],
        "cycles": sccs[:top],
        "orphans": orphans[:top],
        "dir_edges": sorted(((a, b, n) for (a, b), n in dir_edges.items()), key=lambda x: -x[2])[:top],
        "external_deps": external.most_common(top),
        "unresolved_relative": sorted(aliased)[:top],
    }


def render(a):
    out = [f"# audit — {a['root']}", "",
           f"{a['files']} source files, {a['lines']} lines.", ""]
    out += ["## shape per directory", ""]
    for d, v in list(a["per_dir"].items())[:20]:
        out.append(f"- {d} — {v['files']} files, {v['lines']} lines")
    out += ["", "## largest files", ""]
    for n, f in a["largest"]:
        out.append(f"- {n:6}  {f}")
    out += ["", "## most depended-on (fan-in) — candidate contracts", ""]
    for n, f in a["fan_in"]:
        out.append(f"- {n:4} dependents  {f}")
    out += ["", "## most dependencies (fan-out) — candidate assemblers", ""]
    for n, f in a["fan_out"]:
        out.append(f"- {n:4} imports  {f}")
    out += ["", "## cycles — no clean seam exists here yet", ""]
    if a["cycles"]:
        for comp in a["cycles"]:
            out.append(f"- {len(comp)} files: " + ", ".join(comp[:6]) + (" …" if len(comp) > 6 else ""))
    else:
        out.append("- none")
    out += ["", "## directory edges (top)", ""]
    for x, y, n in a["dir_edges"]:
        out.append(f"- {x}  ->  {y}   ({n})")
    out += ["", "## path aliases resolved from tsconfig/jsconfig", ""]
    out.append("- " + (", ".join(f"{k} -> {v}" for k, v in a["aliases"].items()) or "none found"))
    out += ["", "## external dependencies (top)", ""]
    for k, n in a["external_deps"]:
        out.append(f"- {k}  ({n} imports)")
    out += ["", "## orphans — nothing in the tree imports them", ""]
    for f in a["orphans"]:
        out.append(f"- {f}")
    if a["unresolved_relative"]:
        out += ["", "## unresolved relative imports (aliases this script does not resolve)", ""]
        for s in a["unresolved_relative"]:
            out.append(f"- {s}")
    out += ["", "_This is a measurement. Where the seams should be is a decision, not a measurement._"]
    return "\n".join(out)


if __name__ == "__main__":
    args = [x for x in sys.argv[1:] if not x.startswith("--")]
    if not args:
        print((__doc__ or "").strip()); sys.exit(2)
    root = os.path.abspath(args[0])
    top = 15
    if "--top" in sys.argv:
        top = int(sys.argv[sys.argv.index("--top") + 1])
    data = analyse(root, top)
    print(json.dumps(data, indent=2) if "--json" in sys.argv else render(data))