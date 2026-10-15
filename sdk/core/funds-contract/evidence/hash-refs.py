#!/usr/bin/env python3
"""
funds-contract/evidence/hash-refs.py — the module-local spec<->implementation cross-reference verifier.

The convention (runs/2026-10-02-content-addressing/DIRECTION.md 2.1, mechanics in FANOUT.md): an
implementation source file carries the identity of the spec statement it fulfils as a token, `#` + six
hex digits, in the doc comment directly above the declaration. A statement's identity is minted by
core/checks/check.py: sha256(normalized declaring-line text)[:6]. This verifier never mints; it only
resolves the tokens the code already carries against the tokens the specs declare.

It **prints**; the caller redirects:

    python3 funds-contract/evidence/hash-refs.py > funds-contract/evidence/02-hash-refs.txt

This module ships a **types-only** `ts/`, so this verifier now has code tokens to resolve: every
top-level type export carries the identity of the statement it fulfils, with the export's own name on
the same line as the token. It still checks (e) — every file under the module named by no spec — so the
files this module ships are accounted for by its own MD.

    (a) the declared set is every line-start token in the module's own spec(s), plus the module's
        ancestors (check.py permits a statement to cite itself, an ancestor, or core);
    (b) the code set is every six-hex token appearing anywhere in the module's ts/**/*.ts;
    (c) every code token must resolve;
    (d) every top-level exported declaration carrying no token is listed;
    (e) every file under the module named by no spec is listed — with the same toolchain-scaffolding
        exemption core/checks/check.py applies, so the two tools agree.

Exit status is non-zero if any code token is unresolved. An uncovered declaration is a question, not a
broken link, so it does not fail the run.
"""
import os
import re
import sys

MODULE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.dirname(MODULE)
NAME = os.path.basename(MODULE)
TS = os.path.join(MODULE, "ts")

SPEC_FILES = [p for p in (os.path.join(MODULE, NAME + ".md"), os.path.join(TS, "ts.md")) if os.path.isfile(p)]

IDREF = re.compile(r"#[0-9a-f]{6}\b")
DECL = re.compile(r"^\s*(?:#{1,6}\s+|[-*+]\s+)?(?:\*\*)?`?(#[0-9a-f]{6})`?")
FRONT_INHERITS = re.compile(r"^inherits:\s*\[(.*?)\]", re.M)

EXPORT_NAMED = re.compile(
    r"^export\s+(?:async\s+)?(?:function|class|interface|type|const|let|var|enum)\s+([A-Za-z_$][\w$]*)"
)

# the toolchain-scaffolding exemption, verbatim from core/checks/check.py — a lockfile or a compiler
# config is not an answer to "why is this here?", so neither tool demands an account of it
TOOLING_FILES = {
    "bun.lock", "bun.lockb", "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "go.sum", "flake.lock",
    "Cargo.lock", "package.json", "tsconfig.json", "jsconfig.json", "go.mod", "Cargo.toml", ".gitignore",
}


def module_md(name):
    return os.path.join(ROOT, name, name + ".md")


def ancestors():
    """The module's ancestors, as check.py computes them: the closure of `inherits`, plus core."""
    mods = {}
    for entry in sorted(os.listdir(ROOT)):
        md = module_md(entry)
        if os.path.isfile(md):
            match = FRONT_INHERITS.search(open(md, encoding="utf-8").read())
            mods[entry] = [p.strip().strip('"') for p in match.group(1).split(",") if p.strip()] if match else []
    seen, stack = set(), list(mods.get(NAME, []))
    while stack:
        n = stack.pop()
        if n in seen:
            continue
        seen.add(n)
        stack.extend(mods.get(n, []))
    return seen | {"core"}


def declared_set():
    declared = {}

    def scan(path, label, is_ancestor):
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
                declared[token] = (label, text, is_ancestor)

    for path in SPEC_FILES:
        scan(path, os.path.relpath(path, ROOT), False)
    for name in sorted(ancestors()):
        path = module_md(name)
        if os.path.isfile(path):
            scan(path, os.path.relpath(path, ROOT), True)
    return declared


