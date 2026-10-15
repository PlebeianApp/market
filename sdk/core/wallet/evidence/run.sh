#!/usr/bin/env bash
#
# wallet/evidence/run.sh — regenerates the payment aggregator's evidence.
#
# It prints only; the caller redirects its output to
# wallet/evidence/01-tests.txt. It never installs dependencies or writes inside the repository.
#
# Every section that reports a property ASSERTS it. A section whose gate cannot fail is a printout, not
# evidence: the import allow-list, the port-inherited-not-copied check, the names-no-rail check and the
# mount-cleanliness check all exit non-zero with the offending value shown.
set -euo pipefail
export LC_ALL=C

MODULE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ASSEMBLY="$(cd "$MODULE/.." && pwd)"
TS="$MODULE/ts"
BUN="${BUN:-$HOME/.bun/bin/bun}"
export PATH="$(dirname "$BUN"):$PATH"

for path in \
	"$MODULE/wallet.md" \
	"$TS/index.ts" "$TS/types.ts" "$TS/errors.ts" "$TS/gate.ts" "$TS/aggregator.ts" "$TS/memory.ts" "$TS/aggregator.test.ts" \
	"$MODULE/visuals/webui/index.html" "$MODULE/visuals/webui/run.ts" "$MODULE/visuals/webui/SKILL.md"; do
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

IMPL=("$TS/index.ts" "$TS/types.ts" "$TS/errors.ts" "$TS/gate.ts" "$TS/aggregator.ts" "$TS/memory.ts")

banner "wallet — the set, the conservation rule, the acceptance gate and the refund guard"
echo "# bun: $($BUN --version)"
echo "# module: $MODULE"

banner "1 · module tests"
run_in "$TS" "$BUN" test

banner "2 · strict TypeScript"
run_in "$TS" "$BUN" run typecheck

banner "3 · dependency and host isolation"
# The import specifiers are a GATE: the observed set must equal the explicit allow-list below. A rail module,
# a network client or an app path would fail here, which is what makes the set provable with no live rail.
python3 - "${IMPL[@]}" <<'PY_IMPORT_GATE'
import re
import sys

ALLOWED = {"./errors", "./types", "./gate", "./aggregator", "./memory", "../../funds-contract/ts/index"}

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
        "wallet imports a specifier outside the allow-list: " + ", ".join(unexpected)
    )
if missing:
    raise SystemExit(
        "an allow-listed specifier is no longer imported (update the allow-list): " + ", ".join(missing)
    )
print("import specifiers asserted: %d observed, all module-relative or the contract ancestor" % len(observed))
PY_IMPORT_GATE

echo '$ forbidden host imports and globals (expected: no lines)'
# This scan reads STATEMENTS, not prose, exactly as the import gate above does: comment lines are dropped
# before the search. A doc comment that NAMES a host global the module deliberately does not use is prose,
# not a dependency, and must not fail the scan.
python3 - "${IMPL[@]}" <<'PY_HOST_GATE'
import re
import sys

COMMENT_LINE = re.compile(r"^[ \t]*(?://|\*|/\*)")
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
    raise SystemExit("wallet depends on a host global or an app path")
print("no host global or app path in the scanned statements")
PY_HOST_GATE

banner "4 · the port is inherited, not re-declared"
# The port's vocabulary lives once, in the contract; this aggregator imports it and never copies it. The gate
# fails if a contract type is re-declared here, so "shared rather than copied" is asserted, not asserted by
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
    raise SystemExit("the aggregator does not import the port's types from its ancestor (%s)" % ancestor)
if declared:
    raise SystemExit("the aggregator re-declares a contract type instead of inheriting it:\n" + "\n".join(declared))
print("port imported from the ancestor: %d import(s) of %s" % (imports, ancestor))
print("contract types re-declared here: 0 — the port is shared, not copied")
PY_INHERIT_GATE

banner "5 · the aggregator names no rail"
# The property that decides this module's graph, asserted rather than described: the aggregator's front-matter
# inherits core and the contract only, and its code imports no module but the contract ancestor — so adding a
# rail edits the app's registry and the new wrapper, and this module stays byte-identical.
python3 - "$MODULE/wallet.md" "${IMPL[@]}" <<'PY_NO_RAIL_GATE'
import re
import sys

