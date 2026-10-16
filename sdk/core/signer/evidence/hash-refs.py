#!/usr/bin/env python3
"""
signer/evidence/hash-refs.py — the module-local spec<->implementation cross-reference verifier.

The convention (runs/2026-10-02-content-addressing/DIRECTION.md 2.1): an implementation source file
carries the identity of the spec statement it fulfils as a token, `#` + six hex digits, in the doc
comment directly above the declaration. A statement's identity is minted by core/checks/check.py:
sha256(normalized declaring-line text)[:6]. This verifier never mints an identity; it only resolves
the tokens the code already carries against the tokens the specs declare, and it reports the two
citation classes the hardened rules distinguish.

It **prints**; the caller redirects (core/checks/evidence.py `#31115e`: an evidence script prints and
never writes into the tree):

    python3 -B signer/evidence/hash-refs.py > signer/evidence/04-hash-refs.txt

    (a) the declared set is every line-start token in signer/signer.md and signer/ts/ts.md — a token
        that begins a line, optionally after a markdown bullet or heading (so a *citation* embedded
        mid-line is not a declaration);
    (b) the code set is every six-hex token appearing anywhere in signer/ts/**/*.ts
        (node_modules excluded);
    (c) every code token must resolve: to a statement this module declares, or to one of the module's
        ancestors (check.py permits a statement to cite itself, an ancestor, or core — a token may
        therefore legitimately resolve upward). Each resolved token is printed with its declaration
        text and its citation class: a token followed by the marker `(provenance)` on the same line is
        a **provenance** citation (R2 — a historical/meta or negative statement is never fulfilment);
        a token with no marker is a **fulfilment** claim (the marker is written immediately after the
        token, `#hexid (provenance)`);
    (d) every top-level exported declaration in the module's TypeScript that carries no token is listed
        — except the module's declared `test-support:` files (R3), whose declarations need no statement
        and are listed as exempt rather than as a question;
    (e) every file under signer/ named by neither spec is listed, with the same accounting exclusions
        core/checks/check.py applies: build noise and the dependency store, toolchain scaffolding (a
        lockfile, a manifest, a compiler config), the evidence captures and the project-owned accounting
        baseline (a baseline that only shrinks).

Exit status is non-zero if any code token is unresolved. It exits 0 when every token resolves, even
when the uncovered lists are non-empty: an uncovered declaration is a question, not a broken link.
"""
import fnmatch
import os
import re
import sys

MODULE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.dirname(MODULE)
MODULE_NAME = os.path.basename(MODULE)
TS = os.path.join(MODULE, "ts")

SPEC_FILES = [
    os.path.join(MODULE, MODULE_NAME + ".md"),
    os.path.join(MODULE, "ts", "ts.md"),
]

IDREF = re.compile(r"#[0-9a-f]{6}\b")
# A token that *begins* a line, optionally after a markdown heading (###), a bullet (- * +), a bold span
# (**) or a backtick. Anything else on the line is a citation, not a declaration.
DECL = re.compile(r"^\s*(?:#{1,6}\s+|[-*+]\s+)?(?:\*\*)?`?(#[0-9a-f]{6})`?")
FRONT_INHERITS = re.compile(r"^inherits:\s*\[(.*?)\]", re.M)
# R3 — the module's own declaration that a file is test support: exempt like a mount.
FRONT_TEST_SUPPORT = re.compile(r"^test-support:\s*\[(.*?)\]", re.M)

# The accounting exclusions core/checks/check.py applies, so (e) reports the same set the routine does.
SKIP_DIRS = {".git", "node_modules", "dist", "build", "coverage", "vendor", ".venv", "__pycache__", ".next"}
TOOLING_FILES = {
    "bun.lock", "bun.lockb", "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "go.sum", "flake.lock",
    "Cargo.lock", "package.json", "tsconfig.json", "jsconfig.json", "go.mod", "Cargo.toml", ".gitignore",
}
BASELINE = "accounting-baseline.txt"

EXPORT_NAMED = re.compile(
    r"^export\s+(?:async\s+)?(?:function|class|interface|type|const|let|var|enum)\s+([A-Za-z_$][\w$]*)"
)
EXPORT_OPEN = re.compile(r"^export\s+(?:type\s+)?\{")
FROM_SPECIFIER = re.compile(r"from\s*['\"]([^'\"]+)['\"]")


def module_md(name):
    return os.path.join(ROOT, name, name + ".md")


def module_front_matter(name):
    path = module_md(name)
    if not os.path.isfile(path):
        return ""
    text = open(path, encoding="utf-8").read()
    if not text.startswith("---"):
        return ""
    end = text.find("\n---", 3)
    return text[3:end] if end >= 0 else ""


def test_support_globs():
    """R3 — the file patterns the module's own front-matter declares exempt."""
    match = FRONT_TEST_SUPPORT.search(module_front_matter(MODULE_NAME))
    if not match:
        return []
    return [p.strip().strip('"').strip("'") for p in match.group(1).split(",") if p.strip()]


