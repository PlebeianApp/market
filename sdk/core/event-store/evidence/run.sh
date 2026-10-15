#!/usr/bin/env bash
#
# event-store/evidence/run.sh — regenerates the module's build-and-test evidence.
#
# It **prints**; the caller redirects:
#
#     bash event-store/evidence/run.sh > event-store/evidence/01-build-and-tests.txt
#
# It writes nothing into the tree (no `exec >`, no `tee`, no redirect to a file),
# it installs nothing, and it never enters a mount except to read it with git for
# the conservation lines. Every section below is a command's own output with its
# exit code, not a summary of one: a failed read is printed as a failure rather
# than scored as a result.
#
# Every grep is scoped to `event-store/ts/` (or to the implementation's own file
# list) and never to `event-store/`, so no check can match this record or the
# script that produced it.
set -euo pipefail
# Byte-order sorting, everywhere: the diffs below compare a list extracted from
# the record against one extracted from the tree, and a locale's collation would
# make two identical sets compare as different.
export LC_ALL=C

MODULE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ASSEMBLY="$(cd "$MODULE/.." && pwd)"
TS="$MODULE/ts"
BUN="${BUN:-$HOME/.bun/bin/bun}"
export PATH="$(dirname "$BUN"):$PATH"

# The subject is asserted before it is read: a script that reads a path it never
# checked prints a plausible number for a missing subject.
for path in "$TS/index.ts" "$TS/store.ts" "$TS/ts.md" "$MODULE/event-store.md"; do
	[ -f "$path" ] || {
		echo "missing subject: $path" >&2
		exit 1
	}
done

# The implementation, named explicitly. `harness.ts` is deliberately outside it:
# it is the host side of the ports, and its `setTimeout` is the test timeout.
IMPL=(
	"$TS/index.ts" "$TS/types.ts" "$TS/errors.ts" "$TS/filters.ts"
	"$TS/heads.ts" "$TS/view.ts" "$TS/deletions.ts" "$TS/store.ts"
)

banner() { printf '\n===== %s =====\n' "$1"; }

# Run a command, print it with its own output and its measured exit code. The
# code survives because it is captured with `|| code=$?` and printed, never read
# from the shell's last status.
run() {
	local code=0 out
	out="$("$@" 2>&1)" || code=$?
	printf '$ %s\n' "$*"
	printf '%s\n' "${out:-（no output）}"
	printf 'exit: %s\n' "$code"
}

run_in() { # run_in <dir> <command...>
	local dir="$1"
	shift
	local code=0 out
	out="$(cd "$dir" && "$@" 2>&1)" || code=$?
	printf '$ (cd %s && %s)\n' "${dir#"$ASSEMBLY"/}" "$*"
	printf '%s\n' "${out:-（no output）}"
	printf 'exit: %s\n' "$code"
}

# A grep whose expected result is a stated number of lines and a stated exit
# code: the output IS the criterion, so both are printed.
grep_expect() { # grep_expect <label> <expected> <pattern> <path...>
	local label="$1" expected="$2" pattern="$3"
	shift 3
	local code=0 hits
	hits="$(grep -rnE "$pattern" "$@" 2>&1)" || code=$?
	printf '$ grep -rnE "%s" <%s>\n' "$pattern" "$label"
	printf '%s\n' "${hits:-（no lines）}"
	printf 'matched lines: %s   exit: %s   (expected: %s)\n' \
		"$(printf '%s' "$hits" | grep -c . || true)" "$code" "$expected"
}

