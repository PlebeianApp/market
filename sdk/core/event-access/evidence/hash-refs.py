#!/usr/bin/env python3
"""
event-access/evidence/hash-refs.py — the module-local spec<->implementation cross-reference verifier.

The convention (runs/2026-10-02-content-addressing/DIRECTION.md 2.1): an implementation source file
carries the identity of the spec statement it fulfils as a token, `#` + six hex digits, in the doc
comment directly above the declaration. A statement's identity is minted by core/checks/check.py:
sha256(normalized declaring-line text)[:6]. This verifier never mints an identity; it only resolves
the tokens the code already carries against the tokens the specs declare.

It **prints**; the caller redirects:

    python3 event-access/evidence/hash-refs.py > event-access/evidence/03-hash-refs.txt

    (a) the declared set is every line-start token in event-access/event-access.md and
        event-access/ts/ts.md — a token that begins a line, optionally after a markdown bullet or
        heading (so a *citation* embedded mid-line is not a declaration);
    (b) the code set is every six-hex token appearing anywhere in event-access/ts/**/*.ts
        (node_modules excluded);
    (c) every code token must resolve: to a statement this module declares, or to one of the module's
        ancestors (check.py permits a statement to cite itself, an ancestor, or core — a token may
        therefore legitimately resolve upward). Each resolved token is printed with its declaration text;
    (d) every top-level exported declaration in the module's TypeScript that carries no token is listed,
        **except** a declaration in a file the module's front-matter declares test support (R3): those
        are printed as exempt, which is the decision on the record rather than a per-module question;
    (e) every file under event-access/ named by neither spec is listed (node_modules, __pycache__ and
        evidence/*.txt captures excluded).

Exit status is non-zero if any code token is unresolved. It exits 0 when every token resolves, even
when the uncovered lists are non-empty: an uncovered declaration is a question, not a broken link.
"""
import fnmatch
import os
import re
import sys

MODULE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.dirname(MODULE)
TS = os.path.join(MODULE, "ts")

SPEC_FILES = [
    os.path.join(MODULE, "event-access.md"),
    os.path.join(MODULE, "ts", "ts.md"),
]

IDREF = re.compile(r"#[0-9a-f]{6}\b")
# R2 (FANOUT.md): a historical/meta or negative statement is cited as provenance, never as
# fulfilment, and the citing comment carries the literal marker on the same line. This verifier
# counts the two classes separately, so a negative statement can never be scored as fulfilled.
PROVENANCE = re.compile(r"\(provenance\)")
# A token that *begins* a line, optionally after a markdown heading (###), a bullet (- * +), a bold span
# (**) or a backtick. Anything else on the line is a citation, not a declaration.
DECL = re.compile(r"^\s*(?:#{1,6}\s+|[-*+]\s+)?(?:\*\*)?`?(#[0-9a-f]{6})`?")
FRONT_INHERITS = re.compile(r"^inherits:\s*\[(.*?)\]", re.M)
FRONT_TEST_SUPPORT = re.compile(r"^test-support:\s*\[(.*?)\]", re.M)
QUOTED = re.compile(r"['\"]([^'\"]*)['\"]")

EXPORT_NAMED = re.compile(
    r"^export\s+(?:async\s+)?(?:function|class|interface|type|const|let|var|enum)\s+([A-Za-z_$][\w$]*)"
)
EXPORT_OPEN = re.compile(r"^export\s+(?:type\s+)?\s*\{")
FROM_SPECIFIER = re.compile(r"from\s*['\"]([^'\"]+)['\"]")


def module_md(name):
    return os.path.join(ROOT, name, name + ".md")


def parse_list(pattern, text):
    match = pattern.search(text)
    if not match:
        return []
    return [p.strip().strip('"').strip("'") for p in match.group(1).split(",") if p.strip()]


def test_support_patterns():
    """The module's own R3 declaration: files whose exports need no statement."""
    path = os.path.join(MODULE, "event-access.md")
    if not os.path.isfile(path):
        return []
    return parse_list(FRONT_TEST_SUPPORT, open(path, encoding="utf-8").read())


def ancestors():
    """The module's ancestors, as check.py computes them: the closure of `inherits`, plus core."""
    mods = {}
    for entry in sorted(os.listdir(ROOT)):
        md = module_md(entry)
        if os.path.isfile(md):
            text = open(md, encoding="utf-8").read()
            mods[entry] = parse_list(FRONT_INHERITS, text)
    seen, stack = set(), list(mods.get(os.path.basename(MODULE), []))
    while stack:
        name = stack.pop()
        if name in seen:
            continue
        seen.add(name)
        stack.extend(mods.get(name, []))
    return seen | {"core"}


def declared_set():
    """(a) token -> (source label, declaration text), from the two specs and the ancestors' specs."""
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
        if not os.path.isfile(path):
            sys.exit("missing spec: %s" % path)
        scan(path, os.path.relpath(path, ROOT), False)
    for name in sorted(ancestors()):
        path = module_md(name)
        if os.path.isfile(path):
            scan(path, os.path.relpath(path, ROOT), True)
    return declared


def code_tokens():
    """(b) token -> sorted list of 'file:line' where it appears in event-access/ts/**/*.ts.

    Also returns, per token, [provenance uses, total uses] — R2's marker read mechanically.
    """
    uses = {}
    provenance = {}
    for base, dirs, files in os.walk(TS):
        dirs[:] = [d for d in dirs if d != "node_modules"]
        for name in sorted(files):
            if not name.endswith(".ts"):
                continue
            path = os.path.join(base, name)
            rel = os.path.relpath(path, ROOT)
            for number, line in enumerate(open(path, encoding="utf-8").read().split("\n"), 1):
                marked = bool(PROVENANCE.search(line))
                for token in IDREF.findall(line):
                    uses.setdefault(token, []).append("%s:%d" % (rel, number))
                    counts = provenance.setdefault(token, [0, 0])
                    counts[1] += 1
                    if marked:
                        counts[0] += 1
    return uses, provenance


