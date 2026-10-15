#!/usr/bin/env python3
"""
event-store/evidence/falsify.py — proves that the module's invariant tests are real.

A test that cannot fail is not evidence. For each invariant this module claims to
enforce, this script:

  1. records the sha256 of the file it is about to break,
  2. applies ONE mutation that breaks that invariant (asserting the anchor text
     occurs exactly once, so a mutation can never be applied by accident),
  3. runs the **named case** — a case of the module's own suite, addressed by the
     prefix the increment's table writes — and captures its own output and exit
     code,
  4. restores the file byte-for-byte and verifies the sha256 matches,
  5. runs the same case again and captures the restored result.

A mutation that does NOT make its named case fail is reported as
`FALSIFICATION FAILED` — that would mean the case is not covering the invariant it
is named for. Nothing here is committed: every mutated file is restored before the
run ends and the restore is verified by hash. **Run it serialized** — never at the
same time as the suite that reads these files, because for the length of one
mutation the tree is deliberately broken.

**It prints; the caller redirects:**

    python3 event-store/evidence/falsify.py > event-store/evidence/02-invariant-falsification.txt

**Cases are addressed by prefix, not by whole title.** The increment's table names
a case by its leading words (`M7 · a malformed identity value rejects …`), and two
titles carry punctuation a literal matcher must handle — `M7`'s nested single
quotes and `M9`'s trailing `, at the boundary expiration === now`. So a case is
resolved by matching the prefix against the titles actually in the suite, and a
prefix that matches **zero** or **more than one** case is a `FALSIFICATION FAILED`
report, never a guess. A later wording change after that prefix cannot orphan a
mutation.

Two harness rules, both of them earned elsewhere: the case name is escaped before
it reaches the runner (whose `-t` filter is a regular expression, so a name
containing `(fail closed)` once matched no case at all and its non-zero exit was
read as a failing assertion), and a check that matched no case, or that is not
green again on the restored file, is counted as a failure — a defect in this
harness or in the suite, never evidence for an invariant.
"""

import hashlib
import os
import re
import subprocess
import sys

MODULE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TS = os.path.join(MODULE, "ts")
BUN = os.environ.get("BUN", os.path.expanduser("~/.bun/bin/bun"))

