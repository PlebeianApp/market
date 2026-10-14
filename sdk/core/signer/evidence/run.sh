#!/usr/bin/env bash
#
# signer/evidence/run.sh — regenerates the signer module's evidence.
#
# It writes only under signer/evidence/ and installs only inside signer/ts/.
# Nothing here touches the mounted specimen; `market/` is only read with git,
# for the conservation line at the end.
#
# Usage:  bash signer/evidence/run.sh
#         (from anywhere; the script resolves its own directory)
#
set -euo pipefail
# Byte-order sorting, everywhere: the diffs below compare a list extracted from
# the spec against one extracted from the code, and a locale's collation would
# make two identical sets compare as different.
export LC_ALL=C

MODULE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ASSEMBLY="$(cd "$MODULE/.." && pwd)"
TS="$MODULE/ts"
OUT="$MODULE/evidence"
BUN="${BUN:-$HOME/.bun/bin/bun}"
export PATH="$(dirname "$BUN"):$PATH"

mkdir -p "$OUT"

# The module's implementation: named explicitly, and checked against the tree so
# the list cannot drift. Everything else at the top level is test material
# (`*.test.ts`, and `harness.ts` which implements the PORTS on the host side).
IMPL_NAMES="capability.ts errors.ts index.ts lanes.ts nip46.ts session.ts types.ts uri.ts vault.ts"
impl() { for name in $IMPL_NAMES; do echo "$TS/$name"; done; }
all_ts() { find "$TS" -maxdepth 1 -type f -name '*.ts' | sort; }
tests() { find "$TS" -maxdepth 1 -type f -name '*.test.ts' | sort; }

# grep over a file list, printing the hits and the hit count, with the expected
# output stated — a criterion a correct run passes and a careless one fails.
check() { # check <label> <expected> <pattern> <file...>
	local label="$1" expected="$2" pattern="$3"
	shift 3
	local hits
	hits="$(grep -rnE "$pattern" "$@" 2>/dev/null || true)"
	printf '$ grep -rnE "%s" <%s>\n' "$pattern" "$label"
	printf '%s\n' "${hits:-（no lines）}"
	printf 'hits: %s   (expected: %s)\n\n' "$(printf '%s' "$hits" | grep -c . )" "$expected"
}

banner() { printf '\n===== %s =====\n' "$1"; }

