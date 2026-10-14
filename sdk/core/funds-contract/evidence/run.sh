#!/usr/bin/env bash
#
# funds-contract/evidence/run.sh — regenerates this module's build-and-check evidence.
#
# It **prints**; the caller redirects:
#
#     bash funds-contract/evidence/run.sh > funds-contract/evidence/01-contract-refs.txt
#
# It writes nothing into the tree and installs nothing. Every section below reports a command's own
# output with its exit code, and the sections that assert a property exit non-zero with the offending
# value shown — a section that cannot fail is a printout, not evidence.
#
# This module ships a **types-only** implementation (`implementation: present-for-types-only`): it
# declares the port's types and performs nothing. The load-bearing gate for a type surface is the
# typecheck, and both `bun test` and `bun run typecheck` are run by the module verifier
# (`bun launcher/plebctl.ts module funds-contract verify`, which installs first). The evidence here is
# the checker's and the surface's: the contract's statements exist and resolve, no value export enters
# the types-only surface (so the module really does perform nothing), a descendant cites the contract
# while the contract's declaring lines cite no descendant, and the mounted sources are untouched.
set -euo pipefail
export LC_ALL=C

MODULE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ASSEMBLY="$(cd "$MODULE/.." && pwd)"
BUN="${BUN:-$HOME/.bun/bin/bun}"
export PATH="$(dirname "$BUN"):$PATH"

for path in "$MODULE/funds-contract.md" "$MODULE/ts/index.ts" "$MODULE/ts/types.ts" "$MODULE/ts/port.test.ts"; do
	[ -f "$path" ] || {
		echo "missing subject: $path" >&2
		exit 1
	}
done

banner() { printf '\n===== %s =====\n' "$1"; }

run_in() {
	local dir="$1"
	shift
	local code=0 out
	out="$(cd "$dir" && "$@" 2>&1)" || code=$?
	printf '$ (cd %s && %s)\n' "${dir#"$ASSEMBLY/"}" "$*"
	printf '%s\n' "${out:-（no output）}"
	printf 'exit: %s\n' "$code"
	[ "$code" -eq 0 ]
}

banner "funds-contract — the types-only contract, checked"
echo "# module: $MODULE"

banner "0 · the types-only surface — no value export, so the module performs nothing"
# A types-only module must have no behaviour: every top-level export in the surface is a type. A value
# export (a function, a class, a const, a mutable binding) would be behaviour, and this section fails on
# it. It is non-vacuous: adding `export function noop() {}` to either file fails the run.
python3 - "$MODULE/ts/index.ts" "$MODULE/ts/types.ts" <<'PY_TYPES_ONLY'
import re
import sys

VALUE_EXPORT = re.compile(r"\s*export\s+(?!type\b)(?:async\s+)?(function|class|const|let|var|enum)\b")

bad = []
for path in sys.argv[1:]:
    lines = open(path, encoding="utf-8").read().split("\n")
    for i, line in enumerate(lines, 1):
        if VALUE_EXPORT.match(line):
            bad.append("%s:%d  %s" % (path, i, line.strip()))

if bad:
    raise SystemExit("a value export enters the types-only surface:\n" + "\n".join(bad))
print("surface files: %s" % ", ".join(sys.argv[1:]))
print("value exports: 0 — the module is types-only and performs nothing")
PY_TYPES_ONLY

banner "1 · the checker over the tree (any docs/ findings belong to another workstream)"
# check.py exits non-zero on any hard finding. An unrelated, untouchable file
# docs/REVIEW-over-engineering-2026-10-07.md has carried six-hex colour literals that read as statement
# citations (four dangling references when it is present). They are named and separated here; the
# assertion is that THIS module adds none, whether or not that file is present.
set +e
CHECK_OUT="$(cd "$ASSEMBLY" && python3 -B core/checks/check.py --root . 2>&1)"
CHECK_CODE=$?
set -e
printf '%s\n' "$CHECK_OUT"
printf 'exit: %s\n' "$CHECK_CODE"
own_hard="$(printf '%s\n' "$CHECK_OUT" | grep '  HARD  ' | grep -v 'docs/REVIEW-over-engineering-2026-10-07.md' || true)"
if [ -n "$own_hard" ]; then
	printf 'a hard finding outside the unrelated docs/ file — this module is not clean:\n%s\n' "$own_hard" >&2
	exit 1
fi
echo 'own hard findings: 0 — any docs/ findings are the unrelated file, never this module'

banner "2 · the contract's own statements, and that each resolves to itself or core"
# Import the checker with ROOT set (the same trick the run's artifacts use): importing it without ROOT
# makes it walk its own directory and report a smaller, wrong total. A statement may cite only itself,
# an ancestor, or core — so a contract statement's every token must resolve to funds-contract or core.
python3 - "$ASSEMBLY" <<'PY_CONTRACT'
import os
import sys