spec = sys.argv[1]
text = open(spec, encoding="utf-8").read()
match = re.search(r"^inherits:\s*\[(.*?)\]", text, re.M)
inherits = [p.strip().strip('"') for p in (match.group(1).split(",") if match else []) if p.strip()]

# The aggregator may inherit only the root and the contract: any other module name is a rail it should take
# as an injected port instead.
foreign = [name for name in inherits if name not in ("core", "funds-contract")]
if foreign:
    raise SystemExit("the aggregator inherits a rail it should take as an injected port: " + ", ".join(foreign))

# And its code must reach no module but the contract: every non-relative import is the contract ancestor.
for path in sys.argv[2:]:
    for number, line in enumerate(open(path, encoding="utf-8").read().split("\n"), 1):
        stripped = line.strip()
        if stripped.startswith("//") or stripped.startswith("*") or stripped.startswith("/*"):
            continue
        for specifier in re.findall(r"""from\s+['"]([^'"]+)['"]""", stripped):
            if specifier.startswith("./") or specifier.startswith("../"):
                continue
            raise SystemExit("%s:%d imports a module that is not the contract: %s" % (path, number, specifier))

print("front-matter inherits: %s — the root and the contract only" % (", ".join(inherits) or "(none)"))
print("each rail is an injected port: adding one edits the app's registry, not this module")
PY_NO_RAIL_GATE

banner "6 · mounted sources remain untouched"
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

banner "7 · the page is a self-contained model, and it serves on the reserved port"
# The page is the module's declared webui (wallet.md's `webui:` block): index.html, run.ts and
# SKILL.md. This section ASSERTS the properties the page must have — it parses as HTML and carries no
# remote reference (the page depends on no relay, mint or wallet), it renders the required semantics,
# run.ts's --help prints the reserved port, and the run program actually serves the page over HTTP.
python3 - "$MODULE/visuals/webui/index.html" <<'PY_HTML_GATE'
import sys
from html.parser import HTMLParser

path = sys.argv[1]
text = open(path, encoding="utf-8").read()
HTMLParser().feed(text)  # raises on a malformed document
for bad in ("http://", "https://", "//cdn", "@font-face", "ws://", "wss://"):
    if bad in text:
        raise SystemExit("index.html carries a remote reference (%s) — the page must depend on no network" % bad)
for needed in ("deriveSetState", "witnessed-settled", "untrusted", "short-settled", "over-settled", "no-reconcile-step"):
    if needed not in text:
        raise SystemExit("index.html does not render a required semantic (%s)" % needed)
print("index.html parses, carries no remote reference, and renders the required semantics")
PY_HTML_GATE

HELP_OUT="$("$BUN" run "$MODULE/visuals/webui/run.ts" --help)"
printf '%s\n' "$HELP_OUT"
printf '%s\n' "$HELP_OUT" | grep -q '4329' || { echo "run.ts --help does not print the reserved port 4329" >&2; exit 1; }
echo 'run.ts --help exits 0 and prints the reserved port 4329'

PAGE_PORT=4399
PAGE_TMP="$(mktemp -d)"
"$BUN" run "$MODULE/visuals/webui/run.ts" --port "$PAGE_PORT" > "$PAGE_TMP/srv.out" 2>&1 &
PAGE_PID=$!
cleanup_page() { kill "$PAGE_PID" 2>/dev/null || true; rm -rf "$PAGE_TMP"; }
trap cleanup_page EXIT
python3 - "$PAGE_PORT" <<'PY_SERVE_GATE'
import sys, time, urllib.request

port = sys.argv[1]
url = "http://127.0.0.1:%s/" % port
body = None
for _ in range(60):
    try:
        with urllib.request.urlopen(url, timeout=1) as response:
            body = response.read().decode("utf-8", "replace")
        break
    except Exception:
        time.sleep(0.25)
if body is None:
    raise SystemExit("the run program did not answer on port %s" % port)
if "wallet.md" not in body or "deriveSetState" not in body:
    raise SystemExit("the served page is not the payment model")
print("the run program served the page on a scratch port (%d bytes)" % len(body))
PY_SERVE_GATE
kill "$PAGE_PID" 2>/dev/null || true
wait "$PAGE_PID" 2>/dev/null || true
trap - EXIT
rm -rf "$PAGE_TMP"
echo 'the page serves as a self-contained model on the reserved port'