def is_exempt(rel_to_module):
    """Is this module-relative path declared test support?"""
    return any(fnmatch.fnmatch(rel_to_module, g) or fnmatch.fnmatch(os.path.basename(rel_to_module), g)
               for g in test_support_globs())


def ancestors():
    """The module's ancestors, as check.py computes them: the closure of `inherits`, plus core."""
    mods = {}
    for entry in sorted(os.listdir(ROOT)):
        md = module_md(entry)
        if os.path.isfile(md):
            text = open(md, encoding="utf-8").read()
            match = FRONT_INHERITS.search(text)
            mods[entry] = [p.strip().strip('"') for p in match.group(1).split(",") if p.strip()] if match else []
    seen, stack = set(), list(mods.get(MODULE_NAME, []))
    while stack:
        name = stack.pop()
        if name in seen:
            continue
        seen.add(name)
        stack.extend(mods.get(name, []))
    return seen | {"core"}


def declared_set():
    """(a) token -> (source label, declaration text), from the two specs and the ancestors' specs.

    A declaring line is one where the token begins the line after an optional markdown bullet or heading,
    or where it opens its own paragraph (the previous line is blank) — the same rule core/checks/check.py
    uses, so a token that merely continues the sentence above it (a citation) is not a declaration.
    """
    declared = {}

    def scan(path, label):
        lines = open(path, encoding="utf-8").read().split("\n")
        for index, line in enumerate(lines):
            match = DECL.match(line)
            if not match:
                continue
            marker = line.lstrip()[:1] in ("#", "-", "*", "+")
            own_paragraph = index == 0 or lines[index - 1].strip() == ""
            if not (marker or own_paragraph):
                continue
            token = match.group(1)
            text = line[match.end():].lstrip("`—–- \t").rstrip()
            if token not in declared:
                declared[token] = (label, text)

    for path in SPEC_FILES:
        if not os.path.isfile(path):
            sys.exit("missing spec: %s" % path)
        scan(path, os.path.relpath(path, ROOT))
    for name in sorted(ancestors()):
        path = module_md(name)
        if os.path.isfile(path):
            scan(path, os.path.relpath(path, ROOT) + " (ancestor)")
    return declared


def code_uses():
    """(b) token -> list of (file:line, provenance_bool) where it appears in signer/ts/**/*.ts."""
    uses = {}
    for base, dirs, files in os.walk(TS):
        dirs[:] = [d for d in dirs if d != "node_modules"]
        for name in sorted(files):
            if not name.endswith(".ts"):
                continue
            path = os.path.join(base, name)
            rel = os.path.relpath(path, ROOT)
            for number, line in enumerate(open(path, encoding="utf-8").read().split("\n"), 1):
                for token in IDREF.findall(line):
                    is_prov = re.search(re.escape(token) + r"\s+\(provenance\)", line) is not None
                    uses.setdefault(token, []).append(("%s:%d" % (rel, number), is_prov))
    return uses


def comment_above(lines, index):
    """The contiguous comment block immediately above lines[index] (0-based), as a list of lines."""
    block = []
    cursor = index - 1
    while cursor >= 0 and lines[cursor].strip() != "":
        stripped = lines[cursor].strip()
        if stripped.startswith("*") or stripped.startswith("/*") or stripped.endswith("*/"):
            block.append(lines[cursor])
            cursor -= 1
            continue
        break
    return list(reversed(block))


def exported_declarations():
    """(d) [(file, name, covered, exempt)] for every top-level exported declaration in the sources."""
    found = []
    for base, dirs, files in os.walk(TS):
        dirs[:] = [d for d in dirs if d != "node_modules"]
        for name in sorted(files):
            if not name.endswith(".ts"):
                continue
            path = os.path.join(base, name)
            rel = os.path.relpath(path, ROOT)
            rel_to_module = os.path.relpath(path, MODULE)
            exempt = is_exempt(rel_to_module)
            lines = open(path, encoding="utf-8").read().split("\n")
            index = 0
            while index < len(lines):
                line = lines[index]
                named = EXPORT_NAMED.match(line)
                if named:
                    block = comment_above(lines, index)
                    covered = any(IDREF.search(b) and named.group(1) in b for b in block)
                    found.append((rel, named.group(1), covered, exempt))
                    index += 1
                    continue
                if EXPORT_OPEN.match(line):
                    # a re-export block, possibly multi-line; only an *external* re-export (a library's
                    # declaration adopted here) is a declaration of this module. A local barrel re-export
                    # (`from './x'`) re-states a declaration counted where it is defined.
                    block = comment_above(lines, index)
                    body = []
                    specifier = None
                    cursor = index
                    while cursor < len(lines):
                        body.append(lines[cursor])
                        specmatch = FROM_SPECIFIER.search(lines[cursor])
                        if specmatch:
                            specifier = specmatch.group(1)
                        if "}" in lines[cursor]:
                            break
                        cursor += 1
                    if specifier and not specifier.startswith("."):
                        inner = " ".join(body).split("{", 1)[1].split("}", 1)[0]
                        names = []
                        for entry in inner.split(","):
                            entry = entry.strip()
                            if not entry:
                                continue
                            if " as " in entry:
                                entry = entry.split(" as ")[-1].strip()
                            if re.fullmatch(r"[A-Za-z_$][\w$]*", entry):
                                names.append(entry)
                        for exported in names:
                            covered = any(IDREF.search(b) and exported in b for b in block)
                            found.append((rel, exported, covered, exempt))
                    index = cursor + 1
                    continue
                index += 1
    return found