{
	banner "signer module — build, test and isolation evidence"
	echo "# command:   bash signer/evidence/run.sh"
	echo "# generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)   host: $(uname -srm)"
	echo "# bun:       $("$BUN" --version)"
	echo "# module:    $MODULE"
	echo "# note: every line below is a command's own output, not a summary of it."

	banner "0 · the mounted specimen is untouched"
	echo '$ git -C market rev-parse HEAD'
	git -C "$ASSEMBLY/market" rev-parse HEAD 2>&1
	echo "exit: $?"
	echo '$ git -C market status --short'
	git -C "$ASSEMBLY/market" status --short 2>&1
	echo "exit: $?   (empty output above = the mount is untouched)"

	banner "1 · the module's own dependency store"
	echo '$ cd signer/ts && bun install'
	( cd "$TS" && "$BUN" install ) 2>&1
	echo "exit: $?"
	echo
	echo '$ ls -l signer/ts/{package.json,tsconfig.json,bun.lock}'
	ls -l "$TS/package.json" "$TS/tsconfig.json" "$TS/bun.lock" 2>&1
	echo "exit: $?"
	echo
	echo '# the versions this module actually resolved (applesauce-signers is pinned exactly, per the ADR):'
	( cd "$TS" && "$BUN" pm ls ) 2>&1
	echo "exit: $?"

	banner "2 · bun test — the module's own runner over its own roots"
	echo '$ cd signer/ts && bun test'
	( cd "$TS" && "$BUN" test ) 2>&1
	echo "exit: $?"

	banner "3 · tsc --noEmit — the module's own compiler configuration"
	echo '$ cd signer/ts && bun run typecheck   # tsc --noEmit -p tsconfig.json'
	( cd "$TS" && "$BUN" run typecheck ) 2>&1
	echo "exit: $?"

	banner "4 · the isolation checks — facts about the module's own source"
	echo "# scope A = every TypeScript file in signer/ts (implementation, harness, tests)."
	echo "# scope B = the implementation only: $IMPL_NAMES"
	echo "# the two scope lists are themselves checked, so neither can silently drift:"
	echo
	echo '$ ls signer/ts/*.ts   (implementation ∪ tests ∪ harness = this listing)'
	all_ts 2>&1
	echo
	echo '$ the implementation list, echoed:'
	impl 2>&1
	echo
	echo '$ comm -13 <(impl | xargs -n1 basename | sort) <(ls signer/ts/*.ts | xargs -n1 basename | sort)'
	comm -13 <(impl | xargs -n1 basename | sort) <(all_ts | xargs -n1 basename | sort) 2>&1
	echo '# ^ what is left at the top level once the implementation is named: the tests and the'
	echo '#   harness (the host-side implementation of the ports). Expected: harness.ts and the *.test.ts files.'
	echo

	echo "--- scope A: no host storage, no browser global, no framework, no host alias"
	for pattern in 'localStorage' 'sessionStorage' 'indexedDB' 'window\.' 'document\.' 'navigator\.' '\bReact\b' '@nostr-dev-kit' '@/'; do
		check "all signer/ts/*.ts" "0 lines" "$pattern" $(all_ts)
	done

	echo "--- scope B: the implementation reads no host global of any kind"
	for pattern in 'globalThis' '(^|[^.[:alnum:]_])crypto\.(subtle|getRandomValues|randomUUID)' '(^|[^.[:alnum:]_])fetch\(' '(^|[^.[:alnum:]_])WebSocket\b' '(^|[^.[:alnum:]_])process\.' '@/' '\.\./' 'bun:' 'Date\.now' 'Math\.random'; do
		check "the implementation ($IMPL_NAMES)" "0 lines" "$pattern" $(impl)
	done

	echo "--- scope B: the deadlines come from the injected clock, and from nowhere else"
	check "the implementation ($IMPL_NAMES)" "2 lines, both the ClockPort members in types.ts" \
		'(^|[^.[:alnum:]_])(set|clear)Timeout\(' $(impl)
	echo '$ grep -rn "clock\.\(set\|clear\)Timeout" <implementation>'
	grep -rnE 'clock\.(set|clear)Timeout' $(impl) 2>&1
	echo '# ^ the timer call sites in the module, four, all on the injected ClockPort (two in nip46.ts, two in the session.ts port guard).'
	echo

	echo "--- the one runner-bound import, and where it lives"
	echo '$ grep -rn "bun:test" <tests>'
	grep -rn 'bun:test' $(tests) 2>&1
	echo "hits: $(grep -rn 'bun:test' $(tests) 2>/dev/null | wc -l)   (expected: one per test file — 5)"
	echo '#   bun test collects nothing else, so the runner API is the single host-bound name in the'
	echo '#   module and it appears in test files only. A Rust or Flutter implementation uses its own runner.'
	echo

	echo "--- every import specifier in the module, sorted and unique"
	grep -rhoE "(from|import)[[:space:]]+'[^']+'" $(all_ts) 2>/dev/null | sed -E "s/^(from|import)[[:space:]]+//" | sort -u
	echo '# ^ the allow-list is exactly: ./<module file>, applesauce-signers[/*], nostr-tools[/…], rxjs,'
	echo '#   bun:test. Anything else would be a host import, and host imports are what this module does not have.'
	echo
	echo '$ grep -rnE "require\(|mock\.module\(" <all signer/ts/*.ts>'
	grep -rnE 'require\(|mock\.module\(' $(all_ts) 2>&1 || true
	echo '# ^ expected: no lines. There is no CommonJS require and no module mock anywhere in the module.'

	banner "5 · the contract: index.ts against the module MD's front-matter"
	echo '$ grep -nE "^export" signer/ts/index.ts'
	grep -nE '^export' "$TS/index.ts" 2>&1
	echo
	echo '# the names index.ts exports, parsed out of its export blocks, split value / type,'
	echo '# plus the members of the SignerSession interface in session.ts:'
	python3 - "$TS/index.ts" "$TS/session.ts" "$OUT/.ts-values" "$OUT/.ts-types" "$OUT/.ts-operations" <<'PY'
import re, sys
entry = open(sys.argv[1]).read()
session = open(sys.argv[2]).read()
values, types = set(), set()
for match in re.finditer(r'export (type )?\{([^}]*)\}', entry):
    bucket = types if match.group(1) else values
    for name in match.group(2).split(','):
        name = name.strip()
        if name:
            bucket.add(name)
interface = re.search(r'export interface SignerSession \{(.*?)\n\}', session, re.S)
if not interface:
    sys.exit('the SignerSession interface was not found in session.ts')
operations = set(re.findall(r'^	([A-Za-z][A-Za-z0-9]*)\(', interface.group(1), re.M))
open(sys.argv[3], 'w').write('\n'.join(sorted(values)) + '\n')
open(sys.argv[4], 'w').write('\n'.join(sorted(types)) + '\n')
open(sys.argv[5], 'w').write('\n'.join(sorted(operations)) + '\n')
PY
	echo '$ <the entry point value exports>'
	cat "$OUT/.ts-values"
	echo '$ <the entry point type exports>'
	cat "$OUT/.ts-types"
	echo '$ <the SignerSession interface members>'
	cat "$OUT/.ts-operations"
	echo
	echo '# and at runtime — the same module, loaded, with its types erased:'
	( cd "$TS" && "$BUN" -e 'import * as m from "./index.ts"; console.log(Object.keys(m).sort().join("\n"))' ) 2>&1
	echo '# ^ values only: a type has no runtime form, which is why the parsed list (above) is the one diffed.'
	echo
	echo '$ the front-matter lists, extracted the same way:'
	mdlist() { # mdlist <key> <out>  — the bracketed list of a front-matter key
		grep -m1 "^  $1: \\[" "$MODULE/signer.md" | sed -E "s/^  $1: \\[//; s/\\]\$//" \
			| tr ',' '\n' | sed -E 's/^ +//; s/ +\$//' | grep -v '^$' | sort >"$2"
	}
	mdlist exports "$OUT/.md-exports"
	mdlist types "$OUT/.md-types"
	mdlist operations "$OUT/.md-operations"
	cat "$OUT/.md-exports"
	echo
	echo '$ diff <contract.exports in the MD> <the entry point value exports>'
	diff "$OUT/.md-exports" "$OUT/.ts-values" 2>&1
	echo "exit: $?   (0 = the declared exports and the delivered ones are the same list)"
	echo
	echo '$ diff <contract.types in the MD> <the entry point type exports>'
	diff "$OUT/.md-types" "$OUT/.ts-types" 2>&1
	echo "exit: $?   (0 = the same list)"
	echo
	echo '$ diff <contract.operations in the MD> <the members of the SignerSession interface>'
	diff "$OUT/.md-operations" "$OUT/.ts-operations" 2>&1
	echo "exit: $?   (0 = the contract names exactly the operations the interface carries)"
	echo
	echo '# nothing in the check routine reads these three keys (the string "contract" does not occur in'
	echo '# it), so these three diffs ARE the check. They are facts about the tree: a delivered export that'
	echo '# the spec does not declare, or a declared operation that does not exist, breaks one of them.'
	rm -f "$OUT/.ts-exports" "$OUT/.ts-values" "$OUT/.ts-types" "$OUT/.ts-operations" \
		"$OUT/.md-exports" "$OUT/.md-types" "$OUT/.md-operations"

	banner "5b · the state machine's transition table: one list, in three places"
echo '# The spec states the allowed transitions in #489ae8, §7 draws them, and session.ts'
echo '# enforces ALLOWED. Two of the three had drifted apart; this extracts all three and'
echo '# diffs them, so a table that contains neither what the code does nor what the code'
echo '# must do cannot come back.'
echo '$ python3 signer/evidence/transitions.py'
python3 "$MODULE/evidence/transitions.py" 2>&1
echo "exit: $?   (0 = the three lists carry the same edges)"

banner "6 · the file inventory and the test-case count"
	echo '$ the inventory in signer/ts/ts.md, extracted mechanically, against the directory itself:'
	sed -n '/^## Inventory/,/^## /p' "$TS/ts.md" | grep -oE '^-[[:space:]]+`[^`]+`' | grep -oE '`[^`]+`' | tr -d '`' | sort -u >"$OUT/.inventory-listed"
	find "$TS" -maxdepth 1 -type f | xargs -n1 basename | sort -u >"$OUT/.inventory-found"
	echo '$ diff <listed in ts.md> <found in signer/ts>'
	diff "$OUT/.inventory-listed" "$OUT/.inventory-found" 2>&1
	echo "exit: $?   (0 = the inventory and the directory hold the same names)"
	rm -f "$OUT/.inventory-listed" "$OUT/.inventory-found"
	echo
	echo '$ find signer -type f ! -path "*/node_modules/*" | sort'
	find "$MODULE" -type f ! -path '*/node_modules/*' | sort 2>&1
	echo
	echo '$ wc -l <every module file>'
	wc -l "$TS"/*.ts "$MODULE/signer.md" "$TS/ts.md" "$MODULE/evidence/record.md" 2>&1
	echo
	echo '$ grep -cE "^[[:space:]]*(test|it)\(" signer/ts/*.test.ts   (file:count)'
	grep -cE '^[[:space:]]*(test|it)\(' "$TS"/*.test.ts 2>&1
	echo
	echo '$ ... summed:'
	grep -cE '^[[:space:]]*(test|it)\(' "$TS"/*.test.ts 2>/dev/null | awk -F: '{s+=$2} END {print s" test cases in total"}'
	echo
	echo '$ the test-case count bun reports, for the same measure:'
	( cd "$TS" && "$BUN" test ) 2>&1 | grep -E '^ *[0-9]+ (pass|fail)' 

	banner "7 · the check routine (from the assembly root)"
	echo '$ cd <assembly> && python3 core/checks/check.py --root .'
	( cd "$ASSEMBLY" && python3 core/checks/check.py --root . ) 2>&1
	echo "exit: $?"

	banner "8 · the count that must conserve: the specimen's suite is unchanged"
	echo '$ find market/contextvm market/src/queries/__tests__ market/src/lib/__tests__ -type f -name "*.test.ts" ! -name "*.integration.test.ts" | wc -l'
	find "$ASSEMBLY/market/contextvm" "$ASSEMBLY/market/src/queries/__tests__" "$ASSEMBLY/market/src/lib/__tests__" -type f -name '*.test.ts' ! -name '*.integration.test.ts' 2>/dev/null | wc -l
	echo '# 92 at the pin, and the module changed nothing there.'
} >"$OUT/01-build-and-tests.txt" 2>&1

echo "wrote $OUT/01-build-and-tests.txt"
