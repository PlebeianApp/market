#!/usr/bin/env bash
#
# bolt11-wrapper/evidence/run.sh — regenerates the bolt11 rail wrapper's evidence.
#
# It prints only; the caller redirects its output to
# bolt11-wrapper/evidence/01-tests.txt. It never installs dependencies or writes inside the repository.
#
# Every section that reports a property ASSERTS it. A section whose gate cannot fail is a printout, not
# evidence: the import allow-list, the port-inherited-not-copied check and the mount-cleanliness check all
# exit non-zero with the offending value shown.
set -euo pipefail
export LC_ALL=C

MODULE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ASSEMBLY="$(cd "$MODULE/.." && pwd)"
TS="$MODULE/ts"
BUN="${BUN:-$HOME/.bun/bin/bun}"
export PATH="$(dirname "$BUN"):$PATH"

for path in \
	"$MODULE/bolt11-wrapper.md" \
	"$TS/index.ts" "$TS/types.ts" "$TS/wrapper.ts" "$TS/errors.ts" "$TS/memory.ts" \
	"$TS/adapter.ts" "$TS/wrapper.test.ts" "$TS/adapter.test.ts"; do
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

IMPL=("$TS/index.ts" "$TS/types.ts" "$TS/wrapper.ts" "$TS/errors.ts" "$TS/memory.ts" "$TS/adapter.ts")

banner "bolt11-wrapper — the port implemented over the invoice-and-preimage rail"
echo "# bun: $($BUN --version)"
echo "# module: $MODULE"

banner "1 · module tests"
run_in "$TS" "$BUN" test

banner "2 · strict TypeScript"
run_in "$TS" "$BUN" run typecheck

banner "3 · dependency and host isolation"
# The import specifiers are a GATE: the observed set must equal the explicit allow-list below. A network
# client or an app path would fail here, which is what makes the rail provable with no live network.
python3 - "${IMPL[@]}" <<'PY_IMPORT_GATE'
import re
import sys

ALLOWED = {"./errors", "./types", "./wrapper", "./memory", "./adapter", "../../funds-contract/ts/index"}

# A module specifier is read from a real STATEMENT, never from the bare word "from" anywhere in the file.
# The matcher anchors two ways so it cannot fire on prose:
#   * COMMENT_LINE drops every comment line first — a line whose first non-blank character opens or
#     continues a comment ("//", "*" or "/*") — so text inside a doc comment is gone before matching;
#   * each remaining pattern requires its statement keyword. FROM_STATEMENT needs `import`/`export` at the
#     start of a post-strip line before the `from`; SIDE_EFFECT needs `import` at a line start; REQUIRE_CALL
#     needs an actual `require(` call. The word "from" on its own therefore matches nothing: a comment such
#     as `distinguishes "no answer" from "not settled"` carries no import/export/require keyword and lives on
#     a comment line, so neither anchor can reach it.
COMMENT_LINE = re.compile(r"^[ \t]*(?://|\*|/\*)")
FROM_STATEMENT = re.compile(r"""^[ \t]*(?:import|export)\b[\s\S]*?\bfrom[ \t]*['"]([^'"]+)['"]""", re.M)
SIDE_EFFECT = re.compile(r"""^[ \t]*import[ \t]*['"]([^'"]+)['"]""", re.M)
REQUIRE_CALL = re.compile(r"""\brequire[ \t]*\([ \t]*['"]([^'"]+)['"]""")

observed = set()
for path in sys.argv[1:]:
    with open(path, encoding="utf-8") as handle:
        code = "\n".join(line for line in handle.read().split("\n") if not COMMENT_LINE.match(line))
    for pattern in (FROM_STATEMENT, SIDE_EFFECT, REQUIRE_CALL):
        observed.update(pattern.findall(code))

print("implementation import specifiers:", " ".join(sorted(observed)))
print("allow-listed specifiers:", " ".join(sorted(ALLOWED)))
unexpected = sorted(observed - ALLOWED)
missing = sorted(ALLOWED - observed)
if unexpected:
    raise SystemExit(
        "bolt11-wrapper imports a specifier outside the allow-list: " + ", ".join(unexpected)
    )
if missing:
    raise SystemExit(
        "an allow-listed specifier is no longer imported (update the allow-list): " + ", ".join(missing)
    )
print("import specifiers asserted: %d observed, all module-relative or the contract ancestor" % len(observed))
PY_IMPORT_GATE

echo '$ forbidden host imports and globals (expected: no lines)'
# This scan reads STATEMENTS, not prose, exactly as the import gate above does: comment lines are dropped
# before the search. A doc comment that NAMES a host global the module deliberately does not use — types.ts's
# "the market's own signer is `window.webln`; the module imports neither and reads no global" — is prose, not
# a dependency, and must not fail the scan.
python3 - "${IMPL[@]}" <<'PY_HOST_GATE'
import re
import sys

COMMENT_LINE = re.compile(r"^[ 	]*(?://|\*|/\*)")
HOST_GLOBAL = re.compile(
    r"@/|localStorage|sessionStorage|indexedDB|window\.|document\.|navigator\.|globalThis|"
    r"Date\.now|Math\.random|fetch\(|WebSocket|node:|require\("
)

found = []
for path in sys.argv[1:]:
    for number, line in enumerate(open(path, encoding="utf-8").read().split("\n"), 1):
        if COMMENT_LINE.match(line):
            continue
        if HOST_GLOBAL.search(line):
            found.append("%s:%d: %s" % (path, number, line.rstrip()))

for hit in found:
    print(hit)
if found:
    raise SystemExit("bolt11-wrapper depends on a host global or an app path")
print("no host global or app path in the scanned statements")
PY_HOST_GATE

banner "4 · the port is inherited, not re-declared"
# The port's vocabulary lives once, in the contract; this wrapper imports it and never copies it. The gate
# fails if a contract type is re-declared here, so \"shared rather than copied\" is asserted, not asserted by
# eye. It is non-vacuous: an `export type FundsStep` in any impl file fails the run.
python3 - "../funds-contract/ts" "${IMPL[@]}" <<'PY_INHERIT_GATE'
import re
import sys

ancestor = sys.argv[1]
CONTRACT_TYPES = [
    "FundsStep", "FundsOperations", "FundsProgress", "FundsRung", "FundsWitnessKind", "FundsAuthorityKind",
    "FundsIntent", "FundsQuote", "FundsRefusal", "FundsWitness", "FundsState", "FundsHandle", "WrapperRegistration",
]

imports = 0
declared = []
for path in sys.argv[2:]:
    text = open(path, encoding="utf-8").read()
    if ancestor in text:
        imports += text.count(ancestor)
    for name in CONTRACT_TYPES:
        if re.search(r"export\s+(?:type|interface)\s+%s\b" % name, text):
            declared.append("%s in %s" % (name, path))

if imports < 1:
    raise SystemExit("the wrapper does not import the port's types from its ancestor (%s)" % ancestor)
if declared:
    raise SystemExit("the wrapper re-declares a contract type instead of inheriting it:\n" + "\n".join(declared))
print("port imported from the ancestor: %d import(s) of %s" % (imports, ancestor))
print("contract types re-declared here: 0 — the port is shared, not copied")
PY_INHERIT_GATE

banner "5 · mounted sources remain untouched"
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