# Each mutation: the file, the unique anchor to break, the broken form, and the
# **prefix** of the case that must fail because of it. The anchors are lines the
# increment orders into these files, so each occurs exactly once.
MUTATIONS = [
    {
        "invariant": "M3",
        "why": "the tie-break flips, so the lexicographically HIGHER id wins an equal created_at",
        "file": "heads.ts",
        "anchor": "\treturn a.id < b.id ? -1 : 1",
        "broken": "\treturn a.id > b.id ? -1 : 1",
        "case": "M3 · one head per address, ties broken by the lexicographically lower id",
    },
    {
        "invariant": "M3",
        "why": "the collapse keeps the first arrival instead of the winner, so the input order decides",
        "file": "heads.ts",
        "anchor": "\t\tif (!existing || compareVersions(event, existing) < 0) groups.set(uid, event)",
        "broken": "\t\tif (!existing) groups.set(uid, event)",
        "case": "M3 · the collapse does not depend on the input order",
    },
    {
        "invariant": "M7",
        "why": "the malformed-identity rejection returns instead of throwing, so a bad filter is accepted",
        "file": "filters.ts",
        "anchor": "\t\t\t\t\tthrow new StoreError('rejected', `${key}[${index}] is not a lower-case hex identifier of at most ${MAX_IDENTITY_LENGTH} characters`)",
        "broken": "\t\t\t\t\treturn",
        "case": "M7 · a malformed identity value rejects",
    },
    {
        "invariant": "M7",
        "why": "toFilterArray drops empty arrays, so an empty identity list is broadened to everything",
        "file": "filters.ts",
        "anchor": "\treturn Array.isArray(filters) ? [...filters] : [filters]",
        "broken": "\treturn (Array.isArray(filters) ? [...filters] : [filters]).map((filter) => Object.fromEntries(Object.entries(filter).filter(([, value]) => !Array.isArray(value) || value.length > 0)) as FilterIn)",
        "case": "M7 · an empty identity list matches nothing and is not broadened",
    },
    {
        "invariant": "M9",
        "why": "the author check is dropped, so any author's kind-5 deletes any event by id",
        "file": "deletions.ts",
        "anchor": "\t\t\t\tif (entry.author !== event.pubkey) continue",
        "broken": "\t\t\t\tif (false) continue",
        "case": "M9 · a kind-5 deletion is honoured for its own author's event only",
    },
    {
        "invariant": "M9",
        "why": "NIP-40's boundary flips to `<`, so an event expiring exactly now is read as live",
        "file": "store.ts",
        "anchor": "\t\t\t\tif (expiration !== null && expiration <= clock.now()) return false",
        "broken": "\t\t\t\tif (expiration !== null && expiration < clock.now()) return false",
        "case": "M9 · an expired event is excluded on read",
    },
    {
        "invariant": "M2",
        "why": "the id-unique union stops deduplicating, so an event matched twice is returned twice",
        "file": "store.ts",
        "anchor": "\t\t\t\tif (seen.has(event.id)) continue",
        "broken": "\t\t\t\t\t// the id-unique union is gone (the mutation for M2)",
        "case": "M2 · an event matched by two filters is returned once",
    },
    {
        "invariant": "M12",
        "why": "the read stops marking provenance, so a locally answered event is indistinguishable",
        "file": "store.ts",
        "anchor": "\t\tfor (const event of out) markFromCache(event)",
        "broken": "\t\t\t// the provenance marking is gone (the mutation for M12)",
        "case": "M12 · a read's events satisfy isFromCache",
    },
    {
        "invariant": "M5 + M14",
        "why": "a relay edge is re-attached to the handle — the second surface and the socket the module must not carry",
        "file": "store.ts",
        "anchor": "\t\ttier: 'local',",
        "broken": "\t\trelay: undefined,\n\t\ttier: 'local',",
        "case": "M5 + M14 · no socket is required: the handle is exactly the endpoint, and the count is local",
    },
    {
        "invariant": "M7",
        "why": "the identity arm stops recognising an empty identity-tag list — the narrower rule before I3a — so a filter naming nobody is handed to the library's invalidation primitive, which answers a filter carrying no condition with the whole store",
        "file": "filters.ts",
        "anchor": "\t\tif (key === 'ids' || key === 'authors' || key.startsWith('#')) return true",
        "broken": "\t\tif (key === 'ids' || key === 'authors') return true",
        "case": "M7 · an empty identity list is answered as nothing",
    },
    {
        "invariant": "D-O6 · the general empty-#-key rule (`#2e71c3`, I3a)",
        "why": "the rule narrows back to the identity keys, so a present-but-empty `#t`, `#d` or `#a` list is answered as if the key were absent — the whole store for a filter that matches nothing, which is NIP-01's fail-open shape from the other side",
        "file": "filters.ts",
        "anchor": "\t\tif (key === 'ids' || key === 'authors' || key.startsWith('#')) return true",
        "broken": "\t\tif (key === 'ids' || key === 'authors') return true",
        "case": "an empty #-key list matches nothing",
    },
]

CASE_PATTERN = re.compile(r"^\s*(?:test|it)\(\s*(['\"])(.*?)\1", re.M)


