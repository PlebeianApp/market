#!/usr/bin/env python3
"""
The machine part of the check routine — see checks/checks.md.

No dependencies, no configuration, no state: run it from the repository root.

    python3 checks/check.py            verify the tree, print a short report
    python3 checks/check.py --assign   fill identities for statements written with a #@ placeholder

It is deliberately a report, not a gate: it exits non-zero only for the findings that are hard
(identity mismatch, dangling reference, unaccounted file, graph violation). Everything else is a note.
Nobody should ever type a hash by hand — that is what --assign is for.
"""
import os, re, sys, hashlib, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if "--root" in sys.argv:
    ROOT = os.path.abspath(sys.argv[sys.argv.index("--root") + 1])
DECL = re.compile(r"^(\s*(?:#{2,4}\s+|-\s+|\*\s+)?)(`?#[0-9a-f]{6}`?|`?#@`?)(\s*)(?:[—–]\s*)?(.*)$")
IDREF = re.compile(r"#[0-9a-f]{6}\b")
SKIP_TRANSCRIPTS = re.compile(r"sessions/2026-09-23-session-\d+\.md$")
SKIP_DIRS = {".git", "node_modules", "dist", "build", "coverage", "vendor", ".venv", "__pycache__", ".next"}


def norm(text):
    return " ".join(text.split())


def content_for_hash(content):
    """The documented normalisation: trim, collapse whitespace, neutralise citations."""
    return norm(IDREF.sub("#REF", content))


def identity(content):
    return "#" + hashlib.sha256(content_for_hash(content).encode()).hexdigest()[:6]


def mounted_specimens():
    """A top-level directory that is a submodule is a **mount**; its statements are not this project's.

    `core` is the exception: it is the method, it roots the module graph, and statements in this tree cite its
    rules, so its own MDs must be read. Every other mount is the specimen — it is pinned, read-only, and its
    prose belongs to its own repository. Without this, a specimen's documentation is checked against the
    method: a relay-architecture diagram full of `#22c55e` and a styling reference full of `#ffffff` produced
    39 *dangling reference* findings on `PlebeianApp/market`, and a bulleted colour in a spec would have been
    reported as an identity mismatch. Vendored trees were skipped for exactly this reason; a specimen mount is
    the same problem with a different name.
    """
    out, root = set(), ROOT
    for name in sorted(os.listdir(root)):
        d = os.path.join(root, name)
        if name == "core":
            continue
        if os.path.isdir(d) and os.path.isfile(os.path.join(d, ".git")):
            out.add(name)
    return out


def md_files():
    out = []
    mounts = mounted_specimens()
    for dp, dn, fn in os.walk(ROOT):
        dn[:] = [d for d in dn if d not in SKIP_DIRS]
        if os.path.relpath(dp, ROOT).split(os.sep)[0] in mounts:
            continue
        for f in sorted(fn):
            if f.endswith(".md"):
                out.append(os.path.relpath(os.path.join(dp, f), ROOT))
    return sorted(out)


def front_matter(path):
    """Parse the leading YAML block, flat keys only — enough for module, kind, inherits, implements."""
    text = open(os.path.join(ROOT, path)).read()
    if not text.startswith("---"):
        return None, text
    end = text.find("\n---", 3)
    if end < 0:
        return None, text
    fm = {}
    for line in text[3:end].splitlines():
        if ":" not in line or line.strip().startswith("#"):
            continue
        k, v = line.split(":", 1)
        fm[k.strip()] = v.split("#")[0].strip()
    return fm, text[end + 4:]


def modules():
    """module name -> dict(path, inherits, implements) for every module MD at the repo root."""
    mods = {}
    for name in sorted(os.listdir(ROOT)):
        d = os.path.join(ROOT, name)
        md = os.path.join(d, name + ".md")
        if os.path.isdir(d) and os.path.isfile(md):
            fm, _ = front_matter(os.path.join(name, name + ".md"))
            if not fm:
                continue
            inh = [x.strip() for x in fm.get("inherits", "[]").strip("[]").split(",") if x.strip()]
            imp = [x.strip().strip('"') for x in fm.get("implements", "[]").strip("[]").split(",") if x.strip()]
            mods[name] = {"path": os.path.join(name, name + ".md"), "inherits": inh, "implements": imp,
                          "submodule": os.path.isfile(os.path.join(d, ".git"))}
    # a repository's own core.md is the root of its graph; a project discovers core as a mounted module
    if os.path.isfile(os.path.join(ROOT, "core.md")):
        mods["core"] = {"path": "core.md", "inherits": [], "implements": [], "submodule": False}
    return mods


def declarations():
    """identity -> (module, content); and a list of (path, lineno, identity, content) in file order.

    Two passes, because a line can **cite** an identity or **declare** one and the two look alike: a
    statement's identity is the hash of the line that declares it, so the line whose own content hashes to the
    stated identity is the declaration, and any other line opening with that identity is prose citing it.
    Without this, every citation that begins a line rewrites the identity of the line it opens, and the
    citation is reported as a mismatch inside a line that never declared anything.
    """
    cand = []
    for path in md_files():
        if SKIP_TRANSCRIPTS.search(path):
            continue
        mod = path.split(os.sep)[0] if os.sep in path else "core"
        lines = open(os.path.join(ROOT, path)).read().split("\n")
        for i, line in enumerate(lines, 1):
            m = DECL.match(line)
            if not m or m.group(2) in ("#@", "`#@`"):
                continue
            # a declaring line is a heading, a bullet, or a paragraph of its own — never a wrapped
            # continuation of the sentence above it (that is how a false statement gets manufactured)
            own_paragraph = (i == 1) or (lines[i - 2].strip() == "")
            if not (m.group(1).strip().startswith(("#", "-", "*")) or own_paragraph):
                continue
            ident, content = m.group(2).strip("`"), m.group(4)
            cand.append((path, i, ident, content, identity(content), mod))

    # the line that owns an identity is the one whose content hashes to it; anyone else opening with that
    # identity is citing it. A stale declaration — edited content, hash no longer matching — has no owner
    # and is therefore still reported as a mismatch, which is the rename signal this method depends on.
    owner = {c[2]: c for c in cand if c[4] == c[2]}

    decls, order = {}, []
    for path, i, ident, content, own, mod in cand:
        if own != ident and ident in owner:
            continue
        decls.setdefault(ident, (mod, content))
        order.append((path, i, ident, content))
    return decls, order


