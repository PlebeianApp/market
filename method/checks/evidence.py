#!/usr/bin/env python3
"""evidence.py — the evidence-script lint.

    python3 checks/evidence.py --root .                 # every evidence script under the root
    python3 checks/evidence.py --root . --quiet         # the summary line only

**Why this exists.** Twice now a run has published a check that was *green because it never ran*: a
`bun test -t "<case name>"` whose name was read as a regular expression and matched no test at all (so every
later "the named case fails when the fix is removed" row was scored from a nonzero exit that meant *nothing
matched*), and an evidence script that wrote its own capture **in place** (`exec > .../04-….txt`), so merely
running it made the tree dirty and overwrote the committed evidence it was supposed to regenerate. Both were
found by a reviewer rather than by the routine, and both are properties of the script, not of its author's
intent. This is the machine part for that class: cheap, mechanical, and worth never doing by hand.

**What it enforces, and why each rule is a rule**

1. **Non-destructive (hard).** An evidence script *prints*; the caller redirects. A script that writes into
   the tree cannot be run twice — the second run overwrites what the first one proved — and it turns a read
   into a write. `exec >` to anything but `/dev/null`, and a redirect or `tee` whose target is a **tracked**
   file, are the two forms that have actually happened.
2. **Fails loudly (hard).** A failed read must not be scored as a result. Without `set -e`, a `grep` on a path
   that does not exist prints an error, exits nonzero, and the script carries on to print a plausible
   number — which is exactly the "green because nothing was read" defect in its most common disguise.
3. **Tools that are not on `PATH` are spelled absolutely (hard).** In this environment `bun` is not on
   `PATH`; a script that says `bun test` works in the author's shell and fails in the run's. A `PATH=`
   assignment in the script is the other accepted form.
4. **The subject is asserted (note).** A script should say somewhere that what it is about to read exists.
   Advisory rather than hard, because a legitimate script may create its own subject.
5. **A named test run must prove it matched something (note).** A runner filter that matches no case must be
   a failure, never a pass. Advisory, because only the author knows whether a filter was meant to match.

The lint reports; it does not edit. Its own honesty rule is the routine's (`#b2f0a2`): it never rewrites a
script to make itself pass.
"""

import argparse
import os
import re
import subprocess
import sys

HARD = "HARD"
NOTE = "NOTE"

# The tools this environment has bitten us with: a bare invocation works in an author's shell and not here.
OFF_PATH = ("bun", "node", "bunx", "npx")

DESTRUCTIVE = [
    # exec > FILE  /  exec >> FILE   (the in-place capture)
    (re.compile(r"^\s*exec\s+>>?\s*(?P<target>[^\s;]+)"), "exec redir"),
    # a redirect or tee whose literal target is a tracked file
    (re.compile(r"(?:\s|^)>>?\s*(?P<target>[\w./-]+\.(?:txt|md|json|csv|log))"), "redirect"),
    (re.compile(r"\|\s*tee\s+(?:-a\s+)?(?P<target>[\w./-]+)"), "tee"),
]

SUBJECT_GUARD = re.compile(
    r"\[\s*-(?:e|d|f|r|s)\s|test\s+-(?:e|d|f|r|s)\s|command\s+-v\s|git\s+cat-file\s+-e|which\s"
)

FILTERED_RUN = re.compile(r"(?:\bbun\b|\bnode\b|\bpytest\b|\bvitest\b)[^\n]*\s-(?:t|k)\s|\-\-test-name-pattern")


def submodules(root):
    """Top-level directories that are mounts. A mounted specimen is read, not checked (`#17e5f0`)."""
    names = []
    path = os.path.join(root, ".gitmodules")
    if not os.path.isfile(path):
        return names
    with open(path, encoding="utf-8", errors="replace") as handle:
        for line in handle:
            match = re.match(r"\s*path\s*=\s*(\S+)", line)
            if match:
                names.append(match.group(1).strip("/").split("/")[0])
    return names


