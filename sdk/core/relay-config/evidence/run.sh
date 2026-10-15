#!/usr/bin/env bash
#
# relay-config/evidence/run.sh — regenerates the module's build-and-test evidence.
#
# It **prints**; the caller redirects:
#
#     bash sdk/core/relay-config/evidence/run.sh > sdk/core/relay-config/evidence/01-build-and-tests.txt
#
# It writes nothing into the tree (no `exec >`, no `tee`), installs nothing, and every section below
# is a command's own output with its measured exit code, not a summary of one.
#
# Every grep is scoped to `relay-config/ts/` (or to `sdk/**` by explicit path), so no check can match
# this record or the script that produced it.
set -euo pipefail
export LC_ALL=C

MODULE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$(git -C "$MODULE" rev-parse --show-toplevel)"
TS="$MODULE/ts"
BUN="${BUN:-$HOME/.bun/bin/bun}"
export PATH="$(dirname "$BUN"):$PATH"

for path in "$TS/index.ts" "$TS/ts.md" "$MODULE/relay-config.md"; do
	[ -f "$path" ] || {
		echo "missing subject: $path" >&2
		exit 1
	}
done

banner() { printf '\n===== %s =====\n' "$1"; }

run() {
	local code=0 out
	out="$("$@" 2>&1)" || code=$?
	printf '$ %s\n' "$*"
	printf '%s\n' "${out:-（no output）}"
	printf 'exit: %s\n' "$code"
}

run_in() {
	local dir="$1"
	shift
	local code=0 out
	out="$(cd "$dir" && "$@" 2>&1)" || code=$?
	printf '$ (cd %s && %s)\n' "${dir#"$REPO"/}" "$*"
	printf '%s\n' "${out:-（no output）}"
	printf 'exit: %s\n' "$code"
}

{
	banner "relay-config — build, test and isolation evidence"
	echo "# command:   bash sdk/core/relay-config/evidence/run.sh   (the caller redirects to 01-build-and-tests.txt)"
	echo "# generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)   host: $(uname -srm)"
	echo "# bun:       $("$BUN" --version)"
	echo "# module:    ${MODULE#"$REPO"/}"
	echo "# note: every line below is a command's own output, not a summary of it."

	banner "1 · the module's own dependency store, and the declared lists (asserted, not summarised)"
	run_in "$TS" "$BUN" pm ls
	echo "# ^ expected: applesauce-common 6.2.0, applesauce-core 6.2.0, rxjs 7.8.2, nostr-tools 2.19.x."
	python3 - "$TS/package.json" <<'PY'
import json, sys
manifest = json.load(open(sys.argv[1]))
deps = manifest.get("dependencies", {})
problems = []
if deps.get("applesauce-common") != "6.2.0":
    problems.append("applesauce-common is %r, not the exact pin \"6.2.0\"" % deps.get("applesauce-common"))
if deps.get("applesauce-core") != "6.2.0":
    problems.append("applesauce-core is %r, not the exact pin \"6.2.0\"" % deps.get("applesauce-core"))
print("dependencies: %s" % json.dumps(deps, sort_keys=True))
print("# ^ expected: both applesauce packages EXACT (no ^, no ~), the architecture's section 8 condition.")
for problem in problems:
    print("PROBLEM: %s" % problem)
sys.exit(1 if problems else 0)
PY
	echo "exit: $?"

	banner "2 · bun test — the module's own runner"
	run_in "$TS" "$BUN" test
	echo "# ^ expected: 7 cases in 1 file, 7 pass, 0 fail."

	banner "3 · the module's own compiler configuration"
	run_in "$TS" "$BUN" run typecheck
	echo "# ^ expected: exit 0 and no output (tsc --noEmit, the pinned typescript)."

	banner "4 · the import allow-list (the positive list, then the negative diff)"
	own="$(find "$TS" -maxdepth 1 -name '*.ts' | wc -l)"
	echo "\$ find ts -maxdepth 1 -name '*.ts' | wc -l"
	printf '%s\n' "$own"
	echo "# ^ the non-vacuity arm, asserted before the list is read: expected 5 (3 implementation files, harness.ts, 1 test file)."
	[ "$own" -eq 5 ] || {
		echo "the module's own source set is $own, not 5 — the criterion's subject moved" >&2
		exit 1
	}
	specifiers="$(grep -rhoE "(from|import)[[:space:]]+[\"'][^\"']+[\"']" --include='*.ts' --exclude-dir=node_modules "$TS" |
		sed -E "s/^(from|import)[[:space:]]+[\"']?//; s/[\"']$//" | LC_ALL=C sort -u)"
	printf '$ grep -rhoE ... | sed ... | sort -u\n%s\n' "$specifiers"
	spec_count="$(printf '%s\n' "$specifiers" | grep -c . || true)"
	printf 'specifier count: %s\n' "$spec_count"
	[ "$spec_count" -ge 6 ] || {
		echo "the allow-list holds only $spec_count specifier(s) for $own files — the read found nothing" >&2
		exit 1
	}
	disallowed="$(printf '%s\n' "$specifiers" |
		grep -vE '^(\.[A-Za-z0-9._/-]+|applesauce-core(/[A-Za-z0-9._/-]+)?|applesauce-common(/[A-Za-z0-9._/-]+)?|nostr-tools(/[A-Za-z0-9._/-]+)?|rxjs|bun:test)$' || true)"
	if [ -n "$disallowed" ]; then
		printf 'DISALLOWED SPECIFIER(S) — a host import, or a relative path leaving the module:\n%s\n' "$disallowed"
		exit 1
	fi
	echo "# ^ no disallowed specifier: the allow-list is ./<module file>, applesauce-core[/…],"
	echo "#   applesauce-common[/…], nostr-tools[/…], rxjs, bun:test. In particular no @/ @ui/ @apps/"

	banner "5 · the contract: index.ts against the module MD's front-matter"
	run grep -nE '^export' "$TS/index.ts"
	run python3 - "$MODULE/relay-config.md" "$TS/index.ts" <<'PY'