{
	banner "event-store — build, test and isolation evidence"
	echo "# command:   bash event-store/evidence/run.sh > event-store/evidence/01-build-and-tests.txt"
	echo "# generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)   host: $(uname -srm)"
	echo "# bun:       $("$BUN" --version)"
	echo "# module:    $MODULE"
	echo "# note: every line below is a command's own output, not a summary of it."

	banner "0 · the mounted specimen is untouched"
	run git -C "$ASSEMBLY/market" rev-parse HEAD
	echo '# ^ expected 56258b55e2805895c941eb879f7a3ea1308bc0c5 (the pin).'
	run git -C "$ASSEMBLY/market" status --short
	echo '# ^ expected: no lines. The module writes nowhere near the mount.'

	banner "1 · the module's own dependency store (inside event-store/ts only)"
	run_in "$TS" "$BUN" pm ls
	echo '# ^ expected: applesauce-core 6.2.0 (exact, the proposal'"'"'s pin), one nostr-tools ~2.19, rxjs 7.8.2.'

	banner "2 · bun test — the module's own runner over its own roots"
	run_in "$TS" "$BUN" test
	echo '# ^ expected: 37 cases in 4 files, all passing, 0 failing.'

	banner "3 · the module's own compiler configuration"
	run_in "$TS" "$BUN" run typecheck
	echo '# ^ expected: exit 0 and no output (`tsc --noEmit`, the pinned typescript).'
	echo '#   A runner transpiles without typechecking, so this is the case for the'
	echo '#   type-level invariant M1: a library type in a caller-facing signature fails here.'

	banner "4 · the independence criterion (negative form, repaired for review B1)"
	echo '# The increment spells this over `event-store/ts` wholesale and expects 13 files and 0 matched'
	echo '# lines. That holds in TIER A. In tier B — the tier that runs here — the dependency store ships'
	echo '# its own .ts sources, so the literal form reads them: a criterion whose stated output a'
	echo '# correct execution cannot produce in this tier. Both numbers are printed below, and the'
	echo '# scoped form is the same criterion over the module'"'"'s OWN sources, which is what the'
	echo '# module'"'"'s independence means.'
	echo '$ find event-store/ts -name "*.ts" | wc -l                     # the increment'"'"'s literal form'
	find "$TS" -name '*.ts' | wc -l
	echo '$ grep -rnE "<the pattern>" --include="*.ts" event-store/ts | wc -l    # the increment'"'"'s literal form'
	grep -rnE "(from|module\(|import\(|require\()\s*['\"][^'\"]*(\.\./|@/|@nostr-dev-kit/)" --include='*.ts' "$TS" | wc -l
	echo '$ find event-store/ts -maxdepth 1 -name "*.ts" | wc -l         # the module'"'"'s own sources'
	own="$(find "$TS" -maxdepth 1 -name '*.ts' | wc -l)"
	printf '%s\n' "$own"
	[ "$own" -eq 13 ] || {
		echo "the module's own source set is $own, not 13 — the criterion's subject moved" >&2
		exit 1
	}
	echo '# ^ the file set is asserted non-empty BEFORE the grep is believed: a criterion cannot'
	echo '#   distinguish "independent" from "nothing was read". Expected: 13 of the module'"'"'s own.'
	grep_expect "event-store/ts, the module's own sources (node_modules excluded)" "0 matched lines, exit 1" \
		"(from|module\(|import\(|require\()\s*['\"][^'\"]*(\.\./|@/|@nostr-dev-kit/)" --include='*.ts' --exclude-dir=node_modules "$TS"
	echo '# ^ the third pattern is the second arm: a relative specifier that leaves the'
	echo '#   module directory is a host import by shape.'

	banner "4b · every import specifier in the module, sorted and unique (the positive form)"
	echo '$ find event-store/ts -maxdepth 1 -name "*.ts" | wc -l'
	find "$TS" -maxdepth 1 -name '*.ts' | wc -l
	echo '# ^ the non-vacuity arm, asserted before the list is read: expected 13.'
	echo '$ the increment'"'"'s literal form over the whole subtree, for the record (a count, not the list):'
	grep -rhoE "(from|import)[[:space:]]+[\"'][^\"']+[\"']" --include='*.ts' "$TS" |
		sed -E "s/^(from|import)[[:space:]]+[\"']?//; s/[\"']$//" | sort -u | wc -l
	specifiers="$(grep -rhoE "(from|import)[[:space:]]+[\"'][^\"']+[\"']" --include='*.ts' --exclude-dir=node_modules "$TS" |
		sed -E "s/^(from|import)[[:space:]]+[\"']?//; s/[\"']$//" | sort -u)"
	printf '$ grep -rhoE ... | sed ... | sort -u\n%s\n' "$specifiers"
	spec_count="$(printf '%s\n' "$specifiers" | grep -c . || true)"
	printf 'specifier count: %s   (a list shorter than the module'"'"'s own files means the read found nothing)\n' "$spec_count"
	[ "$spec_count" -ge 13 ] || {
		echo "the allow-list holds only $spec_count specifier(s) for 13 files — the read found nothing" >&2
		exit 1
	}
	disallowed="$(printf '%s\n' "$specifiers" |
		grep -vE '^(\./[A-Za-z0-9._-]+|applesauce-core(/[A-Za-z0-9._/-]+)?|nostr-tools(/[A-Za-z0-9._/-]+)?|rxjs|bun:test)$' || true)"
	# ^ the `|| true` is deliberate: a zero count here IS the finding.
	if [ -n "$disallowed" ]; then
		printf 'DISALLOWED SPECIFIER(S) — a host import, or a relative path leaving the module:\n%s\n' "$disallowed"
		exit 1
	fi
	echo '# ^ no disallowed specifier: the allow-list is ./<module file>, applesauce-core[/…],'
	echo '#   nostr-tools[/…], rxjs, bun:test. Anything else is a host import, which this module does not have.'

	banner "5 · the contract: index.ts against the module MD's front-matter"
	run grep -nE '^export' "$TS/index.ts"
	run python3 - "$MODULE/event-store.md" "$TS/index.ts" <<'PY'
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
print('# nothing in the check routine reads these keys, so this diff IS the check.')
sys.exit(0 if ok else 1)
PY
	run_in "$TS" "$BUN" -e 'import * as m from "./index.ts"; console.log(Object.keys(m).sort().join("\n"))'
	echo '# ^ the runtime list: values only, and the same ones the MD declares as exports.'

	banner "6 · ts/ts.md's inventory against the directory itself"
	echo '$ find event-store/ts -maxdepth 1 -type f | sort'
	find "$TS" -maxdepth 1 -type f | xargs -n1 basename | sort
	printf 'files found: %s   (16 without an install and no bun.lock, 17 with one)\n' \
		"$(find "$TS" -maxdepth 1 -type f | wc -l)"
	listed="$(sed -n '/^## Inventory/,/^## /p' "$TS/ts.md" | grep -oE '^-[[:space:]]+`[^`]+`' | grep -oE '`[^`]+`' | tr -d '`' | sort -u)"
	found="$(find "$TS" -maxdepth 1 -type f | xargs -n1 basename | sort -u)"
	printf 'listed: %s   found: %s\n' \
		"$(printf '%s\n' "$listed" | grep -c . || true)" "$(printf '%s\n' "$found" | grep -c . || true)"
	run diff <(printf '%s\n' "$listed") <(printf '%s\n' "$found")
	echo '# ^ expected: exit 0. ts.md names bun.lock iff it exists, so one diff is empty'
	echo '#   in both tiers rather than the lock being filtered out of the find.'

	banner "7 · the test-case count"
	echo '$ find event-store/ts -maxdepth 1 -name "*.test.ts" | wc -l'
	find "$TS" -maxdepth 1 -name '*.test.ts' | wc -l
	echo '$ grep -cE "^[[:space:]]*(test|it)\(" event-store/ts/*.test.ts   (file:count)'
	grep -cE '^[[:space:]]*(test|it)\(' "$TS"/*.test.ts
	echo '$ ... summed:'
	grep -cE '^[[:space:]]*(test|it)\(' "$TS"/*.test.ts | awk -F: '{s+=$2} END {print s" test cases in total"}'
	echo '$ the runner'"'"'s own totals, for the same measure (bun reports on stderr, hence 2>&1):'
	run_in "$TS" bash -c "$BUN test 2>&1 | grep -E '^ *[0-9]+ (pass|fail)'"

	banner "8 · the check routine (from the assembly root)"
	run_in "$ASSEMBLY" python3 core/checks/check.py --root .
	echo '# ^ expected: modules 7, statements 198 + the 16 assigned here, 0 hard findings.'
	echo '$ grep -cE "^- \`#[0-9a-f]{6}\` —" event-store/event-store.md'
	grep -cE '^- `#[0-9a-f]{6}` —' "$MODULE/event-store.md" || true
	echo '# ^ expected 16: the MD declares sixteen statements, and every one carries its assigned identity.'
	echo '$ grep -c "#@" event-store/event-store.md'
	grep -c '#@' "$MODULE/event-store.md" || true
	echo '# ^ expected 0: an unfilled placeholder is not a statement.'

	banner "9 · one type identity across the seam"
	run ls -d "$TS/node_modules/applesauce-core/node_modules/nostr-tools"
	echo '# ^ expected: "No such file or directory" — a single nostr-tools copy in the tree,'
	echo '#   so `Event` is one type across the module/implementation boundary.'
	printf '$ find event-store/ts/node_modules -type d -name nostr-tools | sort\n'
	find "$TS/node_modules" -type d -name 'nostr-tools' | sed "s|^$ASSEMBLY/||" | sort

	banner "10 · no socket, no timer, no host global — in the implementation only"
	grep_expect "the implementation (8 files, harness.ts excluded)" \
		"1 matched line — the default clock in store.ts" \
		"Date\.now|setTimeout|setInterval|clearTimeout|globalThis|window\.|document\.|localStorage|indexedDB|WebSocket|wss?://|createServer|EventSource|serviceWorker|fetch\(" \
		"${IMPL[@]}"
	echo '# ^ the one permitted line is the default clock: Math.floor(Date.now() / 1000).'
	echo '#   0 timers, 0 host globals, 0 host storage, 0 socket primitives. A second line is a'
	echo '#   finding; a missing line means the clock default moved and this criterion moved with it.'
	echo '#   harness.ts is outside the list on purpose: its setTimeout is the test timeout.'

	banner "11 · conservation: the specimen is at its pin, with its own numbers"
	echo '$ git -C market rev-parse HEAD'
	git -C "$ASSEMBLY/market" rev-parse HEAD
	echo '$ git -C market status --short | wc -l'
	git -C "$ASSEMBLY/market" status --short | wc -l
	echo '$ wc -l < market/src/lib/stores/ndk.ts'
	wc -l <"$ASSEMBLY/market/src/lib/stores/ndk.ts"
	echo '$ find market/src -type f \( -name "*.test.ts" -o -name "*.test.tsx" \) | wc -l'
	find "$ASSEMBLY/market/src" -type f \( -name '*.test.ts' -o -name '*.test.tsx' \) | wc -l
	echo '$ find market/contextvm market/src/queries/__tests__ market/src/lib/__tests__ -type f -name "*.test.ts" ! -name "*.integration.test.ts" | wc -l'
	find "$ASSEMBLY/market/contextvm" "$ASSEMBLY/market/src/queries/__tests__" "$ASSEMBLY/market/src/lib/__tests__" \
		-type f -name '*.test.ts' ! -name '*.integration.test.ts' | wc -l
	echo '$ find market/e2e/tests -name "*.spec.ts" | wc -l'
	find "$ASSEMBLY/market/e2e/tests" -name '*.spec.ts' | wc -l
	echo '$ cat market/scripts/ndk-baseline.txt'
	cat "$ASSEMBLY/market/scripts/ndk-baseline.txt"
	echo ''
	echo '# ^ expected: the pin, 0, 1055, 113, 92, 37, 161 — identical before and after,'
	echo '#   because N1 adds a module and moves no number of the specimen.'

	banner "12 · the evidence lint — a ratchet, and this module adds nothing to it"
	echo '# baseline before this module'"'"'s script existed (MEASURED, same command):'
	echo '#   evidence: 10 script(s) checked, 5 hard finding(s), 1 note(s)'
	echo '#   (runs/2026-09-28-signer/research/evidence/05-a0-remeasure.sh, 5 hard;'
	echo '#    signer/evidence/probe.sh, 1 note — both pre-existing and not this run'"'"'s to retrofit)'
	run_in "$ASSEMBLY" python3 core/checks/evidence.py --root .
	echo '# ^ expected: 11 script(s) checked, the same 5 hard findings, and 0 notes from'
	echo '#   event-store/evidence/run.sh: it prints rather than redirecting, it sets'
	echo '#   `set -euo pipefail` in its first lines, it spells bun absolutely and exports'
	echo '#   PATH, and it asserts its subject before reading it.'
} 2>&1

echo "regenerated: bash event-store/evidence/run.sh > event-store/evidence/01-build-and-tests.txt" >&2
