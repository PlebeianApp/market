#!/usr/bin/env python3
"""
signer/evidence/transitions.py — the state machine is **one list**, checked.

Three artifacts state the allowed transitions, and all three have to agree:

  1. the spec's statement `#489ae8` (`signer/signer.md`) — the normative list;
  2. the mermaid diagram in §7 of the same document — the same edges, drawn;
  3. the `ALLOWED` table the implementation enforces (`signer/ts/session.ts`).

In the first pass two of the three had drifted: the table admitted `locked → idle`,
which the document did not list (and which no operation needed), and omitted
`idle → restoring`, which `restoreSession()` performs when it migrates a legacy
plaintext record. A transition table that neither contains what the code does nor
what the code must do is not a contract, so this script extracts all three
mechanically and diffs them in every direction.

Usage:  python3 signer/evidence/transitions.py
Exit:   0 — the three lists are the same set of edges; 1 — they are not (or an
        extraction came back empty, which would make the diff pass by accident).
"""
import os
import re
import sys

MODULE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPEC = os.path.join(MODULE, "signer.md")
SESSION = os.path.join(MODULE, "ts", "session.ts")

# `idle → connecting` in the spec's list, and `idle --> connecting` in the diagram.
EDGE = re.compile(r"`?([a-z_]+)`?\s*→\s*`?([a-z_]+)`?")
ARROW = re.compile(r"^\s*([a-z_]+)\s*-->\s*([a-z_]+)")
FENCE = re.compile(r"```[a-z]*\n(.*?)```", re.S)
ALLOWED = re.compile(r"const ALLOWED: Record<SessionState, SessionState\[\]> = \{(.*?)\n\}", re.S)
ENTRY = re.compile(r"^\s*([a-z_]+):\s*\[(.*?)\],")


def statement(text, identity):
    """The body of one statement, up to the next heading of the same level."""
    marker = "### `%s`" % identity
    start = text.index(marker) + len(marker)
    tail = text[start:]
    stop = tail.find("\n### ")
    return tail if stop < 0 else tail[:stop]


def spec_edges(text):
    """The first fenced block of `#489ae8`: one edge per line, in the document."""
    body = statement(text, "#489ae8")
    blocks = FENCE.findall(body)
    if not blocks:
        sys.exit("transitions.py: no fenced block found in #489ae8")
    edges = set()
    for line in blocks[0].splitlines():
        for source, target in EDGE.findall(line):
            edges.add((source, target))
    return edges


def diagram_edges(text):
    """The state diagram in §7: `source --> target: cause` lines."""
    for block in FENCE.findall(text):
        if "stateDiagram" not in block:
            continue
        edges = set()
        for line in block.splitlines():
            match = ARROW.match(line)
            if match:
                edges.add((match.group(1), match.group(2)))
        return edges
    sys.exit("transitions.py: no stateDiagram block found in signer.md")


def code_edges(text):
    """The `ALLOWED` table in session.ts, as a set of edges."""
    match = ALLOWED.search(text)
    if not match:
        sys.exit("transitions.py: the ALLOWED table was not found in session.ts")
    edges = set()
    for line in match.group(1).splitlines():
        line = line.strip()
        if line.startswith("//") or not line:
            continue
        entry = ENTRY.match(line)
        if not entry:
            continue
        for target in re.findall(r"'([a-z_]+)'", entry.group(2)):
            edges.add((entry.group(1), target))
    return edges


def show(label, edges):
    print("%-28s %d edge(s)" % (label, len(edges)))
    for source, target in sorted(edges):
        print("    %-14s → %s" % (source, target))


def main():
    text = open(SPEC).read()
    code = open(SESSION).read()
    lists = [
        ("signer.md · #489ae8 (the list)", spec_edges(text)),
        ("signer.md · §7 (the diagram)", diagram_edges(text)),
        ("session.ts · ALLOWED (enforced)", code_edges(code)),
    ]

    for label, edges in lists:
        show(label, edges)
        print()

    empty = [label for label, edges in lists if not edges]
    failures = 0
    if empty:
        print("HARD: an extraction came back empty (%s) — the diff would pass by accident" % ", ".join(empty))
        failures += 1

    reference_label, reference = lists[0]
    for label, edges in lists[1:]:
        missing = reference - edges
        extra = edges - reference
        print("diff  <%s> vs <%s>" % (label, reference_label))
        for source, target in sorted(missing):
            print("    only in %s: %s → %s" % (reference_label, source, target))
        for source, target in sorted(extra):
            print("    only in %s: %s → %s" % (label, source, target))
        if missing or extra:
            failures += 1
        print("    exit: %d   (0 = the same set of edges)" % (1 if (missing or extra) else 0))
        print()

    print("transitions: %d edge(s), %d disagreement(s)" % (len(reference), failures))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