def comment_above(lines, index):
    """The contiguous comment block immediately above lines[index] (0-based), as a list of lines."""
    block = []
    cursor = index - 1
    while cursor >= 0:
        stripped = lines[cursor].strip()
        if stripped.startswith("*") or stripped.startswith("/*") or stripped.endswith("*/"):
            block.append(lines[cursor])
            cursor -= 1
            continue
        break
    return list(reversed(block))


def is_test_support(rel, patterns):
    rel_module = os.path.relpath(os.path.join(ROOT, rel), MODULE)
    return any(fnmatch.fnmatch(rel_module, pattern) for pattern in patterns)


def exported_declarations(patterns):
    """(d) [(file, name, covered, exempt)] for every top-level exported declaration."""
    found = []
    for base, dirs, files in os.walk(TS):
        dirs[:] = [d for d in dirs if d != "node_modules"]
        for name in sorted(files):
            if not name.endswith(".ts") or name.endswith(".test.ts"):
                continue
            path = os.path.join(base, name)
            rel = os.path.relpath(path, ROOT)
            exempt = is_test_support(rel, patterns)
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


def uncovered_files(spec_text):
    """(e) files under event-access/ named by neither spec, excluding build noise and captures."""
    uncovered = []
    for base, dirs, files in os.walk(MODULE):
        dirs[:] = [d for d in dirs if d not in ("node_modules", "__pycache__", ".git")]
        for name in sorted(files):
            path = os.path.join(base, name)
            rel = os.path.relpath(path, MODULE)
            if rel.startswith("evidence/") and name.endswith(".txt"):
                continue
            if not name.endswith(".md"):
                if name in spec_text:
                    continue
            if name in spec_text or rel in spec_text:
                continue
            uncovered.append(os.path.relpath(path, ROOT))
    return uncovered


def main():
    patterns = test_support_patterns()
    declared = declared_set()
    uses, provenance = code_tokens()
    specs = "\n".join(open(p, encoding="utf-8").read() for p in SPEC_FILES)

    print("event-access — the spec <-> implementation cross-reference")
    print("# command: python3 event-access/evidence/hash-refs.py > event-access/evidence/03-hash-refs.txt")
    print("# (a) declared set: %d statement identity/identities begin a line in the module's two specs"
          % len([t for t, v in declared.items() if not v[2]]))
    print("#     plus %d in the module's ancestors (a code token may cite itself, an ancestor, or core)"
          % len([t for t, v in declared.items() if v[2]]))
    print("# (b) code set: %d distinct token(s) across event-access/ts/**/*.ts (node_modules excluded)"
          % len(uses))
    print("# (R3) test support declared in the module's front-matter: %s"
          % (", ".join(patterns) if patterns else "— none"))
    print("")

    print("(c) resolution — every code token against the declared set (R2: a `(provenance)` marker "
          "is read as provenance, never as fulfilment)")
    unresolved = []
    provenance_only = 0
    for token in sorted(uses):
        if token in declared:
            label, text, is_ancestor = declared[token]
            where = "ancestor" if is_ancestor else "module"
            marked, total = provenance.get(token, [0, 0])
            kind = "provenance" if marked == total and total > 0 else ("resolved" if marked == 0 else "resolved  ")
            if marked == total and total > 0:
                provenance_only += 1
            print("  %-10s  %s  <- (%s: %s)  %s" % (kind, token, where, label, text))
        else:
            unresolved.append(token)
            print("  UNRESOLVED  %s  used at %s — no declaration in the module's specs or ancestors"
                  % (token, ", ".join(uses[token])))
    print("")

    print("(d) uncovered declarations — a top-level export carrying no token (R3 test support exempt)")
    declarations = exported_declarations(patterns)
    exempt_count = 0
    for rel, name, covered, exempt in declarations:
        if covered:
            continue
        if exempt:
            exempt_count += 1
            print("  exempt      %s  %s" % (rel, name))
        else:
            print("  UNCOVERED   %s  %s" % (rel, name))
    covered_count = sum(1 for _, _, covered, _ in declarations if covered)
    real_uncovered = sum(1 for _, _, covered, exempt in declarations if not covered and not exempt)
    print("  %d of %d declaration(s) carry a token; %d exempt by the test-support declaration"
          % (covered_count, len(declarations), exempt_count))
    print("")

    print("(e) uncovered files — under event-access/, named by neither spec")
    files = uncovered_files(specs)
    for rel in files:
        print("  UNCOVERED   %s" % rel)
    print("  %d file(s) named by no statement" % len(files))
    print("")

    print("(f) summary")
    print("  code tokens: %d   resolved: %d   unresolved: %d   of the resolved, provenance-only: %d"
          % (len(uses), len(uses) - len(unresolved), len(unresolved), provenance_only))
    print("  declarations: %d   covered: %d   exempt: %d   uncovered: %d"
          % (len(declarations), covered_count, exempt_count, real_uncovered))
    print("  files: %d uncovered" % len(files))
    if unresolved:
        print("  RESULT: %d code token(s) resolve to no declaration — see (c)." % len(unresolved))
        return 1
    print("  RESULT: every code token resolves to a declared statement.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