def assign(decls):
    """Fill every #@ placeholder with the identity derived from its own line."""
    filled = 0
    for path in md_files():
        p = os.path.join(ROOT, path)
        lines = open(p).read().split("\n")
        changed = False
        for i, line in enumerate(lines):
            m = DECL.match(line)
            if m and m.group(2) in ("#@", "`#@`"):
                h = identity(m.group(4))
                lines[i] = line.replace(m.group(2), "`%s`" % h if m.group(2).startswith("`") else h, 1)
                changed, filled = True, filled + 1
        if changed:
            open(p, "w").write("\n".join(lines))
    return filled


def ancestors(mod, mods):
    seen, stack = set(), list(mods.get(mod, {}).get("inherits", []))
    while stack:
        x = stack.pop()
        if x in seen:
            continue
        seen.add(x)
        stack.extend(mods.get(x, {}).get("inherits", []))
    return seen | {"core"}


def main():
    mods = modules()
    if "--assign" in sys.argv:
        n = assign(declarations()[0])
        print(f"assigned {n} identities")
    decls, order = declarations()

    hard, notes = [], []

    # 1. identity verification
    for path, i, ident, content in order:
        if identity(content) != ident:
            hard.append(f"identity mismatch  {path}:{i}  says {ident}, recomputes to {identity(content)}")

    # 2. dangling references
    for path in md_files():
        if SKIP_TRANSCRIPTS.search(path):
            continue
        for i, line in enumerate(open(os.path.join(ROOT, path)).read().split("\n"), 1):
            m = DECL.match(line)
            own = m.group(2).strip("`") if m else None
            for tok in IDREF.findall(line):
                if tok != own and tok not in decls:
                    hard.append(f"dangling reference {path}:{i}  {tok} resolves to nothing")

    # 3. accounting
    for name, info in mods.items():
        if name == "core":
            continue
        d = os.path.join(ROOT, name)
        text = open(os.path.join(ROOT, info["path"])).read()
        for entry in sorted(os.listdir(d)):
            if entry in (".git",) or entry == name + ".md":
                continue
            # what tooling creates is not accounted for by the MD, and must not be: a dependency store, a
            # build output. A symlinked `node_modules` is how a module reaches its dependencies — a link, not
            # a file this project owns, and it is git-ignored for the same reason.
            if entry in SKIP_DIRS or os.path.islink(os.path.join(d, entry)):
                continue
            if info["submodule"] and os.path.isfile(os.path.join(d, ".git")):
                if name not in text:
                    hard.append(f"unaccounted  {name}/ is a submodule and is not mentioned in {info['path']}")
                continue
            if entry not in text:
                hard.append(f"unaccounted  {name}/{entry} is not referenced by {info['path']}")

    # 4. the module graph
    for name, info in mods.items():
        for parent in info["inherits"]:
            if parent not in mods:
                hard.append(f"graph  {name} inherits {parent}, which is not a module")
    roots = [n for n, i in mods.items() if not i["inherits"]]
    if roots != ["core"]:
        hard.append(f"graph  expected exactly one root (core), found {sorted(roots)}")
    for name in mods:
        seen, stack = set(), [name]
        while stack:
            x = stack.pop()
            for p in mods.get(x, {}).get("inherits", []):
                if p == name:
                    hard.append(f"graph  cycle through {name}")
                    stack = []
                    break
                if p not in seen:
                    seen.add(p); stack.append(p)

    # 5. a statement may cite only itself, an ancestor, or core
    for path, i, ident, content in order:
        mod = path.split(os.sep)[0] if os.sep in path else "core"
        if mod not in mods:
            continue
        allowed = ancestors(mod, mods) | {mod}
        for tok in IDREF.findall(content):
            target = decls.get(tok, (None, None))[0]
            if target and target not in allowed:
                hard.append(f"graph  {path}:{i} cites {tok} from {target}, which is not above {mod}")

    # 6. implements must point at core rules or an ancestor's statements
    for name, info in mods.items():
        if name == "core":
            continue
        allowed = ancestors(name, mods)
        for tok in info["implements"]:
            target = decls.get(tok, (None, None))[0]
            if target and target not in allowed:
                hard.append(f"graph  {name} implements {tok} from {target}, which is not above it")

    # 7. duplicate identities are a merge signal, never an error
    by_ident = collections.defaultdict(set)
    for path, i, ident, content in order:
        by_ident[ident].add(path.split(os.sep)[0] if os.sep in path else "core")
    for ident, where in by_ident.items():
        if len(where) > 1:
            notes.append(f"merge signal  {ident} appears in {', '.join(sorted(where))}")

    print(f"modules {len(mods)} · statements {len(order)} · distinct identities {len(decls)}")
    for x in hard:
        print("  HARD  " + x)
    for x in notes:
        print("  note  " + x)
    print(f"{len(hard)} hard finding(s), {len(notes)} note(s)")
    return 1 if hard else 0


if __name__ == "__main__":
    sys.exit(main())