def tracked(root, target):
    """Is the literal target a file git knows about? A redirection to one is destructive."""
    if target.startswith("/dev/") or target.startswith("$") or target.startswith("-"):
        return False
    probe = os.path.join(root, target)
    try:
        result = subprocess.run(
            ["git", "-C", root, "ls-files", "--error-unmatch", os.path.relpath(probe, root)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return result.returncode == 0
    except OSError:
        return os.path.isfile(probe)


def lint(path, root):
    findings = []
    with open(path, encoding="utf-8", errors="replace") as handle:
        lines = handle.read().splitlines()

    body = [l for l in lines if l.strip() and not l.strip().startswith("#")]
    head = "\n".join(body[:12])

    # 1 — non-destructive
    for number, line in enumerate(lines, start=1):
        if line.strip().startswith("#"):
            continue
        for pattern, _kind in DESTRUCTIVE:
            match = pattern.search(line)
            if not match:
                continue
            target = match.group("target")
            if _kind == "exec redir" and target in ("/dev/null", "&1", "&2"):
                continue
            if _kind != "exec redir" and not tracked(root, target):
                continue
            findings.append(
                (
                    HARD,
                    number,
                    f"writes into the tree ({line.strip()}) — an evidence script prints; the caller "
                    f"redirects. A script that writes cannot be run twice.",
                )
            )

    # 2 — fails loudly
    if not re.search(r"^\s*set\s+-[a-z]*e", head, re.MULTILINE):
        findings.append(
            (
                HARD,
                0,
                "no `set -e` — a failed read is scored as a result instead of stopping the script. "
                "Two remedies, the author's choice: `set -e` with `|| true` only where a non-match is "
                "*intended*, or an explicit assertion on each read whose outcome matters.",
            )
        )
    elif not re.search(r"^\s*set\s+-[a-z]*e[a-z]*u", head, re.MULTILINE):
        findings.append((NOTE, 0, "`set -e` without `-u`; an unset variable reads as empty."))

    # 3 — tools off PATH spelled absolutely
    if "PATH=" not in "\n".join(lines):
        for number, line in enumerate(lines, start=1):
            for tool in OFF_PATH:
                if re.search(rf"(?:^|[\s;&|(]){tool}\s", line) and not re.search(
                    rf"/{tool}\b|\$HOME/\.bun/bin", line
                ):
                    findings.append(
                        (
                            HARD,
                            number,
                            f"`{tool}` invoked without an absolute path and no `PATH=` in the script — "
                            f"`{tool}` is not on this environment's PATH.",
                        )
                    )

    # 4 — the subject is asserted
    if not SUBJECT_GUARD.search("\n".join(lines)):
        findings.append((NOTE, 0, "no existence guard for the subject it reads."))

    # 5 — a named test run must prove it matched something
    for number, line in enumerate(lines, start=1):
        if FILTERED_RUN.search(line):
            findings.append(
                (
                    NOTE,
                    number,
                    "a name-filtered test run — assert it matched at least one case, or a filter that "
                    "matches nothing is scored as a pass.",
                )
            )

    return findings


def main():
    parser = argparse.ArgumentParser(description="the evidence-script lint")
    parser.add_argument("--root", default=".", help="the tree to walk")
    parser.add_argument("--glob", default="evidence/*.sh", help="what counts as an evidence script")
    parser.add_argument("--quiet", action="store_true", help="the summary line only")
    args = parser.parse_args()

    root = os.path.abspath(args.root)
    mounts = submodules(root)

    scripts = []
    for base, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in (".git", "node_modules")]
        rel = os.path.relpath(base, root)
        if rel != "." and rel.split(os.sep)[0] in mounts:
            dirs[:] = []
            continue
        if os.path.basename(base) != "evidence":
            continue
        for name in sorted(files):
            if name.endswith(".sh"):
                scripts.append(os.path.join(base, name))

    hard = note = 0
    for path in sorted(scripts):
        findings = lint(path, root)
        if not findings:
            if not args.quiet:
                print(f"  ok    {os.path.relpath(path, root)}")
            continue
        if not args.quiet:
            print(f"  ----  {os.path.relpath(path, root)}")
        for level, number, message in findings:
            where = f":{number}" if number else ""
            print(f"  {level:4}  {os.path.relpath(path, root)}{where}  {message}")
            if level == HARD:
                hard += 1
            else:
                note += 1

    print(f"evidence: {len(scripts)} script(s) checked, {hard} hard finding(s), {note} note(s)")
    return 1 if hard else 0


if __name__ == "__main__":
    sys.exit(main())