def sha256(path):
    with open(path, "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()


def suite_cases():
    """Every case title in the module's suite: (file, title), in file order."""
    cases = []
    for name in sorted(os.listdir(TS)):
        if not name.endswith(".test.ts"):
            continue
        with open(os.path.join(TS, name), encoding="utf-8") as handle:
            text = handle.read()
        for match in CASE_PATTERN.finditer(text):
            cases.append((name, match.group(2)))
    return cases


def resolve(prefix, cases):
    """The single case a prefix addresses, or a list explaining why it does not."""
    hits = [case for case in cases if case[1].startswith(prefix)]
    return hits


def run_case(case, title):
    """Run one case; return (exit code, output, the command it ran)."""
    pattern = re.escape(title)
    command_line = "%s test %s -t %s" % (BUN, case, pattern)
    proc = subprocess.run(
        [BUN, "test", case, "-t", pattern],
        cwd=TS,
        capture_output=True,
        text=True,
        timeout=600,
    )
    return proc.returncode, (proc.stdout + proc.stderr).strip(), command_line


def did_not_run(output):
    """True when the runner reports that the filter matched no case at all.

    A non-zero exit from "matched 0 tests" is a name mismatch, not a failing
    assertion: it says nothing about the invariant, so it can never be evidence
    that the invariant is covered.
    """
    return "matched 0 tests" in output or "0 tests matched" in output


def main():
    cases = suite_cases()
    lines = []
    lines.append("event-store module — invariant falsification")
    lines.append("# command:   python3 event-store/evidence/falsify.py > event-store/evidence/02-invariant-falsification.txt")
    lines.append("# generated: %s" % subprocess.run(["date", "-u", "+%Y-%m-%dT%H:%M:%SZ"], capture_output=True, text=True).stdout.strip())
    lines.append("# bun:       %s" % subprocess.run([BUN, "--version"], capture_output=True, text=True).stdout.strip())
    lines.append("# cases in the suite: %d across %d files" % (len(cases), len({case[0] for case in cases})))
    lines.append("#")
    lines.append("# For each named invariant: one mutation is applied, the named case is run, the file is")
    lines.append("# restored byte-for-byte (sha256 verified) and the case is run again. A mutation whose")
    lines.append("# case does NOT fail is reported FALSIFICATION FAILED. Run serialized: for the length of")
    lines.append("# one mutation the tree is deliberately broken.")
    lines.append("")

    failures = 0
    for index, mutation in enumerate(MUTATIONS, 1):
        path = os.path.join(TS, mutation["file"])
        original = open(path, encoding="utf-8").read()
        before = sha256(path)
        anchor = mutation["anchor"]
        occurrences = original.count(anchor)

        lines.append("=" * 78)
        lines.append("mutation %d — %s" % (index, mutation["invariant"]))
        lines.append("breaks:   %s" % mutation["why"])
        lines.append("file:     event-store/ts/%s" % mutation["file"])
        lines.append("sha256:   %s (before)" % before)
        lines.append("anchor occurrences: %d (must be exactly 1)" % occurrences)
        lines.append("")

        if occurrences != 1:
            lines.append("RESULT: FALSIFICATION FAILED — the anchor is not unique in %s" % mutation["file"])
            lines.append("")
            failures += 1
            continue

        hits = resolve(mutation["case"], cases)
        if len(hits) != 1:
            lines.append("RESULT: FALSIFICATION FAILED — the prefix %r matched %d case(s), not 1" % (mutation["case"], len(hits)))
            for name, title in hits:
                lines.append("        matched: %s · %s" % (name, title))
            lines.append("")
            failures += 1
            continue

        case_file, title = hits[0]
        lines.append("case:     %s · %s" % (case_file, title))
        lines.append("$ the mutation applied (old -> new):")
        lines.append("- %s" % anchor.replace("\t", "    "))
        lines.append("+ %s" % mutation["broken"].replace("\t", "    "))
        lines.append("")

        try:
            open(path, "w", encoding="utf-8").write(original.replace(anchor, mutation["broken"], 1))
            code, output, command_line = run_case(case_file, title)
        finally:
            open(path, "w", encoding="utf-8").write(original)

        after = sha256(path)
        lines.append("$ %s" % command_line)
        lines.append(output)
        lines.append("exit: %d" % code)
        lines.append("")
        lines.append("$ sha256 after restore: %s (must equal the line above)" % after)
        lines.append("restore verified: %s" % ("yes" if after == before else "NO — THE FILE WAS NOT RESTORED"))
        lines.append("")

        never_ran = did_not_run(output)
        broke_it = code != 0 and not never_ran
        lines.append(
            "RESULT: %s — %s"
            % (
                (
                    "FALSIFICATION FAILED (the case never ran)"
                    if never_ran
                    else "FALSIFIED (the invariant is really covered)"
                    if broke_it
                    else "FALSIFICATION FAILED (the case stayed green)"
                ),
                (
                    "the filter matched no case, so this row proves nothing about the invariant and is counted as a failure"
                    if never_ran
                    else "the named case failed under the mutation"
                    if broke_it
                    else "the named case did not fail under the mutation"
                ),
            )
        )
        if not broke_it:
            failures += 1
        if after != before:
            failures += 1

        code_after, output_after, _ = run_case(case_file, title)
        restored_green = code_after == 0 and not did_not_run(output_after)
        lines.append("")
        lines.append("$ ...and the same case on the restored file:")
        lines.append(output_after)
        lines.append("exit: %d   (0 = green again)" % code_after)
        lines.append(
            "the case is green again on the restored file: %s"
            % ("yes" if restored_green else "NO — the case does not pass on the restored tree, which is not the mutation's doing and is counted as a failure")
        )
        lines.append("")
        if not restored_green:
            failures += 1

    lines.append("=" * 78)
    lines.append("%d mutation(s) applied, %d falsification failure(s)" % (len(MUTATIONS), failures))
    lines.append("every mutated file was restored and its sha256 verified; the module's tree is as it was before this run.")
    print("\n".join(lines))

    print("")
    print("%d mutation(s), %d falsification failure(s)" % (len(MUTATIONS), failures))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
