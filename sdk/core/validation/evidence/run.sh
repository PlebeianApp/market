#!/usr/bin/env bash
#
# validation/evidence/run.sh — regenerates the module's build-and-test evidence.
#
# It **prints**; the caller redirects:
#
#     bash validation/evidence/run.sh   >   validation/evidence/01-build-and-tests.txt
#
# It writes nothing into the tree (no `exec >`, no `tee`, no redirect to a file),
# it installs nothing, and it never enters a mount except to read it with git for the
# conservation lines. Every section below is a command's own output with its measured
# exit code, not a summary of one: a failed read is printed as a failure rather than
# scored as a result.
#
# Every grep is scoped to `validation/ts/` and never to `validation/`, so no check can
# match this record or the script that produced it.
set -euo pipefail
# Byte-order sorting, everywhere: the diffs below compare a list extracted from the
# record against one extracted from the tree, and a locale's collation would make two
# identical sets compare as different.
export LC_ALL=C

MODULE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ASSEMBLY="$(cd "$MODULE/.." && pwd)"
TS="$MODULE/ts"
BUN="${BUN:-$HOME/.bun/bin/bun}"
export PATH="$(dirname "$BUN"):$PATH"

# The subject is asserted before it is read: a script that reads a path it never checked
# prints a plausible number for a missing subject.
for path in "$TS/index.ts" "$TS/validator.ts" "$TS/bounds.ts" "$TS/ts.md" "$MODULE/validation.md"; do
	[ -f "$path" ] || {
		echo "missing subject: $path" >&2
		exit 1
	}
done

# The implementation, named explicitly. `harness.ts` is deliberately outside it: it is the
# host side of the ports, and its `setTimeout` is a fixture's, not a bound's.
IMPL=(
	"$TS/index.ts" "$TS/types.ts" "$TS/errors.ts" "$TS/presets.ts"
	"$TS/bounds.ts" "$TS/resolve.ts" "$TS/format.ts" "$TS/validator.ts"
)

banner() { printf '\n===== %s =====\n' "$1"; }

# Run a command, print it with its own output and its measured exit code. The code
# survives because it is captured with `|| code=$?` and printed, never read from the
# shell's last status.
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

# A grep whose expected result is a stated number of lines and a stated exit code: the
# output IS the criterion, so both are printed.
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
	banner "validation — build, test and isolation evidence"
	echo "# command:   bash validation/evidence/run.sh   (the caller redirects to validation/evidence/01-build-and-tests.txt)"
	echo "# generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)   host: $(uname -srm)"
	echo "# bun:       $("$BUN" --version)"
	echo "# module:    $MODULE"
	echo "# note: every line below is a command's own output, not a summary of it."

	banner "0 · the mounted specimens are untouched"
	run git -C "$ASSEMBLY/market" rev-parse HEAD
	echo '# ^ expected: 56258b55e2805895c941eb879f7a3ea1308bc0c5 (the pin).'
	run git -C "$ASSEMBLY/market" status --short
	echo '# ^ expected: no lines. The module writes nowhere near the mount.'
	run git -C "$ASSEMBLY/core" rev-parse HEAD
	echo '# ^ expected: 1da98dabfa508bf07475b9b9add1bca581dd6e51.'
	run git -C "$ASSEMBLY/core" status --short
	echo '# ^ expected: one line at most, the pre-existing `?? checks/__pycache__/` inside the core'
	echo '#   mount; this module neither creates nor removes it.'
	echo '$ git status --short -- core market   (from the assembly root)'
	git -C "$ASSEMBLY" status --short -- core market || true
	echo '$ ...and the same count, so a rise is visible:'
	printf 'core/market lines: %s\n' "$(git -C "$ASSEMBLY" status --short -- core market | wc -l)"

	banner "1 · the module's own dependency store (inside validation/ts only)"
	run_in "$TS" "$BUN" pm ls
	echo '# ^ expected: nostr-tools 2.19.4 (one copy), typescript and @types/bun. No applesauce-core,'
	echo '#   no rxjs: the module is data-driven and needs no store and no stream.'
	echo '$ python3 - <validation/ts/package.json>   (the declared lists, asserted, not summarised)'
	python3 - "$TS/package.json" <<'PY'
import json, sys
manifest = json.load(open(sys.argv[1]))
deps = sorted(manifest.get("dependencies", {}))
dev = sorted(manifest.get("devDependencies", {}))
print("dependencies:    %s" % ", ".join(deps))
print("devDependencies: %s" % ", ".join(dev))
problems = []
if deps != ["nostr-tools"]:
    problems.append("dependencies are %s, not ['nostr-tools']" % deps)