root = os.path.abspath(sys.argv[1])
sys.path.insert(0, os.path.join(root, "core", "checks"))
import check  # noqa: E402  (imported after the path is set, by design)
check.ROOT = root

decls, order = check.declarations()
contract = [(ident, content) for path, _i, ident, content in order if path.startswith("funds-contract/")]
if not contract:
    raise SystemExit("the contract declares no statement — every declaring line is missing or unminted")

allowed = {"funds-contract", "core"}
for ident, content in contract:
    if check.identity(content) != ident:
        raise SystemExit("identity mismatch: %s recomputes to %s" % (ident, check.identity(content)))
    for tok in check.IDREF.findall(content):
        owner = decls.get(tok, (None, None))[0]
        if owner not in allowed:
            raise SystemExit(
                "statement %s cites %s owned by %r, which is not itself or core" % (ident, tok, owner)
            )

print("funds-contract statements: %d — every token resolves to itself or core" % len(contract))
for ident, content in contract:
    print("  %s  %s" % (ident, check.norm(content)))
PY_CONTRACT

banner "3 · cited by a descendant, and citing no descendant on a declaring line"
# The contract is the shared ancestor, and the direction is one-way: a descendant may cite the contract,
# while the contract's own declaring lines may cite only itself, an ancestor, or core. The guard this
# replaces asserted the converse — "no descendant cites the contract yet" — as an I0-only rule, because a
# wrapper citing a token before the statement existed is a hard dangling reference, so the contract had to
# land first. Increment I1 is the increment that makes a descendant cite it, so that guard is false by
# design now; the invariant that stays true is asserted here both ways: (a) at least one descendant cites
# the contract, and (b) no declaring line of the contract cites a descendant. (b) reads the DECLARING LINES
# the ladder reads, not the whole file: the contract cites the wallet's ordering statement in ordinary
# prose, and a token resting in a statement body is existence-checked but never ancestry-checked — a grep
# over the file would report descendant citations that are not ones.
python3 - "$ASSEMBLY" <<'PY_DESCENDANTS'
import os
import sys

root = os.path.abspath(sys.argv[1])
sys.path.insert(0, os.path.join(root, "core", "checks"))
import check  # noqa: E402
check.ROOT = root

decls, order = check.declarations()
mods = check.modules()
tokens = {ident for path, _i, ident, _c in order if path.startswith("funds-contract/")}
if not tokens:
    raise SystemExit("the contract declares no token to check for citations")

descendants = {m for m in mods if m != "funds-contract" and "funds-contract" in check.ancestors(m, mods)}

# (a) the contract is the shared ancestor, and the edge is used: at least one descendant cites it.
cited = []
for path in check.md_files():
    if path.split(os.sep)[0] not in descendants:
        continue
    text = open(os.path.join(root, path), encoding="utf-8", errors="replace").read()
    for token in tokens:
        if token in text:
            cited.append((path, token))
print("descendant citations of the contract: %d" % len(cited))
for path, token in cited:
    print("  CITED  %s  %s" % (path, token))
if not cited:
    raise SystemExit("no descendant cites the contract — the shared ancestor is unused, and the edge is one-way, never empty")

# (b) the direction is one-way: no declaring line of the contract cites a descendant. Read the same lines
# the ladder reads — the statements' declaring lines — so a token in a statement's body is not counted.
bad = []
for path, i, ident, content in order:
    if not path.startswith("funds-contract/"):
        continue
    for tok in check.IDREF.findall(content):
        owner = decls.get(tok, (None, None))[0]
        if owner in descendants:
            bad.append((path, i, ident, tok, owner))
print("descendant citations on the contract's declaring lines: %d" % len(bad))
for path, i, ident, tok, owner in bad:
    print("  DESCENDANT  %s:%d  %s cites %s from %s" % (path, i, ident, tok, owner))
if bad:
    raise SystemExit("the contract's declaring line cites a descendant — the edge is one-way")
PY_DESCENDANTS

banner "4 · mounted sources remain untouched"
# Assert only the MOUNTS. The assembly checkout is deliberately dirty with review state, so the outer
# repo is never asserted on.
MOUNTS=("$ASSEMBLY/core" "$ASSEMBLY/plebeian-market/market")
for mount in "${MOUNTS[@]}"; do
	rel="${mount#"$ASSEMBLY/"}"
	code=0
	out="$(git -C "$mount" status --short --ignore-submodules=all)" || code=$?
	printf '$ git -C %s status --short --ignore-submodules=all\n' "$rel"
	printf '%s\n' "${out:-（clean）}"
	printf 'exit: %s\n' "$code"
	if [ "$code" -ne 0 ]; then
		echo "cannot read mount status: $rel" >&2
		exit 1
	fi
	if [ -n "$out" ]; then
		printf 'mounted source is dirty: %s\n%s\n' "$rel" "$out" >&2
		exit 1
	fi
done
echo 'mounts asserted clean: core/, plebeian-market/market/'
