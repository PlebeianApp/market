#!/usr/bin/env python3
"""
nostr-io/evidence/hash-refs.py — the module-local spec<->implementation cross-reference verifier.

The convention (runs/2026-10-02-content-addressing/DIRECTION.md 2.1): an implementation source file
carries the identity of the spec statement it fulfils as a token, `#` + six hex digits, in the doc
comment directly above the declaration. A statement's identity is minted by core/checks/check.py:
sha256(normalized declaring-line text)[:6]. This verifier never mints an identity; it only resolves
the tokens the code already carries against the tokens the specs declare.

It **prints**; the caller redirects:

    python3 nostr-io/evidence/hash-refs.py > nostr-io/evidence/06-hash-refs.txt

    (a) the declared set is every line-start token in nostr-io/nostr-io.md and nostr-io/ts/ts.md
        — a token that begins a line, optionally after a markdown bullet or heading (so a *citation*
        embedded mid-line is not a declaration);
    (b) the code set is every six-hex token appearing anywhere in nostr-io/ts/**/*.ts
        (node_modules excluded);
    (c) every code token must resolve: to a statement this module declares, or to one of the module's
        ancestors (check.py permits a statement to cite itself, an ancestor, or core — a token may
        therefore legitimately resolve upward). Each resolved token is printed with its declaration text;
    (d) every top-level exported declaration in the module's TypeScript that carries no token is listed.
        A declaration living in a file the module's front-matter names `test-support:` is **exempt**
        (FANOUT R3) and is listed separately rather than as a question;
    (e) every file under nostr-io/ named by neither spec is listed (node_modules, __pycache__ and
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
MODULE_NAME = os.path.basename(MODULE)

SPEC_FILES = [
    os.path.join(MODULE, MODULE_NAME + ".md"),
    os.path.join(MODULE, "ts", "ts.md"),
]

IDREF = re.compile(r"#[0-9a-f]{6}\b")
# R2's marker: a token immediately followed by `(provenance)` is a provenance citation, not a fulfilment.
# Position-aware, so a marker that belongs to the *next* token on a shared line cannot be borrowed.
PROVENANCE = re.compile(r"#[0-9a-f]{6}`?\s*\(provenance\)")
# A token that *begins* a line, optionally after a markdown heading (###), a bullet (- * +), a bold span
# (**) or a backtick. Anything else on the line is a citation, not a declaration.
DECL = re.compile(r"^\s*(?:#{1,6}\s+|[-*+]\s+)?(?:\*\*)?`?(#[0-9a-f]{6})`?")
FRONT_INHERITS = re.compile(r"^inherits:\s*\[(.*?)\]", re.M)
# FANOUT R3: the module's front-matter names the exempt test-support files.
FRONT_TEST_SUPPORT = re.compile(r"^test-support:\s*\[(.*?)\]", re.M)

EXPORT_NAMED = re.compile(
    r"^export\s+(?:async\s+)?(?:function|class|interface|type|const|let|var|enum)\s+([A-Za-z_$][\w$]*)"
)
EXPORT_OPEN = re.compile(r"^export\s+(?:type\s+)?\{")
FROM_SPECIFIER = re.compile(r"from\s*['\"]([^'\"]+)['\"]")


def module_md(name):
    return os.path.join(ROOT, name, name + ".md")


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


def test_support():
    """The exempt test-support globs declared in this module's front-matter (FANOUT R3)."""
    path = os.path.join(MODULE, MODULE_NAME + ".md")
    text = open(path, encoding="utf-8").read()
    match = FRONT_TEST_SUPPORT.search(text)
    if not match:
        return []
    return [p.strip().strip('"') for p in match.group(1).split(",") if p.strip()]


def is_exempt(rel_to_ts):
    return any(fnmatch.fnmatch(rel_to_ts, glob) for glob in test_support())


def declared_set():
    """(a) token -> (source label, declaration text), from the two specs and the ancestors' specs.

    A declaring line is one where the token begins the line after an optional markdown bullet or heading,
    or where it opens its own paragraph (the previous line is blank) — the same rule core/checks/check.py
    uses, so a token that merely continues the sentence above it (a citation) is not a declaration.
    """
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
    """(b) token -> list of ('file:line', line, col) where it appears in nostr-io/ts/**/*.ts."""
    uses = {}
    for base, dirs, files in os.walk(TS):
        dirs[:] = [d for d in dirs if d != "node_modules"]
        for name in sorted(files):
            if not name.endswith(".ts"):
                continue
            path = os.path.join(base, name)
            rel = os.path.relpath(path, ROOT)
            for number, line in enumerate(open(path, encoding="utf-8").read().split("\n"), 1):
                for match in IDREF.finditer(line):
                    uses.setdefault(match.group(0), []).append(("%s:%d" % (rel, number), line, match.start()))
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


LOCAL_DECL = re.compile(
    r"^(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|const|let|var|enum)\s+([A-Za-z_$][\w$]*)"
)


def local_decl_blocks(lines):
    """name -> the comment block directly above a declaration of that name (exported or not).

    Used for a local `export { a, b }` block: the citation belongs on the declaration the
    name resolves to, not on the export statement, so a hoisted declaration is still counted.
    """
    out = {}
    for index, line in enumerate(lines):
        match = LOCAL_DECL.match(line)
        if match and match.group(1) not in out:
            out[match.group(1)] = comment_above(lines, index)
    return out


