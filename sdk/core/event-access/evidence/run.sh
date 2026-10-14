#!/usr/bin/env bash
#
# event-access/evidence/run.sh — regenerates the module's build-and-test evidence.
#
# It **prints**; the caller redirects:
#
#     bash event-access/evidence/run.sh   >   event-access/evidence/01-build-and-tests.txt
#
# It writes nothing into the tree (no `exec >`, no `tee`, no redirect to a file),
# it installs nothing, and it never enters a mount except to read it with git for the
# conservation lines. Every section below is a command's own output with its measured
# exit code, not a summary of one: a failed read is printed as a failure rather than
# scored as a result.
#
# Every grep is scoped to `event-access/ts/` and never to `event-access/`, so no check
# can match this record or the script that produced it.
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
# The spec this increment amends was frozen at this commit. Every conservation measurement
# below is taken against it rather than against HEAD: HEAD moves whenever the orchestrator
# commits, and a guard anchored on a moving ref stops proving anything the moment it moves
# (W4a N-1).
SPEC_BASE="${SPEC_BASE:-b24dc08}"

# The subject is asserted before it is read: a script that reads a path it never checked
# prints a plausible number for a missing subject.
for path in "$TS/index.ts" "$TS/ts.md" "$MODULE/event-access.md"; do
	[ -f "$path" ] || {
		echo "missing subject: $path" >&2
		exit 1
	}
done