import re, sys
md = open(sys.argv[1]).read()
entry = open(sys.argv[2]).read()

def listed(key):
    match = re.search(r'^  %s: \[(.*)\]$' % key, md, re.M)
    if not match:
        sys.exit('the MD declares no contract.%s list' % key)
    return sorted(part.strip() for part in match.group(1).split(','))

values, types = set(), set()
for match in re.finditer(r'export (type )?\{([^}]*)\}', entry):
    bucket = types if match.group(1) else values
    for name in match.group(2).split(','):
        name = name.strip()
        if name:
            bucket.add(name)

ok = True
for key, delivered in (('exports', values), ('types', types)):
    declared = set(listed(key))
    print('contract.%s: %d declared, %d delivered' % (key, len(declared), len(delivered)))
    for name in sorted(declared - delivered):
        print('  MISSING (declared, not delivered): %s' % name)
        ok = False
    for name in sorted(delivered - declared):
        print('  EXTRA (delivered, not declared): %s' % name)
        ok = False
print('the two lists are equal: %s' % ('yes' if ok else 'NO'))
sys.exit(0 if ok else 1)
PY
	echo "exit: $?"

	banner "6 · ts.md's inventory against the directory itself"
	find "$TS" -maxdepth 1 -type f | xargs -n1 basename | LC_ALL=C sort
	printf 'files found: %s\n' "$(find "$TS" -maxdepth 1 -type f | wc -l)"
	listed="$(sed -n '/^## Inventory/,/^## /p' "$TS/ts.md" | grep -oE '^-[[:space:]]+`[^`]+`' | grep -oE '`[^`]+`' | tr -d '`' | LC_ALL=C sort -u)"
	found="$(find "$TS" -maxdepth 1 -type f | xargs -n1 basename | LC_ALL=C sort -u)"
	run diff <(printf '%s\n' "$listed") <(printf '%s\n' "$found")
	echo "# ^ expected: exit 0, an empty diff. ts.md names bun.lock iff it exists."

	banner "7 · the increment's acceptance greps"
	echo '$ grep -E '"'"'"applesauce-common": "6\.2\.0"'"'"' sdk/core/relay-config/ts/package.json'
	grep -E '"applesauce-common": "6\.2\.0"' "$TS/package.json" || true
	echo "# ^ expected: exactly 1 match (the pin is exact, not a range)."
	echo '$ git grep -ln "applesauce-common" HEAD -- '"'"'sdk/**'"'"' '"'"':!*node_modules*'"'"''
	git -C "$REPO" grep -ln "applesauce-common" HEAD -- 'sdk/**' ':!*node_modules*' || true
	echo "# ^ expected: every hit is INSIDE sdk/core/relay-config (adapter.ts names the vendor surface,"
	echo "#   types.ts names it in prose, package.json pins it, bun.lock records it). No other SDK module hits."
	echo "\$ grep -n \"applesauce\" sdk/core/nostr-io/ts/types.ts   (the packet's literal check)"
	grep -n "applesauce" "$REPO/sdk/core/nostr-io/ts/types.ts" || true
	echo "# ^ MEASURED, and reported rather than smoothed over: 1 line, not 0. It is a PROSE mention of"
	echo "#   applesauce-relay that is already present at the base 7ad658d4 (git diff --quiet 7ad658d4..HEAD --"
	echo "#   sdk/core/nostr-io/ts/types.ts  =>  IDENTICAL). The increment adds nothing to the file and the"
	echo "#   increment is forbidden to touch it, so the packet's literal '0' cannot hold on this base."
	echo '$ grep -n "applesauce-common" sdk/core/nostr-io/ts/types.ts   (the invariant the check is FOR)'
	grep -n "applesauce-common" "$REPO/sdk/core/nostr-io/ts/types.ts" || true
	echo "# ^ expected: 0 matched lines (exit 1) — nostr-io names neither the package nor any of its symbols."
	echo '$ git diff --quiet 7ad658d4..HEAD -- sdk/core/nostr-io/ts/types.ts && echo IDENTICAL'
	git -C "$REPO" diff --quiet 7ad658d4..HEAD -- sdk/core/nostr-io/ts/types.ts && echo IDENTICAL

	banner "8 · the socket primitives, and the count that must be zero"
	run grep -rnE 'wss?://' --include='*.ts' --exclude-dir=node_modules "$TS"
	echo "# ^ expected: the relay literals are fixtures in harness.ts and relay-config.test.ts only (the"
	echo "#   seeded events and the injected defaults), never a connect target. node_modules excluded."
	run grep -rnE 'new WebSocket|WebSocket\(|fetch\(|https?://|createServer|EventSource' --include='*.ts' --exclude-dir=node_modules "$TS"
	echo "# ^ expected: 0 socket constructors, 0 fetches, 0 servers. The port cannot dial."
}