def code_tokens():
    uses = {}
    for base, dirs, files in os.walk(TS):
        dirs[:] = [d for d in dirs if d != "node_modules"]
        for fname in sorted(files):
            if not fname.endswith(".ts"):
                continue
            path = os.path.join(base, fname)
            rel = os.path.relpath(path, ROOT)
            for number, line in enumerate(open(path, encoding="utf-8").read().split("\n"), 1):
                for token in IDREF.findall(line):
                    uses.setdefault(token, []).append("%s:%d" % (rel, number))
    return uses


def comment_above(lines, index):
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
    found = []
    for base, dirs, files in os.walk(TS):
        dirs[:] = [d for d in dirs if d != "node_modules"]
        for fname in sorted(files):
            if not fname.endswith(".ts") or fname.endswith(".test.ts"):
                continue
            rel = os.path.relpath(os.path.join(base, fname), ROOT)
            lines = open(os.path.join(base, fname), encoding="utf-8").read().split("\n")
            for index, line in enumerate(lines):
                named = EXPORT_NAMED.match(line)
                if named:
                    block = comment_above(lines, index)
                    covered = any(IDREF.search(b) and named.group(1) in b for b in block)
                    found.append((rel, named.group(1), covered))
    return found


def uncovered_files(spec_text):
    uncovered = []
    for base, dirs, files in os.walk(MODULE):
        dirs[:] = [d for d in dirs if d not in ("node_modules", "__pycache__", ".git")]
        for fname in sorted(files):
            path = os.path.join(base, fname)
            rel = os.path.relpath(path, MODULE)
            # the module's own spec does not name itself — it *is* the naming
            if os.path.abspath(path) in [os.path.abspath(p) for p in SPEC_FILES]:
                continue
            if rel.startswith("evidence/") and fname.endswith(".txt"):
                continue
            if fname in TOOLING_FILES:
                continue
            if fname in spec_text or rel in spec_text:
                continue
            uncovered.append(os.path.relpath(path, ROOT))
    return uncovered


def main():
    declared = declared_set()
    uses = code_tokens()
    specs = "\n".join(open(p, encoding="utf-8").read() for p in SPEC_FILES)

    print("%s — the spec <-> implementation cross-reference" % NAME)
    print("# command: python3 funds-contract/evidence/hash-refs.py > funds-contract/evidence/02-hash-refs.txt")
    print("# (a) declared set: %d statement identity/identities in the module's own spec(s)"
          % len([t for t, v in declared.items() if not v[2]]))
    print("#     plus %d in the module's ancestors (a token may cite itself, an ancestor, or core)"
          % len([t for t, v in declared.items() if v[2]]))
    print("# (b) code set: %d distinct token(s) across %s/ts/**/*.ts" % (len(uses), NAME))
    print("")

    print("(c) resolution — every code token against the declared set")
    unresolved = []
    for token in sorted(uses):
        if token in declared:
            label, text, is_ancestor = declared[token]
            where = "ancestor" if is_ancestor else "module"
            print("  resolved    %s  <- (%s: %s)  %s" % (token, where, label, text))
        else:
            unresolved.append(token)
            print("  UNRESOLVED  %s  used at %s — no declaration in the module's specs or ancestors"
                  % (token, ", ".join(uses[token])))
    print("")

    print("(d) uncovered declarations — a top-level export carrying no token")
    declarations = exported_declarations()
    for rel, name, covered in declarations:
        if not covered:
            print("  UNCOVERED   %s  %s" % (rel, name))
    covered_count = sum(1 for _, _, covered in declarations if covered)
    print("  %d of %d declaration(s) carry a token" % (covered_count, len(declarations)))
    print("")

    print("(e) uncovered files — under %s/, named by no spec (toolchain scaffolding exempt)" % NAME)
    files = uncovered_files(specs)
    for rel in files:
        print("  UNCOVERED   %s" % rel)
    print("  %d file(s) named by no statement" % len(files))
    print("")

    print("(f) summary")
    print("  code tokens: %d   resolved: %d   unresolved: %d"
          % (len(uses), len(uses) - len(unresolved), len(unresolved)))
    print("  declarations: %d   uncovered: %d" % (len(declarations), len(declarations) - covered_count))
    print("  files: %d uncovered" % len(files))
    if unresolved:
        print("  RESULT: %d code token(s) resolve to no declaration — see (c)." % len(unresolved))
        return 1
    print("  RESULT: every code token resolves to a declared statement.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