def exported_declarations():
    """(d) [(file, name, covered, exempt)] for every top-level exported declaration in the module's sources."""
    found = []
    for base, dirs, files in os.walk(TS):
        dirs[:] = [d for d in dirs if d != "node_modules"]
        for name in sorted(files):
            if not name.endswith(".ts") or name.endswith(".test.ts"):
                continue
            path = os.path.join(base, name)
            rel = os.path.relpath(path, ROOT)
            rel_mod = os.path.relpath(path, MODULE)
            lines = open(path, encoding="utf-8").read().split("\n")
            index = 0
            while index < len(lines):
                line = lines[index]
                named = EXPORT_NAMED.match(line)
                if named:
                    block = comment_above(lines, index)
                    covered = any(IDREF.search(b) and named.group(1) in b for b in block)
                    found.append((rel, named.group(1), covered, is_exempt(rel_mod)))
                    index += 1
                    continue
                if EXPORT_OPEN.match(line):
                    # a re-export block, possibly multi-line. An *external* re-export (a library's
                    # declaration adopted here) is a declaration of this module, cited above the block.
                    # A local re-export resolves its names to the declaration that carries the citation
                    # (so a hoisted `function createNostrIo` is counted), and a name merely imported and
                    # re-exported is counted where it is defined, not here.
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
                    external = bool(specifier) and not specifier.startswith(".")
                    local_blocks = local_decl_blocks(lines) if not external else {}
                    for exported in names:
                        if external:
                            covered = any(IDREF.search(b) and exported in b for b in block)
                            found.append((rel, exported, covered, is_exempt(rel_mod)))
                        else:
                            decl_block = local_blocks.get(exported)
                            if decl_block is None:
                                continue
                            covered = any(IDREF.search(b) and exported in b for b in decl_block)
                            found.append((rel, exported, covered, is_exempt(rel_mod)))
                    index = cursor + 1
                    continue
                index += 1
    return found


def uncovered_files(spec_text):
    """(e) files under the module named by neither spec, excluding build noise and captures."""
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
    declared = declared_set()
    uses = code_tokens()
    specs = "\n".join(open(p, encoding="utf-8").read() for p in SPEC_FILES)

    print("%s — the spec <-> implementation cross-reference" % MODULE_NAME)
    print("# command: python3 %s/evidence/hash-refs.py > %s/evidence/06-hash-refs.txt" % (MODULE_NAME, MODULE_NAME))
    print("# (a) declared set: %d statement identity/identities begin a line in the module's two specs"
          % len([t for t, v in declared.items() if not v[2]]))
    print("#     plus %d in the module's ancestors (a code token may cite itself, an ancestor, or core)"
          % len([t for t, v in declared.items() if v[2]]))
    print("# (b) code set: %d distinct token(s) across %s/ts/**/*.ts (node_modules excluded)"
          % (len(uses), MODULE_NAME))
    print("#     test-support exemption (R3): %s" % (test_support() or "none declared"))
    print("")

    print("(c) resolution — every code token against the declared set")
    print("     [fulfilment] a plain citation; [provenance] carries the `(provenance)` marker (R2);")
    print("     [mixed] some occurrences marked and some not — a token's class must be consistent.")
    unresolved = []
    classes = {"fulfilment": 0, "provenance": 0, "mixed": 0}
    for token in sorted(uses):
        occurrences = uses[token]
        if token in declared:
            label, text, is_ancestor = declared[token]
            where = "ancestor" if is_ancestor else "module"
            marks = [bool(PROVENANCE.match(line[col:])) for _, line, col in occurrences]
            klass = "provenance" if all(marks) else ("mixed" if any(marks) else "fulfilment")
            classes[klass] += 1
            print("  resolved    %s  [%s]  <- (%s: %s)  %s" % (token, klass, where, label, text))
        else:
            unresolved.append(token)
            print("  UNRESOLVED  %s  used at %s — no declaration in the module's specs or ancestors"
                  % (token, ", ".join(loc for loc, _, _ in occurrences)))
    print("")

    print("(d) uncovered declarations — a top-level export carrying no token")
    declarations = exported_declarations()
    for rel, name, covered, exempt in declarations:
        if not covered and not exempt:
            print("  UNCOVERED   %s  %s" % (rel, name))
    exempt_count = sum(1 for _, _, covered, exempt in declarations if not covered and exempt)
    for rel, name, covered, exempt in declarations:
        if not covered and exempt:
            print("  exempt      %s  %s  (R3 test-support)" % (rel, name))
    covered_count = sum(1 for _, _, covered, _ in declarations if covered)
    print("  %d of %d declaration(s) carry a token (%d exempt by R3)"
          % (covered_count, len(declarations), exempt_count))
    print("")

    print("(e) uncovered files — under %s/, named by neither spec" % MODULE_NAME)
    files = uncovered_files(specs)
    for rel in files:
        print("  UNCOVERED   %s" % rel)
    print("  %d file(s) named by no statement" % len(files))
    print("")

    print("(f) summary")
    print("  code tokens: %d   resolved: %d   unresolved: %d"
          % (len(uses), len(uses) - len(unresolved), len(unresolved)))
    print("  citations: %d fulfilment, %d provenance, %d mixed (R2)"
          % (classes["fulfilment"], classes["provenance"], classes["mixed"]))
    print("  declarations: %d   uncovered: %d   exempt: %d"
          % (len(declarations), len(declarations) - covered_count - exempt_count, exempt_count))
    print("  files: %d uncovered" % len(files))
    if unresolved:
        print("  RESULT: %d code token(s) resolve to no declaration — see (c)." % len(unresolved))
        return 1
    print("  RESULT: every code token resolves to a declared statement.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