for key in ("dependencies", "devDependencies"):
    for forbidden in ("applesauce-core", "applesauce-loaders", "applesauce-relay", "rxjs"):
        if forbidden in manifest.get(key, {}):
            problems.append("%s is declared in %s — the module is data-driven and needs no store and no stream" % (forbidden, key))
print("# ^ expected: dependencies exactly nostr-tools; applesauce-core and rxjs in NEITHER declared list.")
for problem in problems:
    print("PROBLEM: %s" % problem)
sys.exit(1 if problems else 0)
PY
	echo "exit: $?"

	banner "2 · bun test — the module's own runner over its own roots"
	run_in "$TS" "$BUN" test
	echo '# ^ expected: 32 cases in 1 file, all passing, 0 failing — one case per evidence obligation,'
	echo '#   each naming the careless implementation it fails on.'

	banner "3 · the module's own compiler configuration"
	run_in "$TS" bash -c "HOME=\"$HOME\" \"$BUN\" run typecheck"
	echo '# ^ expected: exit 0 and no output (`tsc --noEmit`, the pinned typescript).'
	echo '#   A runner transpiles without typechecking, so this is the case for the contract surface:'
	echo '#   a renamed or missing export, or a type that stops matching the spec, fails here.'

	banner "4 · the independence criterion — no host import, no relative path out of the module"
	echo '# The signer module'"'"'s allow-list, applied here: every import specifier in ts/ is'
	echo '# module-relative or one of this module'"'"'s own declared dependencies.'
	grep_expect "validation/ts, the module's own sources (node_modules excluded)" "0 matched lines, exit 1" \
		"(from|module\(|import\(|require\()\s*['\"][^'\"]*(\.\./|@/|@nostr-dev-kit/)" --include='*.ts' --exclude-dir=node_modules "$TS"
	echo '# ^ the second arm: a relative specifier that leaves the module directory is a host import by shape.'

	banner "4b · every import specifier in the module, sorted and unique (the positive form)"
	echo '$ find validation/ts -maxdepth 1 -name "*.ts" | wc -l'
	find "$TS" -maxdepth 1 -name '*.ts' | wc -l
	echo '# ^ the non-vacuity arm, asserted before the list is read: expected 10 (8 implementation files,'
	echo '#   harness.ts, and 1 test file).'
	own="$(find "$TS" -maxdepth 1 -name '*.ts' | wc -l)"
	[ "$own" -eq 10 ] || {
		echo "the module's own source set is $own, not 10 — the criterion's subject moved" >&2
		exit 1
	}
	specifiers="$(grep -rhoE "(from|import)[[:space:]]+[\"'][^\"']+[\"']" --include='*.ts' --exclude-dir=node_modules "$TS" |
		sed -E "s/^(from|import)[[:space:]]+[\"']?//; s/[\"']\$//" | LC_ALL=C sort -u)"
	printf '$ grep -rhoE ... | sed ... | sort -u\n%s\n' "$specifiers"
	spec_count="$(printf '%s\n' "$specifiers" | grep -c . || true)"
	printf 'specifier count: %s   (the stated list; a bare zero would be the finding, not a pass)\n' "$spec_count"
	[ "$spec_count" -ge 8 ] || {
		echo "the allow-list holds only $spec_count specifier(s) for 10 files — the read found nothing" >&2
		exit 1
	}
	disallowed="$(printf '%s\n' "$specifiers" |
		grep -vE '^(\./[A-Za-z0-9._-]+|nostr-tools(/[A-Za-z0-9._/-]+)?|rxjs|bun:test)$' || true)"
	# ^ the `|| true` is deliberate: a zero count here IS the finding.
	if [ -n "$disallowed" ]; then
		printf 'DISALLOWED SPECIFIER(S) — a host import, a sibling package, or a relative path leaving the module:\n%s\n' "$disallowed"
		exit 1
	fi
	echo '# ^ no disallowed specifier: the allow-list is ./<module file>, nostr-tools[/…], rxjs, bun:test.'
	echo '#   In particular no applesauce-core, no sibling path, and no app import.'

	banner "5 · the contract: index.ts against the module MD's front-matter"
	run grep -nE '^export' "$TS/index.ts"
	run python3 - "$MODULE/validation.md" "$TS/index.ts" <<'PY'
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
	echo '# ^ the runtime list: values only, and the same three the MD declares as exports.'

	banner "6 · ts/ts.md's inventory against the directory itself"
	echo '$ find validation/ts -maxdepth 1 -type f | sort'
	find "$TS" -maxdepth 1 -type f | xargs -n1 basename | LC_ALL=C sort
	printf 'files found: %s   (13 without an install and no bun.lock, 14 with one)\n' \
		"$(find "$TS" -maxdepth 1 -type f | wc -l)"
	listed="$(sed -n '/^## Inventory/,/^## /p' "$TS/ts.md" | grep -oE '^-[[:space:]]+`[^`]+`' | grep -oE '`[^`]+`' | tr -d '`' | LC_ALL=C sort -u)"
	found="$(find "$TS" -maxdepth 1 -type f | xargs -n1 basename | LC_ALL=C sort -u)"
	printf 'listed: %s   found: %s\n' \
		"$(printf '%s\n' "$listed" | grep -c . || true)" "$(printf '%s\n' "$found" | grep -c . || true)"
	run diff <(printf '%s\n' "$listed") <(printf '%s\n' "$found")
	echo '# ^ expected: exit 0. ts.md names bun.lock iff it exists, so the diff is empty in both tiers.'

	banner "7 · the test-case count"
	echo '$ find validation/ts -maxdepth 1 -name "*.test.ts" | wc -l'
	find "$TS" -maxdepth 1 -name '*.test.ts' | wc -l
	echo '$ grep -hcE "^[[:space:]]*(test|it)\(" validation/ts/*.test.ts   (one count per file, -h so a single file still sums)'
	grep -hcE '^[[:space:]]*(test|it)\(' "$TS"/*.test.ts
	echo '$ ... summed (the declarations; equal to the runner'"'"'s total, because every case has one literal title):'
	grep -hcE '^[[:space:]]*(test|it)\(' "$TS"/*.test.ts | awk '{s+=$1} END {print s" test declarations in total"}'
	echo '$ the runner'"'"'s own totals, for the same measure (bun reports on stderr, hence 2>&1):'
	run_in "$TS" bash -c "\"$BUN\" test 2>&1 | grep -E '^ *[0-9]+ (pass|fail)'"

	banner "8 · the check routine (from the assembly root)"
	run_in "$ASSEMBLY" python3 core/checks/check.py --root .
	echo '# ^ expected: modules 10, statements 318, 0 hard findings, 0 notes — this increment adds no'
	echo '#   statement: it changes levels.implementation and amends a body beneath a declaring line.'
	echo '$ grep -cE "^- `#[0-9a-f]{6}` —" validation/validation.md   (the bullet statements)'
	grep -cE '^- `#[0-9a-f]{6}` —' "$MODULE/validation.md" || true
	echo '$ grep -c "#@" validation/validation.md   (an unfilled placeholder is not a statement)'
	grep -c '#@' "$MODULE/validation.md" || true
	echo '# ^ expected 0: no new statement was needed, so no placeholder was written.'
	echo '$ git diff -U0 -- validation/validation.md | grep -E "^[+-]- `#"   (edited declaring lines)'
	git -C "$ASSEMBLY" diff -U0 -- validation/validation.md | grep -E '^[+-]- `#' || true
	echo '# ^ expected: no lines. The declaring lines must not be edited, ever; the amendment lands in the'
	echo '#   body beneath `#cb7159` and the front-matter edits are `levels.implementation` and'
	echo '#   `levels.tests` alone.'
	echo '$ git diff -U0 -- validation/validation.md | grep -E "^[+-]  implementation:"   (the front-matter edit)'
	git -C "$ASSEMBLY" diff -U0 -- validation/validation.md | grep -E '^[+-]  implementation:' || true
	echo '# ^ expected: exactly the one before/after pair for `levels.implementation`, and nothing else in'
	echo '#   the front matter.'
	echo '$ grep -cE "^\*\*(Amended|Corrected) 2026-09-30" validation/validation.md   (amendment paragraphs)'
	grep -cE '^\*\*(Amended|Corrected) 2026-09-30' "$MODULE/validation.md" || true
	echo '# ^ a census: the amendments the spec closure wrote earlier, the bounded/deadline amendment, the'
	echo '#   two D-O24/D-O25 amendments, this increment'"'"'s build-landed amendment and the I4b repair'"'"'s.'

	banner "9 · no socket, no host global, and the one bound timer"
	grep_expect "the implementation (8 files, harness.ts excluded)" \
		"1 matched line — the default clock in validator.ts" \
		"Date\.now|setInterval|globalThis|window\.|document\.|localStorage|indexedDB|WebSocket|wss?://|createServer|EventSource|serviceWorker|fetch\(" \
		"${IMPL[@]}"
	echo '# ^ the one permitted line is the default clock: `{ now: () => Date.now() }` in validator.ts.'
	echo '#   Bound 6 is a revisit gate (`now - lastAttemptAt >= intervalMs`), so a clock frozen at a'
	echo '#   constant makes it unsatisfiable forever — a declared bound with no mechanism in a supported'
	echo '#   configuration. The default is therefore a real clock, the same shape the store'"'"'s own'
	echo '#   `SYSTEM_CLOCK` takes (`event-store/ts/store.ts`), and it is this module'"'"'s one host read.'
	echo '#   A second line is a finding; a missing line means the clock default moved and this criterion'
	echo '#   moved with it. 0 sockets, 0 host storage, 0 fetches, and 0 globals other than that clock.'
	echo '$ ...and the one timer the spec allows — the bound'"'"'s own wall-clock wait:'
	run grep -nE 'setTimeout|clearTimeout' "${IMPL[@]}"
	echo '# ^ expected: 3 matched lines, all in bounds.ts (`withDeadline`: one arm, two clears). A bound is on'
	echo '#   how long this module waits for a resolver the host injected, never on the network it does not'
	echo '#   touch (`#4b58be`). No other file in the implementation holds a timer.'

	banner "10 · one dependency, one type identity, no sibling import"
	run ls -d "$TS/node_modules/nostr-tools"
	echo '$ find validation/ts/node_modules -type d -name nostr-tools | sort'
	find "$TS/node_modules" -type d -name 'nostr-tools' | sed "s|^$ASSEMBLY/||" | LC_ALL=C sort
	echo '# ^ expected: a single nostr-tools copy, so `Event` is one structural type across the port boundary.'
	run ls -d "$TS/node_modules/applesauce-core" "$TS/node_modules/rxjs"
	echo '# ^ expected: "No such file or directory" for both — the module declared neither and installed neither.'
	echo '$ grep -rnE "@plebeian-apps/|applesauce" validation/ts --include="*.ts" --exclude-dir=node_modules'
	grep -rnE '@plebeian-apps/|applesauce' --include='*.ts' --exclude-dir=node_modules "$TS" || true
	echo '# ^ expected: no lines. Neither a sibling module nor the vendor store is named anywhere in ts/.'

	banner "11 · conservation: the specimens are at their pins, with their own numbers"
	echo '$ git -C market rev-parse HEAD   /   git -C core rev-parse HEAD'
	git -C "$ASSEMBLY/market" rev-parse HEAD
	git -C "$ASSEMBLY/core" rev-parse HEAD
	echo '$ git -C market status --short | wc -l'
	git -C "$ASSEMBLY/market" status --short | wc -l
	echo '$ wc -l < market/src/lib/stores/ndk.ts'
	wc -l <"$ASSEMBLY/market/src/lib/stores/ndk.ts"
	echo '$ cat market/scripts/ndk-baseline.txt'
	cat "$ASSEMBLY/market/scripts/ndk-baseline.txt"
	echo ''
	echo '# ^ expected: the two pins, 0, 1055, 161 — identical before and after, because this increment'
	echo '#   adds a module and moves no number of either specimen.'

	banner "12 · the evidence lint — a ratchet, and this module contributes nothing to it"
	echo '# The ratchet is the finding count, not the script count: the lint counts `evidence/*.sh`, so this'
	echo '# module adds exactly one script — `falsify.py` is not a `.sh` and is not linted — and that one'
	echo '# script must contribute 0 findings.'
	echo '# baseline before this module'"'"'s script existed (MEASURED, same command):'
	echo '#   evidence: 13 script(s) checked, 7 hard finding(s), 1 note(s)'
	run_in "$ASSEMBLY" python3 core/checks/evidence.py --root .
	echo '# ^ expected: 14 script(s) checked, the same 7 hard findings, the same 1 note, and 0 findings from'
	echo '#   validation/evidence/run.sh: it prints rather than redirecting, it sets `set -euo pipefail` in'
	echo '#   its first lines, it spells bun absolutely and exports PATH, and it asserts its subject first.'
} 2>&1

printf 'regenerated: bash validation/evidence/run.sh   (the caller redirects to validation/evidence/01-build-and-tests.txt)\n' >&2
