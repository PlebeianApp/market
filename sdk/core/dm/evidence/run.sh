#!/usr/bin/env bash
#
# dm/evidence/run.sh — regenerates the module's build-and-test evidence.
#
# It **prints**; the caller redirects:
#
#     bash sdk/core/dm/evidence/run.sh > sdk/core/dm/evidence/01-build-and-tests.txt
#
# It writes nothing into the tree (`no exec >`, no `tee`), installs nothing, and every section below is a
# command's own output with its measured exit code, not a summary of one.
set -euo pipefail
export LC_ALL=C

MODULE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$(git -C "$MODULE" rev-parse --show-toplevel)"
TS="$MODULE/ts"
BUN="${BUN:-$HOME/.bun/bin/bun}"
export PATH="$(dirname "$BUN"):$PATH"

for path in "$TS/index.ts" "$MODULE/dm.md"; do
	[ -f "$path" ] || { echo "missing subject: $path" >&2; exit 1; }
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
	local dir="$1"; shift
	local code=0 out
	out="$(cd "$dir" && "$@" 2>&1)" || code=$?
	printf '$ (cd %s && %s)\n' "${dir#"$REPO"/}" "$*"
	printf '%s\n' "${out:-（no output）}"
	printf 'exit: %s\n' "$code"
}

{
	banner "dm — build, test and isolation evidence"
	echo "# command:   bash sdk/core/dm/evidence/run.sh   (the caller redirects to 01-build-and-tests.txt)"
	echo "# generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)   host: $(uname -srm)"
	echo "# bun:       $("$BUN" --version)"
	echo "# module:    ${MODULE#"$REPO"/}"
	echo "# note: every line below is a command's own output, not a summary of it."

	banner "1 · the module's own dependency store, and the declared pins (asserted, not summarised)"
	run_in "$TS" "$BUN" pm ls
	echo "# ^ expected: applesauce-common 6.2.0, applesauce-core 6.2.0, rxjs 7.8.2, nostr-tools 2.19.x."
	python3 - "$TS/package.json" <<'PY'
import json, sys
deps = json.load(open(sys.argv[1])).get("dependencies", {})
problems = []
for pkg in ("applesauce-common", "applesauce-core"):
    if deps.get(pkg) != "6.2.0":
        problems.append("%s is %r, not the exact pin \"6.2.0\"" % (pkg, deps.get(pkg)))
print("dependencies: %s" % json.dumps(deps, sort_keys=True))
print("# ^ expected: both applesauce packages EXACT (no ^, no ~).")
for p in problems:
    print("PROBLEM: %s" % p)
sys.exit(1 if problems else 0)
PY
	echo "exit: $?"

	banner "2 · bun test — the module's own runner"
	run_in "$TS" "$BUN" test
	echo "# ^ expected: 4 cases in 1 file, 4 pass, 0 fail."

	banner "3 · the module's own compiler configuration"
	run_in "$TS" "$BUN" run typecheck
	echo "# ^ expected: exit 0 and no output (tsc --noEmit, the pinned typescript)."

	banner "4 · the import allow-list (the positive list, then the negative diff)"
	own="$(find "$TS" -maxdepth 1 -name '*.ts' | wc -l)"
	echo "\$ find ts -maxdepth 1 -name '*.ts' | wc -l"
	printf '%s\n' "$own"
	echo "# ^ the non-vacuity arm, asserted before the list is read: expected 5 (adapter.ts, relay-source.ts,"
	echo "#   types.ts, index.ts, harness.ts + dm.test.ts => 6)."
	specifiers="$(grep -rhoE "(from|import)[[:space:]]+[\"'][^\"']+[\"']" --include='*.ts' --exclude-dir=node_modules "$TS" |
		sed -E "s/^(from|import)[[:space:]]+[\"']?//; s/[\"']$//" | LC_ALL=C sort -u)"
	printf '$ grep -rhoE ... | sed ... | sort -u\n%s\n' "$specifiers"
	spec_count="$(printf '%s\n' "$specifiers" | grep -c . || true)"
	printf 'specifier count: %s\n' "$spec_count"
	[ "$spec_count" -ge 6 ] || { echo "the allow-list holds only $spec_count specifier(s) — the read found nothing" >&2; exit 1; }
	disallowed="$(printf '%s\n' "$specifiers" |
		grep -vE '^(\.[A-Za-z0-9._/-]+|applesauce-core(/[A-Za-z0-9._/-]+)?|applesauce-common(/[A-Za-z0-9._/-]+)?|nostr-tools(/[A-Za-z0-9._/-]+)?|rxjs|bun:test)$' || true)"
	if [ -n "$disallowed" ]; then
		printf 'DISALLOWED SPECIFIER(S):\n%s\n' "$disallowed"
		exit 1
	fi
	echo "# ^ no disallowed specifier: ./<module file>, ../../relay-config/ts/index.ts, applesauce-core[/…],"
	echo "#   applesauce-common[/…], nostr-tools[/…], rxjs, bun:test."

	banner "5 · the contract: index.ts against dm.md's front-matter"
	run grep -nE '^export' "$TS/index.ts"
	run python3 - "$MODULE/dm.md" "$TS/index.ts" <<'PY'
import re, sys
md = open(sys.argv[1]).read()
entry = open(sys.argv[2]).read()
def listed(key):
    m = re.search(r'^  %s: \[(.*)\]$' % key, md, re.M)
    if not m:
        sys.exit('the MD declares no contract.%s list' % key)
    return sorted(part.strip() for part in m.group(1).split(','))
values, types = set(), set()
for m in re.finditer(r'export (type )?\{([^}]*)\}', entry):
    bucket = types if m.group(1) else values
    for name in m.group(2).split(','):
        name = name.strip()
        if name and not name.startswith('type '):
            bucket.add(name)
ok = True
for key, delivered in (('exports', values), ('types', types)):
    declared = set(listed(key))
    print('contract.%s: %d declared, %d delivered' % (key, len(declared), len(delivered)))
    for name in sorted(declared - delivered): print('  MISSING: %s' % name); ok = False
    for name in sorted(delivered - declared): print('  EXTRA: %s' % name); ok = False
print('the two lists are equal: %s' % ('yes' if ok else 'NO'))
sys.exit(0 if ok else 1)
PY
	echo "exit: $?"

	banner "6 · the socket primitives, and the count that must be zero"
	run grep -rnE 'wss?://' --include='*.ts' --exclude-dir=node_modules "$TS"
	echo "# ^ expected: the relay literals are fixtures in harness.ts and dm.test.ts only (seeded events),"
	echo "#   never a connect target."
	run grep -rnE 'new WebSocket|WebSocket\(|fetch\(|https?://|createServer|EventSource' --include='*.ts' --exclude-dir=node_modules "$TS"
	echo "# ^ expected: 0 socket constructors, 0 fetches, 0 servers. The component cannot dial."

	banner "7 · the acceptance greps"
	echo '$ grep -E '"applesauce-common": "6\.2\.0"' sdk/core/dm/ts/package.json'
	grep -E '"applesauce-common": "6\.2\.0"' "$TS/package.json" || true
	echo "# ^ expected: exactly 1 match (the pin is exact, not a range)."
	echo '$ grep -E '"applesauce-core": "6\.2\.0"' sdk/core/dm/ts/package.json'
	grep -E '"applesauce-core": "6\.2\.0"' "$TS/package.json" || true
	echo "# ^ expected: exactly 1 match."
}