# The implementation, named explicitly. `harness.ts` is deliberately outside it: it is the
# host side of the two ports.
IMPL=(
	"$TS/index.ts" "$TS/types.ts" "$TS/errors.ts" "$TS/filters.ts" "$TS/merge.ts" "$TS/policy.ts" "$TS/composition.ts"
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
	banner "event-access — build, test and isolation evidence"
	echo "# command:   bash event-access/evidence/run.sh   (the caller redirects to event-access/evidence/01-build-and-tests.txt)"
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
	echo '# ^ expected: no lines of this module S own. A pre-existing `?? checks/__pycache__/` may'
	echo '#   appear inside the core mount; this module neither creates nor removes it.'
	echo '$ git status --short -- core market   (from the assembly root, the criterion of §3.11)'
	git -C "$ASSEMBLY" status --short -- core market || true
	echo '$ ...and the same count, so a rise is visible:'
	printf 'core/market lines: %s\n' "$(git -C "$ASSEMBLY" status --short -- core market | wc -l)"

	banner "1 · the module S own dependency store (inside event-access/ts only)"
	run_in "$TS" "$BUN" pm ls
	echo '# ^ expected: applesauce-loaders 6.2.0 (exact, the order S pin), one nostr-tools ~2.19,'
	echo '#   rxjs 7.8.2. applesauce-core is present ONLY as a transitive dependency of'
	echo '#   applesauce-loaders (section 10) — it is not declared and not imported here.'
	echo '$ python3 - <event-access/ts/package.json>   (the declared lists, asserted, not summarised)'
	python3 - "$TS/package.json" <<'PY'
import json, sys
manifest = json.load(open(sys.argv[1]))
deps = sorted(manifest.get("dependencies", {}))
dev = sorted(manifest.get("devDependencies", {}))
print("dependencies:    %s" % ", ".join(deps))
print("devDependencies: %s" % ", ".join(dev))
expected = ["applesauce-loaders", "nostr-tools", "rxjs"]
problems = []
if deps != expected:
    problems.append("dependencies are %s, not %s" % (deps, expected))
if manifest.get("dependencies", {}).get("applesauce-loaders") != "6.2.0":
    problems.append("applesauce-loaders is not pinned at exactly 6.2.0")
for key in ("dependencies", "devDependencies"):
    if "applesauce-core" in manifest.get(key, {}):
        problems.append("applesauce-core is declared in %s — the store belongs to another module" % key)
print("# ^ expected: dependencies exactly applesauce-loaders 6.2.0, nostr-tools, rxjs, and applesauce-core in")
print("#   NEITHER DECLARED list — applesauce-core IS in the resolved tree transitively, printed just below, so")
print("#   the criterion is about the DECLARED lists, which is how order §3.9 words it (W4a N-7). The order")
print("#   requires the applesauce-loaders install because it is what settles E6 S label.")
for problem in problems:
    print("PROBLEM: %s" % problem)
sys.exit(1 if problems else 0)
PY
	echo "exit: $?"
	echo '$ grep -n "applesauce-core" event-access/ts/bun.lock   (the RESOLVED tree: transitive, declared nowhere)'
	grep -n 'applesauce-core' "$TS/bun.lock" || true
	echo '# ^ expected: the entry/entries the one applesauce-loaders edge pulls in — a resolved dependency of the'
	echo '#   install, never a declaration of this module and never an import of any file in ts/.'

	banner "1b · E6, settled by this module S own install (UNVERIFIED -> measured)"
	echo '# The spec adopts the vendor S write-back operators as implementations of the policy and labels them'
	echo '# UNVERIFIED (the package was read from a bun-cache extraction and a sibling worktree). This install'
	echo '# is what settles the label. The measured answer is that applesauce-loaders exports NONE of the three.'
	echo '$ grep -rnE "an EXPORTED declaration of the three names" applesauce-loaders/dist'
	grep -rnE '^export declare function (mapEventsToStore|filterDuplicateEvents|storeEvents)\b|^export \{[^}]*\b(mapEventsToStore|filterDuplicateEvents|storeEvents)\b' \
		--include='*.js' --include='*.d.ts' "$TS/node_modules/applesauce-loaders/dist" || true
	echo '# ^ expected: NO lines — the package neither declares nor re-exports any of the three names. The zero is'
	echo '#   paired with the non-empty list below, which is where the two names actually come from.'
	echo '$ ...the operators the loaders IMPORT, and from where (the applesauce-core copy, a transitive dependency):'
	grep -rhoE 'import \{[^}]*\} from "applesauce-core[^"]*"' \
		--include='*.js' "$TS/node_modules/applesauce-loaders/dist/loaders" | LC_ALL=C sort -u
	echo '# ^ expected: a non-empty list importing mapEventsToStore / filterDuplicateEvents FROM applesauce-core,'
	echo '#   so the names are the store S, not the loaders S: the spec S attribution is not supported by the tree.'
	echo '$ cat applesauce-core/dist/observable/map-events-to-store.d.ts   (the shape the survey recorded)'
	cat "$TS/node_modules/applesauce-core/dist/observable/map-events-to-store.d.ts"
	echo '$ grep -rl storeEvents node_modules (the third name, in applesauce-relay, which is NOT installed here)'
	grep -rl 'storeEvents' "$TS/node_modules" --include='*.js' --include='*.d.ts' || true
	echo '# ^ expected: no lines — paired with the non-empty import list above: applesauce-relay is not a'
	echo '#   dependency of this module, so the third name could not be re-read and stays UNVERIFIED. Both'
	echo '#   facts are reported, not papered over (policy.ts).'

	banner "2 · bun test — the module S own runner over its own roots"
	run_in "$TS" "$BUN" test
	echo '# ^ expected: 48 cases in 2 files, all passing, 0 failing — 45 baseline plus increment 3 S three'
	echo '#   (the fill goes through the loader with LF-1/LF-2 intact; the live fill is not routed through'
	echo '#   a loader; the loader takes our pool by construction). One case per evidence obligation, each'
	echo '#   naming the careless implementation it fails on.'

	banner "3 · the module S own compiler configuration"
	run_in "$TS" bash -c "NODE_OPTIONS=--max-old-space-size=4096 \"$BUN\" run typecheck" 
	echo '# ^ expected: exit 0 and no output (`tsc --noEmit`, the pinned typescript, an explicit heap).'
	echo '#   This is the case for the module S named exception E1 (rxjs Observable in a caller-facing'
	echo '#   signature) and for E4 (the endpoint tier field): the strict configuration compiles.'

	banner "4 · the independence criterion — no host import, no relative path out of the module"
	echo '# The signer module S allow-list, applied here: every import specifier in ts/ is'
	echo '# module-relative or one of this module S own declared dependencies.'
	grep_expect "event-access/ts, the module S own sources (node_modules excluded)" "0 matched lines, exit 1" \
		"(from|module\(|import\(|require\()\s*['\"][^'\"]*(\.\./|@/|@nostr-dev-kit/)" --include='*.ts' --exclude-dir=node_modules "$TS"
	echo '# ^ the second arm: a relative specifier that leaves the module directory is a host import by shape.'

	banner "4b · every import specifier in the module, sorted and unique (the positive form)"
	echo '$ find event-access/ts -maxdepth 1 -name "*.ts" | wc -l'
	find "$TS" -maxdepth 1 -name '*.ts' | wc -l
	echo '# ^ the non-vacuity arm, asserted before the list is read: expected 10 (7 implementation files,'
	echo '#   harness.ts, and 2 test files).'
	own="$(find "$TS" -maxdepth 1 -name '*.ts' | wc -l)"
	[ "$own" -eq 10 ] || {
		echo "the module S own source set is $own, not 10 — the criterion S subject moved" >&2
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
		grep -vE '^(\./[A-Za-z0-9._-]+|applesauce-loaders(/[A-Za-z0-9._/-]+)?|nostr-tools(/[A-Za-z0-9._/-]+)?|rxjs|bun:test)$' || true)"
	# ^ the `|| true` is deliberate: a zero count here IS the finding.
	if [ -n "$disallowed" ]; then
		printf 'DISALLOWED SPECIFIER(S) — a host import, a sibling package, or a relative path leaving the module:\n%s\n' "$disallowed"
		exit 1
	fi
	echo '# ^ no disallowed specifier: the allow-list is ./<module file>, applesauce-loaders[/…],'
	echo '#   nostr-tools[/…], rxjs, bun:test. In particular no applesauce-core and no sibling path.'

	banner "5 · the contract: index.ts against the module MD S front-matter"
	run grep -nE '^export' "$TS/index.ts"
	run python3 - "$MODULE/event-access.md" "$TS/index.ts" <<'PY'
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
	echo '# ^ the runtime list: values only, and the same four the MD declares as exports.'

	banner "6 · ts/ts.md S inventory against the directory itself"
	echo '$ find event-access/ts -maxdepth 1 -type f | sort'
	find "$TS" -maxdepth 1 -type f | xargs -n1 basename | LC_ALL=C sort
	printf 'files found: %s   (14 with the lock)\n' \
		"$(find "$TS" -maxdepth 1 -type f | wc -l)"
	listed="$(sed -n '/^## Inventory/,/^## /p' "$TS/ts.md" | grep -oE '^-[[:space:]]+`[^`]+`' | grep -oE '`[^`]+`' | tr -d '`' | LC_ALL=C sort -u)"
	found="$(find "$TS" -maxdepth 1 -type f | xargs -n1 basename | LC_ALL=C sort -u)"
	printf 'listed: %s   found: %s\n' \
		"$(printf '%s\n' "$listed" | grep -c . || true)" "$(printf '%s\n' "$found" | grep -c . || true)"
	run diff <(printf '%s\n' "$listed") <(printf '%s\n' "$found")
	echo '# ^ expected: exit 0. ts.md names bun.lock iff it exists, so the diff is empty'

	banner "7 · the test-case count"
	echo '$ find event-access/ts -maxdepth 1 -name "*.test.ts" | wc -l'
	find "$TS" -maxdepth 1 -name '*.test.ts' | wc -l
	echo '$ grep -cE "^[[:space:]]*(test|it)\(" event-access/ts/*.test.ts   (file:count)'
	grep -cE '^[[:space:]]*(test|it)\(' "$TS"/*.test.ts
	echo '$ ... summed (the declarations; equal to the runner S total, because every case has one literal title):'
	grep -cE '^[[:space:]]*(test|it)\(' "$TS"/*.test.ts | awk -F: '{s+=$2} END {print s" test declarations in total"}'
	echo '$ the runner S own totals, for the same measure (bun reports on stderr, hence 2>&1):'
	run_in "$TS" bash -c "\"$BUN\" test 2>&1 | grep -E '^ *[0-9]+ (pass|fail)'"

	banner "8 · the check routine (from the assembly root)"
	run_in "$ASSEMBLY" python3 core/checks/check.py --root .
	echo '# ^ expected: 0 hard findings, 0 notes, with the module and statement counts quoted.'
	echo '$ grep -cE "^- `#[0-9a-f]{6}` —" event-access/event-access.md   (the bullet statements)'
	grep -cE '^- `#[0-9a-f]{6}` —' "$MODULE/event-access.md" || true
	echo '$ grep -c "#@" event-access/event-access.md   (an unfilled placeholder is not a statement)'
	grep -c '#@' "$MODULE/event-access.md" || true
	echo '# ^ expected 0: no NEW statement was needed, so no placeholder was written.'
	echo '$ git cat-file -e $SPEC_BASE^{commit}   (the frozen spec this increment amends)'
	run git -C "$ASSEMBLY" cat-file -e "$SPEC_BASE^{commit}"
	echo '$ git show '"$SPEC_BASE"':event-access/event-access.md | grep -cE "^- `#[0-9a-f]{6}` —"   (BEFORE)'
	git -C "$ASSEMBLY" show "$SPEC_BASE:event-access/event-access.md" | grep -cE '^- `#[0-9a-f]{6}` —'
	echo '$ git show HEAD:event-access/event-access.md | grep -cE "^- `#[0-9a-f]{6}` —"   (HEAD)'
	git -C "$ASSEMBLY" show HEAD:event-access/event-access.md | grep -cE '^- `#[0-9a-f]{6}` —'
	echo '$ grep -cE "^- `#[0-9a-f]{6}` —" event-access/event-access.md   (the paired half, AFTER)'
	grep -cE '^- `#[0-9a-f]{6}` —' "$MODULE/event-access.md"
	echo '# ^ expected: the SAME number on all three lines. The pair is taken on THIS file alone — the method S'
	echo '#   paired measurement — because the tree is shared with other agents, so a whole-tree count is not'
	echo '#   a count of this change. No statement was added by this increment, so the halves must be equal,'
	echo '#   and the FROZEN base is the right BEFORE: a HEAD-anchored pair goes vacuous at the next commit'
	echo '#   (W4a N-1).'
	echo '$ git diff -U0 '"$SPEC_BASE"' -- event-access/event-access.md | grep -E "^[+-]- `#"   (edited declaring lines, vs the frozen spec)'
	git -C "$ASSEMBLY" diff -U0 "$SPEC_BASE" -- event-access/event-access.md | grep -E '^[+-]- `#' || true
	echo '$ ...and the same guard against HEAD, so this pass is covered on its own:'
	git -C "$ASSEMBLY" diff -U0 -- event-access/event-access.md | grep -E '^[+-]- `#' || true
	echo '# ^ expected: no lines on either guard. An amendment may not land on a declaring line (D-O20).'
	echo '$ grep -cE "^\*\*(Amended|Corrected) 2026-09-30" event-access/event-access.md   (amendment paragraphs)'
	grep -cE '^\*\*(Amended|Corrected) 2026-09-30' "$MODULE/event-access.md" || true
	echo '# ^ expected: 11 — the two the spec closure wrote earlier, the six pre-code amendments I2 owes, the'
	echo '#   in-place preamble correction, the closing-clause correction, and the D-O21 gate amendment. A'
	echo '#   census, because a git diff numstat moves whenever the orchestrator commits and a census of the'
	echo '#   file does not (W4a N-1/N-6).'

	banner "9 · the socket primitives this module must not name, and its stated list"
	echo '# The expected output is a STATED list of hits, and every hit below is named — a bare zero is not'
	echo '# evidence. event-access owns no wire: the two hits are fixture constants for the relay URLs a fake'
	echo '# seam S acks carry, on the reserved .invalid TLD and never dialled.'
	run grep -rnE 'wss?://' --include='*.ts' --exclude-dir=node_modules "$TS"
	echo '# ^ expected: 2 matched lines, both in harness.ts (RELAY_A, RELAY_B) — values, not call sites.'
	echo '$ ...and the call sites that would connect, which must be zero:'
	grep_expect "the implementation and tests" "0 matched lines, exit 1" \
		'new WebSocket|WebSocket\(|fetch\(|https?://|createServer|EventSource|serviceWorker' \
		--include='*.ts' --exclude-dir=node_modules "$TS"
	echo '# ^ 0 socket constructors, 0 fetches, 0 servers. The only connection any case can open is none:'
	echo '#   both ports are hand-written fakes in harness.ts.'

	banner "10 · no sibling dependency, and one type identity"
	run ls -d "$TS/node_modules/nostr-tools" "$TS/node_modules/applesauce-loaders"
	echo '$ find event-access/ts/node_modules -type d -name nostr-tools | sort'
	find "$TS/node_modules" -type d -name 'nostr-tools' | sed "s|^$ASSEMBLY/||" | LC_ALL=C sort
	echo '# ^ expected: a single nostr-tools copy, so `Event` is one structural type across the port boundary.'
	echo '$ ...and the sibling modules this module must not import:'
	run ls -d "$TS/node_modules/@plebeian-apps" 
	echo '# ^ expected: "No such file or directory" — neither nostr-io nor event-store is installed or imported.'
	echo '$ grep -rn "@plebeian-apps/" event-access/ts --include="*.ts"   (a sibling specifier)'
	grep -rn '@plebeian-apps/' --include='*.ts' --exclude-dir=node_modules "$TS" || true
	echo '# ^ expected: no lines. The module S own package name is @plebeian-apps/event-access (package.json);'
	echo '#   it is not a dependency and no file imports a sibling.'
	echo '$ ...and the declared dependency lists carry no sibling either (asserted in section 1).'
	echo '$ grep -rn "applesauce-loaders" event-access/ts --include="*.ts"   (the doc mentions AND the imports)'
	grep -rn 'applesauce-loaders' --include='*.ts' --exclude-dir=node_modules "$TS" || true
	echo '# ^ expected: 8 matched lines — 5 doc comments (4 in policy.ts carrying the E6 settlement, 1 in'
	echo '#   index.ts naming the allow-list) and 3 import specifiers: `applesauce-loaders/loaders` and'
	echo '#   `applesauce-loaders/helpers` in composition.ts, and `applesauce-loaders/loaders` in'
	echo '#   composition.test.ts. That is increment 3 landing: the bounded fill is the loader family S,'
	echo '#   driven over the one pool, so the dependency installed to settle E6 S label is now also the'
	echo '#   fill S engine. The two specifiers are allowed by section 4b, and `applesauce-core` is still'
	echo '#   neither declared nor imported anywhere in ts/ (sections 1 and 4b).'

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
	echo '# The ratchet is the finding count, not the script count: adding a script raises the number of'
	echo '# scripts checked by exactly one, and that script must contribute 0 findings.'
	echo '# baseline before this module S script existed (MEASURED, same command):'
	echo '#   evidence: 12 script(s) checked, 7 hard finding(s), 1 note(s)'
	run_in "$ASSEMBLY" python3 core/checks/evidence.py --root .
	echo '# ^ expected: 13 script(s) checked, the same 7 hard findings, the same 1 note, and 0 findings from'
	echo '#   event-access/evidence/run.sh: it prints rather than redirecting, it sets `set -euo pipefail` in'
	echo '#   its first lines, it spells bun absolutely and exports PATH, and it asserts its subject first.'
} 2>&1

printf 'regenerated: bash event-access/evidence/run.sh   (the caller redirects to event-access/evidence/01-build-and-tests.txt)\n' >&2