def baseline_entries():
    path = os.path.join(ROOT, BASELINE)
    if not os.path.isfile(path):
        return set()
    return {l.strip() for l in open(path, encoding="utf-8").read().split("\n")
            if l.strip() and not l.startswith("#")}


def uncovered_files(spec_text):
    """(e) files under signer/ named by neither spec, with the same exclusions core/checks/check.py applies:
    build noise and the dependency store, toolchain scaffolding (a lockfile, a manifest, a compiler config),
    the evidence captures, and the project-owned accounting baseline — a baseline that only shrinks."""
    baseline = baseline_entries()
    uncovered = []
    for base, dirs, files in os.walk(MODULE):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for name in sorted(files):
            path = os.path.join(base, name)
            rel = os.path.relpath(path, MODULE)
            rel_to_root = os.path.relpath(path, ROOT)
            if rel.startswith("evidence/") and name.endswith(".txt"):
                continue
            if name in TOOLING_FILES or rel_to_root in baseline:
                continue
            if name in spec_text or rel in spec_text:
                continue
            uncovered.append(rel_to_root)
    return uncovered


def main():
    declared = declared_set()
    uses = code_uses()
    specs = "\n".join(open(p, encoding="utf-8").read() for p in SPEC_FILES)

    module_only = [t for t in declared if "(ancestor)" not in declared[t][0]]
    print("signer — the spec <-> implementation cross-reference")
    print("# command: python3 -B signer/evidence/hash-refs.py > signer/evidence/04-hash-refs.txt")
    print("# (a) declared set: %d statement identity/identities begin a line in the module's two specs"
          % len(module_only))
    print("#     plus %d in the module's ancestors (a code token may cite itself, an ancestor, or core)"
          % (len(declared) - len(module_only)))
    print("# (b) code set: %d distinct token(s) across signer/ts/**/*.ts (node_modules excluded)"
          % len(uses))
    print("#     test-support (R3, exempt): %s" % (", ".join(test_support_globs()) or "(none declared)"))
    print("")

    print("(c) resolution — every code token against the declared set, by citation class (R2)")
    unresolved = []
    fulfilment = provenance = 0
    for token in sorted(uses):
        where = {}
        for loc, is_prov in uses[token]:
            where.setdefault("provenance" if is_prov else "fulfilment", []).append(loc)
        classes = " + ".join("%s×%d" % (k, len(v)) for k, v in sorted(where.items()))
        fulfilment += len(where.get("fulfilment", []))
        provenance += len(where.get("provenance", []))
        if token in declared:
            label, text = declared[token]
            kind = "ancestor" if "(ancestor)" in label else "module"
            print("  resolved    %s  [%s]  <- (%s: %s)  %s" % (token, classes, kind, label, text))
        else:
            unresolved.append(token)
            print("  UNRESOLVED  %s  [%s] used at %s — no declaration in the module's specs or ancestors"
                  % (token, classes, ", ".join(loc for loc, _ in uses[token])))
    print("")

    print("(d) uncovered declarations — a top-level export carrying no token")
    declarations = exported_declarations()
    exempt_count = uncovered_count = covered_count = 0
    for rel, name, covered, exempt in declarations:
        if exempt:
            exempt_count += 1
            continue
        if covered:
            covered_count += 1
        else:
            uncovered_count += 1
            print("  UNCOVERED   %s  %s" % (rel, name))
    for rel, name, covered, exempt in declarations:
        if exempt:
            print("  EXEMPT(R3)  %s  %s" % (rel, name))
    print("  %d of %d declaration(s) carry a token; %d are test-support exempt (R3); %d uncovered"
          % (covered_count, covered_count + uncovered_count, exempt_count, uncovered_count))
    print("")

    print("(e) uncovered files — under signer/, named by neither spec")
    files = uncovered_files(specs)
    for rel in files:
        print("  UNCOVERED   %s" % rel)
    print("  %d file(s) named by no statement" % len(files))
    print("")

    print("(f) summary")
    print("  code tokens: %d   resolved: %d   unresolved: %d"
          % (len(uses), len(uses) - len(unresolved), len(unresolved)))
    print("  citations: %d fulfilment, %d provenance (R2 — a negative/meta statement is never fulfilment)"
          % (fulfilment, provenance))
    print("  declarations: %d   covered: %d   test-support exempt: %d   uncovered: %d"
          % (len(declarations), covered_count, exempt_count, uncovered_count))
    print("  files: %d uncovered" % len(files))
    if unresolved:
        print("  RESULT: %d code token(s) resolve to no declaration — see (c)." % len(unresolved))
        return 1
    print("  RESULT: every code token resolves to a declared statement.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
