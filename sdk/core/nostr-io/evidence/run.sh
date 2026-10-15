#!/usr/bin/env bash
#
# nostr-io/evidence/run.sh — regenerates the module's build-and-test evidence.
#
# It **prints**; the caller redirects:
#
#     bash nostr-io/evidence/run.sh   >   nostr-io/evidence/01-build-and-tests.txt
#
# It writes nothing into the tree (no `exec >`, no `tee`, no redirect to a file),
# it installs nothing, and it never enters a mount except to read it with git for
# the conservation lines. Every section below is a command's own output with its
# measured exit code, not a summary of one: a failed read is printed as a failure
# rather than scored as a result.
#
# Every grep is scoped to `nostr-io/ts/` and never to `nostr-io/`, so no check can
# match this record or the script that produced it.
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
for path in "$TS/index.ts" "$TS/ts.md" "$MODULE/nostr-io.md"; do
	[ -f "$path" ] || {
		echo "missing subject: $path" >&2
		exit 1
	}
done

# The implementation, named explicitly. `harness.ts` is deliberately outside it:
# it is the host side of the ports, and its `setTimeout` is the test timeout.
IMPL=(
	"$TS/index.ts" "$TS/types.ts" "$TS/errors.ts" "$TS/pool.ts" "$TS/relay-adapter.ts"
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
	banner "nostr-io — build, test and isolation evidence"
	echo "# command:   bash nostr-io/evidence/run.sh   (the caller redirects to nostr-io/evidence/01-build-and-tests.txt)"
	echo "# generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)   host: $(uname -srm)"
	echo "# bun:       $("$BUN" --version)"
	echo "# module:    $MODULE"
	echo "# note: every line below is a command's own output, not a summary of it."

	banner "0 · the mounted specimen is untouched"
	run git -C "$ASSEMBLY/market" rev-parse HEAD
	echo '# ^ expected: 56258b55e2805895c941eb879f7a3ea1308bc0c5 (the pin).'
	run git -C "$ASSEMBLY/market" status --short
	echo '# ^ expected: no lines. The module writes nowhere near the mount.'

	banner "1 · the module's own dependency store (inside nostr-io/ts only)"
	run_in "$TS" "$BUN" pm ls
	echo '# ^ expected: applesauce-relay 6.2.1 (exact, the order'"'"'s pin), one nostr-tools ~2.19, rxjs 7.8.2.'
	echo '$ python3 - <nostr-io/ts/package.json>   (the declared lists, asserted, not summarised)'
	python3 - "$TS/package.json" <<'PY'
import json, sys
manifest = json.load(open(sys.argv[1]))
deps = sorted(manifest.get("dependencies", {}))
dev = sorted(manifest.get("devDependencies", {}))
print("dependencies:    %s" % ", ".join(deps))
print("devDependencies: %s" % ", ".join(dev))
expected = ["applesauce-relay", "nostr-tools", "rxjs"]
problems = []
if deps != expected:
    problems.append("dependencies are %s, not %s" % (deps, expected))
if manifest.get("dependencies", {}).get("applesauce-relay") != "6.2.1":
    problems.append("applesauce-relay is not pinned at 6.2.1")
for key in ("dependencies", "devDependencies"):
    if "applesauce-core" in manifest.get(key, {}):
        problems.append("applesauce-core is declared in %s — the store belongs to another module" % key)
print("# ^ expected: dependencies exactly applesauce-relay 6.2.1, nostr-tools, rxjs, and applesauce-core in")
print("#   NEITHER list. applesauce-core is in node_modules only as a transitive dependency of")
print("#   applesauce-relay (see section 10) — that is expected and is not a dependency of this module.")
for problem in problems:
    print("PROBLEM: %s" % problem)
sys.exit(1 if problems else 0)
PY
	echo "exit: $?"

	banner "2 · bun test — the module's own runner over its own roots"
	run_in "$TS" "$BUN" test
	echo '# ^ expected: 24 cases in 2 files, all passing, 0 failing — the 12 the increment'
	echo '#   landed, plus the 9 the red-team repair added, plus the 3 the D1/D12 repair adds'
	echo '#   (a count that settles against a non-completing COUNT stream, an ack matched under'
	echo '#   the pool own identity, and a two-spelling target whose read settles). Six cases fail'
	echo '#   against the frozen adapter under the repaired fixture: the red half is'
	echo '#   05-before-the-repair.txt.'

	banner "3 · the module's own compiler configuration"
	run_in "$TS" "$BUN" run typecheck
	echo '# ^ expected: exit 0 and no output (`tsc --noEmit`, the pinned typescript).'
	echo '#   A runner transpiles without typechecking, so this is the case for the'
	echo '#   contract own type surface (#ba52de names rxjs Observable as the adopted stream'
	echo '#   shape, so it is permitted in a caller-facing signature): the typecheck proves the'
	echo '#   contract compiles strictly, and it neither detects nor is meant to detect a library type.'
	echo '$ the typecheck measured (budget, not a flag: D4) — the child peak RSS in KB, no /usr/bin/time on this host'
	measure="import resource,subprocess,sys; p=subprocess.run(['$BUN','run','typecheck'],cwd='$TS'); print('%d KB child peak RSS' % resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss); sys.exit(p.returncode)"
	printf '$ (cd %s && python3 -c \"%s\")\n' "${TS#"$ASSEMBLY"/}" "$measure"
	measure_code=0
	measure_out="$(cd "$TS" && python3 -c "$measure" 2>&1)" || measure_code=$?
	printf '%s\n' "$measure_out"
	printf 'exit: %s\n' "$measure_code"
	echo '# ^ expected: exit 0, and a child peak RSS of about 250 000 KB (244-250 MiB across the three measurements:'
	echo '#   D4 247 MiB on 2026-09-29, the recheck 245 MiB, this module 249). No --max-old-space-size and no'
	echo '#   needed, and the bound is a measurement rather than a promise, so a version bump that moves it shows up'
	echo '#   here instead of in a claim. The RSS figure is a volatile field: it moves by a few MiB run to run.'

	banner "4 · the independence criterion — no host import, no relative path out of the module"
	echo '# The signer module'"'"'s allow-list, applied here: every import specifier in ts/ is'
	echo '# module-relative or one of the seam'"'"'s own declared dependencies.'
	grep_expect "nostr-io/ts, the module's own sources (node_modules excluded)" "0 matched lines, exit 1" \
		"(from|module\(|import\(|require\()\s*['\"][^'\"]*(\.\./|@/|@nostr-dev-kit/)" --include='*.ts' --exclude-dir=node_modules "$TS"
	echo '# ^ the second arm: a relative specifier that leaves the module directory is a host import by shape.'

	banner "4b · every import specifier in the module, sorted and unique (the positive form)"
	echo '$ find nostr-io/ts -maxdepth 1 -name "*.ts" | wc -l'
	find "$TS" -maxdepth 1 -name '*.ts' | wc -l
	echo '# ^ the non-vacuity arm, asserted before the list is read: expected 8 (5 implementation files, harness.ts, and 2 test files).'
	own="$(find "$TS" -maxdepth 1 -name '*.ts' | wc -l)"
	[ "$own" -eq 8 ] || {
		echo "the module's own source set is $own, not 8 — the criterion's subject moved" >&2
		exit 1
	}
	specifiers="$(grep -rhoE "(from|import)[[:space:]]+[\"'][^\"']+[\"']" --include='*.ts' --exclude-dir=node_modules "$TS" |
		sed -E "s/^(from|import)[[:space:]]+[\"']?//; s/[\"']$//" | LC_ALL=C sort -u)"
	printf '$ grep -rhoE ... | sed ... | sort -u\n%s\n' "$specifiers"
	spec_count="$(printf '%s\n' "$specifiers" | grep -c . || true)"
	printf 'specifier count: %s   (the stated list; a bare zero would be the finding, not a pass)\n' "$spec_count"
	[ "$spec_count" -ge 8 ] || {
		echo "the allow-list holds only $spec_count specifier(s) for 8 files — the read found nothing" >&2
		exit 1
	}
	disallowed="$(printf '%s\n' "$specifiers" |
		grep -vE '^(\./[A-Za-z0-9._-]+|applesauce-relay(/[A-Za-z0-9._/-]+)?|nostr-tools(/[A-Za-z0-9._/-]+)?|rxjs|bun:test)$' || true)"
	# ^ the `|| true` is deliberate: a zero count here IS the finding.
	if [ -n "$disallowed" ]; then
		printf 'DISALLOWED SPECIFIER(S) — a host import, or a relative path leaving the module:\n%s\n' "$disallowed"
		exit 1
	fi
	echo '# ^ no disallowed specifier: the allow-list is ./<module file>, applesauce-relay[/…],'
	echo '#   nostr-tools[/…], rxjs, bun:test. In particular no applesauce-core: the store is not'
	echo '#   importable from this module even though it is present in node_modules.'

	banner "5 · the contract: index.ts against the module MD's front-matter"
	run grep -nE '^export' "$TS/index.ts"
	run python3 - "$MODULE/nostr-io.md" "$TS/index.ts" <<'PY'
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
	echo '$ find nostr-io/ts -maxdepth 1 -type f | sort'
	find "$TS" -maxdepth 1 -type f | xargs -n1 basename | LC_ALL=C sort
	printf 'files found: %s   (11 without the lock, 12 with it)\n' \
		"$(find "$TS" -maxdepth 1 -type f | wc -l)"
	listed="$(sed -n '/^## Inventory/,/^## /p' "$TS/ts.md" | grep -oE '^-[[:space:]]+`[^`]+`' | grep -oE '`[^`]+`' | tr -d '`' | LC_ALL=C sort -u)"
	found="$(find "$TS" -maxdepth 1 -type f | xargs -n1 basename | LC_ALL=C sort -u)"
	printf 'listed: %s   found: %s\n' \
		"$(printf '%s\n' "$listed" | grep -c . || true)" "$(printf '%s\n' "$found" | grep -c . || true)"
	run diff <(printf '%s\n' "$listed") <(printf '%s\n' "$found")
	echo '# ^ expected: exit 0. ts.md names bun.lock iff it exists, so the diff is empty'
	echo '#   rather than the lock being filtered out of the find.'

	banner "7 · the test-case count"
	echo '$ find nostr-io/ts -maxdepth 1 -name "*.test.ts" | wc -l'
	find "$TS" -maxdepth 1 -name '*.test.ts' | wc -l
	echo '$ grep -cE "^[[:space:]]*(test|it)\(" nostr-io/ts/*.test.ts   (file:count)'
	grep -cE '^[[:space:]]*(test|it)\(' "$TS"/*.test.ts
	echo '$ ... summed (the declarations; equal to the runner'"'"'s total, because every case has one literal title):'
	grep -cE '^[[:space:]]*(test|it)\(' "$TS"/*.test.ts | awk -F: '{s+=$2} END {print s" test declarations in total"}'
	echo '$ the runner'"'"'s own totals, for the same measure (bun reports on stderr, hence 2>&1):'
	run_in "$TS" bash -c "\"$BUN\" test 2>&1 | grep -E '^ *[0-9]+ (pass|fail)'"

	banner "8 · the check routine (from the assembly root)"
	run_in "$ASSEMBLY" python3 core/checks/check.py --root .
	echo '# ^ expected: 0 hard findings, 0 notes, with the module and statement counts quoted.'
	echo '$ grep -cE "^- `#[0-9a-f]{6}` —" nostr-io/nostr-io.md   (the bullet statements)'
	grep -cE '^- `#[0-9a-f]{6}` —' "$MODULE/nostr-io.md" || true
	echo '$ grep -cE "^`#[0-9a-f]{6}` —" nostr-io/nostr-io.md   (the two that open a paragraph, not a bullet)'
	grep -cE '^`#[0-9a-f]{6}` —' "$MODULE/nostr-io.md" || true
	echo '# ^ expected: 30 bullet + 2 paragraph = 32 — the twenty-nine statements the spec declared,'
	echo '#   plus the two the red-team repair added (the stated ceiling and the wall-clock deadline),'
	echo '#   plus the one the D1/D12 repair adds (D2: what a wire count over a set is), each'
	echo '#   carrying its assigned identity.'
	echo '$ grep -c "#@" nostr-io/nostr-io.md'
	grep -c '#@' "$MODULE/nostr-io.md" || true
	echo '# ^ expected 0: an unfilled placeholder is not a statement.'
	echo '$ grep -n "MAX_EVENTS_PER_READ = " nostr-io/ts/index.ts   (the stated ceiling, as an inspectable value)'
	grep -n 'MAX_EVENTS_PER_READ = ' "$TS/index.ts" || true
	echo '# ^ expected: `const MAX_EVENTS_PER_READ = 10_000`, exported in the entry value block'
	echo '#   (section 5 above) — the number the ceiling case in conformance.test.ts states. A bound is a'
	echo '#   declared value, not a number buried in a branch.'

	banner "9 · the socket primitives this module is allowed to name, and the list it must not contain"
	echo '# nostr-io IS the wire: a bare zero for socket-shaped strings would be a false criterion.'
	echo '# So the expected output is a stated list, and every hit below is named.'
	run grep -rnE 'wss?://' --include='*.ts' --exclude-dir=node_modules "$TS"
	echo '# ^ expected: 5 matched lines — two fixture constants in harness.ts (RELAY_A and RELAY_B),'
	echo '#   both on the reserved .invalid TLD and never dialled, two doc-comment lines in pool.ts'
	echo '#   naming the same spelling as the normalisation example, and one doc-comment line in'
	echo '#   conformance.test.ts naming the host spelling the ack case uses. Values and comments, not'
	echo '#   call sites: the grep below, for the call sites that would connect, is the other half of the'
	echo '#   criterion. node_modules is excluded on purpose: it is the vendor'"'"'s shipped bytes, not this module.'
	echo '$ ...and the call sites that would connect, which must be zero:'
	grep_expect "the implementation and tests" "0 matched lines, exit 1" \
		'new WebSocket|WebSocket\(|fetch\(|https?://|createServer|EventSource|serviceWorker' \
		--include='*.ts' --exclude-dir=node_modules "$TS"
	echo '# ^ 0 socket constructors, 0 fetches, 0 servers. The only connection any case can open'
	echo '#   is none: the vendor backend is driven through a stubbed RelayPool transport.'

	banner "10 · one type identity across the seam"
	run ls -d "$TS/node_modules/applesauce-relay/node_modules/nostr-tools"
	echo '# ^ expected: "No such file or directory" — a single nostr-tools copy in the tree,'
	echo '#   so `Event` is one type across the module/implementation boundary.'
	printf '$ find nostr-io/ts/node_modules -type d -name nostr-tools | sort\n'
	find "$TS/node_modules" -type d -name 'nostr-tools' | sed "s|^$ASSEMBLY/||" | LC_ALL=C sort
	echo '# ^ applesauce-core is present in this tree as a transitive dependency of applesauce-relay;'
	echo '#   it is not imported by any file in ts/ (section 4b) and not declared (section 1).'

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
	echo '#   because this increment adds a module and moves no number of the specimen.'

	banner "12 · the evidence lint — a ratchet, and this module contributes nothing to it"
	echo '# The ratchet is the finding count, not the script count: adding a script raises the'
	echo '# number of scripts checked by exactly one, and that script must contribute 0 findings.'
	echo '# baseline before this module'"'"'s script existed (MEASURED, same command):'
	echo '#   evidence: 11 script(s) checked, 7 hard finding(s), 1 note(s)'
	echo '#   (the two extra hard findings over the frozen run'"'"'s 5 are on'
	echo '#    event-store/evidence/run.sh:84 and :281, and the note on signer/evidence/probe.sh;'
	echo '#    all three pre-existing and not this run'"'"'s to retrofit)'
	run_in "$ASSEMBLY" python3 core/checks/evidence.py --root .
	echo '# ^ expected: 12 script(s) checked, the same 7 hard findings, the same 1 note, and'
	echo '#   0 findings from nostr-io/evidence/run.sh: it prints rather than redirecting, it sets'
	echo '#   `set -euo pipefail` in its first lines, it spells bun absolutely and exports PATH,'
	echo '#   and it asserts its subject before reading it.'
} 2>&1

printf 'regenerated: bash nostr-io/evidence/run.sh   (the caller redirects to nostr-io/evidence/01-build-and-tests.txt)\n' >&2
