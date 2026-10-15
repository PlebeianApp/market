#!/usr/bin/env python3
"""
nostr-io/evidence/falsify.py — proves that the module's evidence obligations are real.

A test that cannot fail is not evidence. For every **case this increment's evidence
rests on** — one per evidence obligation of `#7bf6f6`, one per case the repair after
the red-team pass added, and one per case the D1/D12 repair adds — this script:

  1. records the sha256 of the file it is about to break,
  2. applies ONE mutation that breaks that obligation (asserting the anchor text
     occurs exactly once, so a mutation can never be applied by accident),
  3. runs the **named case** — a case of the module's own suite, addressed by the
     leading words the table writes — and captures its own output and exit code;
     or, for the import allow-list, runs the **named command** that asserts it,
  4. restores the file byte-for-byte and verifies the sha256 matches,
  5. runs the same case (or command) again and captures the restored result.

A mutation that does NOT make its named case fail is reported as
`FALSIFICATION FAILED` — that would mean the case is not covering the obligation
it is named for. Nothing here is committed: every mutated file is restored before
the run ends and the restore is verified by hash. **Run it serialized** — never at
the same time as the suite that reads these files, because for the length of one
mutation the tree is deliberately broken.

**It prints; the caller redirects:**

    python3 nostr-io/evidence/falsify.py   >   nostr-io/evidence/02-invariant-falsification.txt

**Cases are addressed by prefix, not by whole title.** A prefix that matches
**zero** or **more than one** case is a `FALSIFICATION FAILED` report, never a
guess: two cases in this suite share a leading phrase and differ only in their
backend suffix, so an ambiguous prefix is a defect of the table, not a pass.

Two harness rules, both of them earned elsewhere: the case name is escaped before
it reaches the runner (whose `-t` filter is a regular expression, so a name
containing `(fail closed)` once matched no case at all and its non-zero exit was
read as a failing assertion), and a check that matched no case, or that is not
green again on the restored file, is counted as a failure — a defect in this
harness or in the suite, never evidence for an obligation.

**What this table does not cover, and it says so:** five of the twenty-one cases that
pre-date the D1/D12 repair (`query`'s event-order case, `subscribe`'s refusal case,
`connect`'s policy case, `#06200d`'s policy case and `#3820a9`'s two-seam case) have
no row of their own; the two repairs each added a row for every case they added, and
two of those rows reach pre-existing cases too — `the adapter's ERROR branch` is the
line the pre-existing `subscribe` refusal case fails on, and `a relay's own identity
is used for the ack match` is the line the pre-existing `publish` case and the
multi-backend case fail on. Those red halves are in `04-before-the-repair.txt` (the
red-team repair) and `05-before-the-repair.txt` (this one).
"""

import hashlib
import os
import re
import subprocess
import sys

MODULE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TS = os.path.join(MODULE, "ts")
BUN = os.environ.get("BUN", os.path.expanduser("~/.bun/bin/bun"))

# The import allow-list, exactly the expression `run.sh` prints (section 4b):
# every specifier in ts/ is module-relative or one of the seam's own declared
# dependencies, and a specifier that is neither is a finding.
ALLOWLIST = (
    "grep -rhoE \"(from|import)[[:space:]]+[\\\"'][^\\\"']+[\\\"']\" --include='*.ts' --exclude-dir=node_modules . "
    "| sed -E \"s/^(from|import)[[:space:]]+[\\\"']?//; s/[\\\"']$//\" | sort -u "
    "| grep -vE '^(\\./[A-Za-z0-9._-]+|applesauce-relay(/[A-Za-z0-9._/-]+)?|nostr-tools(/[A-Za-z0-9._/-]+)?|rxjs|bun:test)$'"
)
# `! ( ... | grep -q . )` exits 0 when no disallowed specifier exists, and 1 when one does.
ALLOWLIST_COMMAND = "! ( %s | grep -q . )" % ALLOWLIST

# Each mutation: the file, the unique anchor to break, the broken form, and either
# the **prefix** of the case that must fail because of it, or (for the allow-list)
# the command whose check must go red. The anchors are lines these files carry, so
# each occurs exactly once inside the named file.
MUTATIONS = [
    {
        "obligation": "#d700bc · the store-free case",
        "why": "the seam reaches the pool while it is being constructed, so building it already needs the wire",
        "file": "index.ts",
        "anchor": "\t\tthis.pool = options.pool ?? relayPoolAdapter()\n\t\tthis.policy = options.policy",
        "broken": "\t\tthis.pool = options.pool ?? relayPoolAdapter()\n\t\tvoid this.pool.status([])\n\t\tthis.policy = options.policy",
        "kind": "test",
        "case": "M5 · the store-free case",
    },
    {
        "obligation": "#7bf6f6 · the second-backend claim (the multi-backend case)",
        "why": "the vendor adapter's request completes before the wire's boundary, so the same suite stops being satisfied by two backends",
        "file": "relay-adapter.ts",
        "anchor": "\t\t\ttakeWhile(() => seen.size < target.length, true),",
        "broken": "\t\t\ttakeWhile(() => false, true),",
        "kind": "test",
        "case": "the multi-backend case",
    },
    {
        "obligation": "#10b5ac · the query path · the deadline (a wall clock over the whole read)",
        "why": "the deadline fires but the read reports the boundary as reached, so a cold answer is scored as a complete one",
        "file": "index.ts",
        "anchor": "\t\t\tconst deadline = timer(opts.deadlineMs).pipe(tap(() => { timedOut = true }))",
        "broken": "\t\t\tconst deadline = timer(opts.deadlineMs).pipe(tap(() => { timedOut = false }))",
        "kind": "test",
        "case": "query · a deadline that fires reports eose:false instead of inventing completeness",
    },
    {
        "obligation": "#15aa73 · the subscribe path",
        "why": "the idempotence guard is dropped, so a second unsubscribe reaches the pool again",
        "file": "index.ts",
        "anchor": "\t\t\tif (closed) return",
        "broken": "\t\t\tif (false) return",
        "kind": "test",
        "case": "subscribe · unsubscribe twice closes once and throws nothing",
    },
    {
        "obligation": "#ae22a4 · the publish path",
        "why": "the pool's acks stop being lined up against the target set, so a relay that answered is treated as one that did not",
        "file": "index.ts",
        "anchor": "new Map(acks.map((ack) => [relayIdentity(ack.url), ack] as const))",
        "broken": "new Map(acks.slice(1).map((ack) => [relayIdentity(ack.url), ack] as const))",
        "kind": "test",
        "case": "publish · one ack per targeted relay, and a silent relay is reported not dropped",
    },
    {
        "obligation": "#752c02 · the count path",
        "why": "the adapter stops reading NIP-45's approximation flag, so the contract fabricates an exact count",
        "file": "relay-adapter.ts",
        "anchor": "\treturn widened.approximate === true",
        "broken": "\treturn false",
        "kind": "test",
        "case": "count · NIP-45's count carries the relay's approximation flag",
    },
    {
        "obligation": "#5ecac1 · the reason mapping",
        "why": "a rate-limited refusal is mapped to the generic rejection, so the vocabulary stops naming the condition",
        "file": "pool.ts",
        "anchor": "\tif (text.startsWith('rate-limited') || text.includes('rate limited') || text.includes('too many')) return 'rate-limited'",
        "broken": "\tif (text.startsWith('rate-limited') || text.includes('rate limited') || text.includes('too many')) return 'rejected'",
        "kind": "test",
        "case": "#5ecac1 · the reason vocabulary maps",
    },
    {
        "obligation": "#4dab02 · the import allow-list (asserted by run.sh, section 4b)",
        "why": "a specifier that is neither module-relative nor a declared dependency appears, so the independence criterion goes red",
        "file": "index.ts",
        "anchor": "import { relayPoolAdapter } from './relay-adapter'",
        "broken": "import 'applesauce-core'\nimport { relayPoolAdapter } from './relay-adapter'",
        "kind": "command",
        "case": ALLOWLIST_COMMAND,
        "command": ALLOWLIST_COMMAND,
        "green_exit": 0,
    },
    # ---- the repair after the red-team pass: one row per case it added ----------
    {
        "obligation": "#5ecac1 · the vendor path's own refusal text (rate-limited / auth-required)",
        "why": "the adapter answers 'rejected' for every ERROR message again, so a relay's own NIP-01 prefix stops reaching the vocabulary — the state the suite's own live-refusal case was blind to before the wire was scripted the way the vendor really emits it",
        "file": "relay-adapter.ts",
        "anchor": "\t\t\t\tif (message.type === 'ERROR') {\n\t\t\t\t\tconst refusal = refusalFrom(message.error)\n\t\t\t\t\treturn { relay: message.from, reason: refusal.reason, message: refusal.message }\n\t\t\t\t}",
        "broken": "\t\t\t\tif (message.type === 'ERROR') {\n\t\t\t\t\treturn { relay: message.from, reason: 'rejected', message: 'the relay reported an error' }\n\t\t\t\t}",
        "kind": "test",
        "case": "subscribe · a relay's own NIP-01 refusal prefix",
    },
    {
        "obligation": "#10b5ac · the query path · a refusal mid-read is a value, not a rejection",
        "why": "the refusal is dropped instead of carried, so the read invents a reached boundary and the failures list is silently empty",
        "file": "index.ts",
        "anchor": "\t\t\t\terror: (error: unknown) => {\n\t\t\t\t\tfailures.push(asRelaySeamError(error))\n\t\t\t\t\tresolve()\n\t\t\t\t},",
        "broken": "\t\t\t\terror: () => resolve(),",
        "kind": "test",
        "case": "query · a relay refusal mid-read",
    },
    {
        "obligation": "#5ecac1 · a pool whose own event stream errors (the live channel is mapped)",
        "why": "the events channel stops being mapped, so the library's bare Error reaches the caller and ends a live read",
        "file": "index.ts",
        "anchor": "\t\tconst carried = inner.events.pipe(\n\t\t\tcatchError((error: unknown) => {\n\t\t\t\trefusals.next(asRelaySeamError(error))\n\t\t\t\treturn EMPTY\n\t\t\t}),\n\t\t)",
        "broken": "\t\tconst carried = inner.events",
        "kind": "test",
        "case": "#5ecac1 · a pool whose own streams error",
    },
    {
        "obligation": "#5ecac1 · a pool whose own failure channel dies (the typed channel stays typed)",
        "why": "the failure channel stops being mapped, so the channel the module types as its own refusal type ends on the library's Error",
        "file": "index.ts",
        "anchor": "\t\t\t\tmap((failure) => new RelaySeamError(failure.reason, failure.message ?? `relay ${failure.relay} did not answer`)),\n\t\t\t\t// a pool whose own failure channel dies still reports a typed refusal\n\t\t\t\tcatchError((error: unknown) => of(asRelaySeamError(error))),",
        "broken": "\t\t\t\tmap((failure) => new RelaySeamError(failure.reason, failure.message ?? `relay ${failure.relay} did not answer`)),",
        "kind": "test",
        "case": "#5ecac1 · a pool whose own streams error",
    },
    {
        "obligation": "#5ecac1 · a policy that cannot answer is a typed refusal, not a bare Error",
        "why": "the policy's own error is rethrown unmapped — the pre-repair shape, where the policy read sat outside its operation's guard",
        "file": "index.ts",
        "anchor": "\t\t\trelays = uniqueRelays(this.policy('query'))\n\t\t} catch (error) {\n\t\t\treturn refuse(error)\n\t\t}",
        "broken": "\t\t\trelays = uniqueRelays(this.policy('query'))\n\t\t} catch (error) {\n\t\t\tthrow error\n\t\t}",
        "kind": "test",
        "case": "#5ecac1 · a policy that cannot answer",
    },
    {
        "obligation": "#e574c2 · relay health is looked up under the pool's own key",
        "why": "the lookup uses the policy's raw spelling again, which the pool's map never holds, so a relay the pool has is reported as an invented 'not connected'",
        "file": "relay-adapter.ts",
        "anchor": "\t\t\tconst relay = this.pool.relays.get(key)",
        "broken": "\t\t\tconst relay = this.pool.relays.get(url)",
        "kind": "test",
        "case": "connect · a relay the pool already holds",
    },
    {
        "obligation": "closeOnEose · the source is subscribed before the boundary gate",
        "why": "the pre-repair gate is restored — the notifier is subscribed first, so an EOSE the pool already holds completes the output before the events that preceded it",
        "file": "index.ts",
        "anchor": "\t\tconst events = opts.closeOnEose ? atEose(carried) : carried",
        "broken": "\t\tconst events = opts.closeOnEose ? carried.pipe(takeUntil(inner.eose.pipe(tap(() => unsubscribe())))) : carried",
        "kind": "test",
        "case": "subscribe · closeOnEose ends the stream at the boundary",
    },
    {
        "obligation": "#06200d · the unique target set (the host's set, de-duplicated once)",
        "why": "the seam hands the pool the host's array as-is again, so a relay named twice answers twice and its own boundary is counted twice",
        "file": "index.ts",
        "anchor": "\t\t\trelays = uniqueRelays(this.policy('query'))",
        "broken": "\t\t\trelays = [...this.policy('query')]",
        "kind": "test",
        "case": "query · a relay URL the policy names twice",
    },
    {
        "obligation": "the stated ceiling · a read stops at MAX_EVENTS_PER_READ",
        "why": "the ceiling guard is removed, so the read keeps every event a relay sends instead of stopping at the stated bound",
        "file": "index.ts",
        "anchor": "\t\t\t\t\tif (events.length >= MAX_EVENTS_PER_READ) {\n\t\t\t\t\t\ttruncated = true\n\t\t\t\t\t\tcapReached.next()\n\t\t\t\t\t}",
        "broken": "\t\t\t\t\tif (false) {\n\t\t\t\t\t\ttruncated = true\n\t\t\t\t\t\tcapReached.next()\n\t\t\t\t\t}",
        "kind": "test",
        "case": "query · a read stops at the stated ceiling",
    },
    {
        "obligation": "the wall-clock deadline · a dripping wire is bounded",
        "why": "the deadline is disarmed, so a wire that keeps emitting without ever reaching EOSE leaves the caller's read pending — the inactivity-gap behaviour in its strongest form",
        "file": "index.ts",
        "anchor": "\t\t\tconst deadline = timer(opts.deadlineMs).pipe(tap(() => { timedOut = true }))\n\t\t\tbounded = bounded.pipe(takeUntil(deadline))",
        "broken": "\t\t\tconst deadline = NEVER\n\t\t\tbounded = bounded.pipe(takeUntil(deadline))",
        "kind": "test",
        "case": "query · a dripping wire is bounded by the wall-clock deadline",
    },
    # ---- the D1/D12 repair: one row per case it added --------------------------
    {
        "obligation": "#752c02 / D2 · the wire count settles, and is the sum of the relays' own indices",
        "why": "the awaited operator is restored to `lastValueFrom`, which resolves only on completion — and the vendor's group COUNT stream is rooted in a `BehaviorSubject` and never completes (`group.js:12`, `:21`, `:187-190`) — so the count never settles. Red through `within()`'s guard, never by hanging the runner: the case's own guard is the read's bound.",
        "file": "relay-adapter.ts",
        "anchor": "await firstValueFrom(this.pool.count([...relays], [...filters]))",
        "broken": "await (await import('rxjs')).lastValueFrom(this.pool.count([...relays], [...filters]))",
        "kind": "test",
        "case": "count · the wire count settles against a pool whose COUNT stream never completes",
    },
    {
        "obligation": "#ae22a4 / D12 · a relay's own identity is used for the ack match",
        "why": "the ack map is keyed by the host's raw spelling again while the pool files every answer under its own normalised key (`relay.js:653`, `:674`), so a relay that answered `ok: true` is reported as refusing the event — B2's publish half",
        "file": "index.ts",
        "anchor": "new Map(acks.map((ack) => [relayIdentity(ack.url), ack] as const))",
        "broken": "new Map(acks.map((ack) => [ack.url, ack] as const))",
        "kind": "test",
        "case": "publish · an ack is matched under the pool's own identity",
    },
    {
        "obligation": "#10b5ac / D12 · the boundary gate counts a normalised-unique target list",
        "why": "the gate counts the host's raw spellings again, so a set naming one relay in two spellings can never reach its boundary and the read never settles — B2's read half",
        "file": "relay-adapter.ts",
        "anchor": "\t\t\ttakeWhile(() => seen.size < target.length, true),",
        "broken": "\t\t\ttakeWhile(() => seen.size < [...relays].length, true),",
        "kind": "test",
        "case": "query · a target set naming one relay in two spellings still settles",
    },
]

CASE_PATTERN = re.compile(r"^\s*(?:test|it)\(\s*(['\"])(.*?)\1", re.M)


def sha256(path):
    with open(path, "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()


def suite_cases():
    """Every case title in the module's suite: (file, title), in file order."""
    cases = []
    for name in sorted(os.listdir(TS)):
        if not name.endswith(".test.ts"):
            continue
        with open(os.path.join(TS, name), encoding="utf-8") as handle:
            text = handle.read()
        for match in CASE_PATTERN.finditer(text):
            cases.append((name, match.group(2)))
    return cases


def resolve(prefix, cases):
    """The cases a prefix addresses, or a list explaining why it addresses none or many."""
    return [case for case in cases if case[1].startswith(prefix)]


def run_case(case, title):
    """Run one case; return (exit code, output, the command it ran)."""
    pattern = re.escape(title)
    command_line = "%s test %s -t %s" % (BUN, case, pattern)
    proc = subprocess.run(
        [BUN, "test", case, "-t", pattern],
        cwd=TS,
        capture_output=True,
        text=True,
        timeout=600,
    )
    return proc.returncode, (proc.stdout + proc.stderr).strip(), command_line


def run_command(command):
    """Run one named command in the module's own directory."""
    proc = subprocess.run(
        ["bash", "-c", command],
        cwd=TS,
        capture_output=True,
        text=True,
        timeout=600,
    )
    return proc.returncode, (proc.stdout + proc.stderr).strip(), "bash -c %s" % command


def did_not_run(output):
    """True when the runner reports that the filter matched no case at all."""
    return "matched 0 tests" in output or "0 tests matched" in output


def main():
    cases = suite_cases()
    lines = []
    lines.append("nostr-io module — evidence falsification")
    lines.append("# command:   python3 nostr-io/evidence/falsify.py   (the caller redirects to nostr-io/evidence/02-invariant-falsification.txt)")
    lines.append("# generated: %s" % subprocess.run(["date", "-u", "+%Y-%m-%dT%H:%M:%SZ"], capture_output=True, text=True).stdout.strip())
    lines.append("# bun:       %s" % subprocess.run([BUN, "--version"], capture_output=True, text=True).stdout.strip())
    lines.append("# cases in the suite: %d across %d files" % (len(cases), len({case[0] for case in cases})))
    lines.append("#")
    lines.append("# For each evidence obligation and each case the repair added: one mutation is applied, the")
    lines.append("# named case (or the named command) is run, the file is restored byte-for-byte (sha256 verified)")
    lines.append("# and the check is run again. A mutation whose check does NOT go red is reported FALSIFICATION FAILED.")
    lines.append("# Run serialized: for the length of one mutation the tree is deliberately broken.")
    lines.append("")

    failures = 0
    for index, mutation in enumerate(MUTATIONS, 1):
        path = os.path.join(TS, mutation["file"])
        original = open(path, encoding="utf-8").read()
        before = sha256(path)
        anchor = mutation["anchor"]
        occurrences = original.count(anchor)

        lines.append("=" * 78)
        lines.append("mutation %d — %s" % (index, mutation["obligation"]))
        lines.append("breaks:   %s" % mutation["why"])
        lines.append("file:     nostr-io/ts/%s" % mutation["file"])
        lines.append("sha256:   %s (before)" % before)
        lines.append("anchor occurrences: %d (must be exactly 1)" % occurrences)
        lines.append("")

        if occurrences != 1:
            lines.append("RESULT: FALSIFICATION FAILED — the anchor is not unique in %s" % mutation["file"])
            lines.append("")
            failures += 1
            continue

        if mutation["kind"] == "test":
            hits = resolve(mutation["case"], cases)
            if len(hits) != 1:
                lines.append("RESULT: FALSIFICATION FAILED — the prefix %r matched %d case(s), not 1" % (mutation["case"], len(hits)))
                for name, title in hits:
                    lines.append("        matched: %s · %s" % (name, title))
                lines.append("")
                failures += 1
                continue
            case_file, title = hits[0]
            lines.append("case:     %s · %s" % (case_file, title))
        else:
            case_file, title = None, None
            lines.append("command:  %s" % mutation["command"])

        lines.append("$ the mutation applied (old -> new):")
        lines.append("- %s" % anchor.replace("\t", "    "))
        lines.append("+ %s" % mutation["broken"].replace("\t", "    "))
        lines.append("")

        try:
            open(path, "w", encoding="utf-8").write(original.replace(anchor, mutation["broken"], 1))
            if mutation["kind"] == "test":
                code, output, command_line = run_case(case_file, title)
            else:
                code, output, command_line = run_command(mutation["command"])
        finally:
            open(path, "w", encoding="utf-8").write(original)

        after = sha256(path)
        lines.append("$ %s" % command_line)
        lines.append(output)
        lines.append("exit: %d" % code)
        lines.append("")
        lines.append("$ sha256 after restore: %s (must equal the line above)" % after)
        lines.append("restore verified: %s" % ("yes" if after == before else "NO — THE FILE WAS NOT RESTORED"))
        lines.append("")

        if mutation["kind"] == "test":
            never_ran = did_not_run(output)
            broke_it = code != 0 and not never_ran
            detail = (
                "the filter matched no case, so this row proves nothing about the obligation and is counted as a failure"
                if never_ran
                else "the named case failed under the mutation"
                if broke_it
                else "the named case did not fail under the mutation"
            )
        else:
            never_ran = False
            broke_it = code != mutation["green_exit"]
            detail = (
                "the named command went red under the mutation"
                if broke_it
                else "the named command stayed green under the mutation"
            )

        lines.append(
            "RESULT: %s — %s"
            % (
                "FALSIFICATION FAILED (the check never ran)"
                if never_ran
                else "FALSIFIED (the obligation is really covered)"
                if broke_it
                else "FALSIFICATION FAILED (the check stayed green)",
                detail,
            )
        )
        if not broke_it:
            failures += 1
        if after != before:
            failures += 1

        if mutation["kind"] == "test":
            code_after, output_after, _ = run_case(case_file, title)
            restored_green = code_after == 0 and not did_not_run(output_after)
        else:
            code_after, output_after, _ = run_command(mutation["command"])
            restored_green = code_after == mutation["green_exit"]
        lines.append("")
        lines.append("$ ...and the same check on the restored file:")
        lines.append(output_after)
        lines.append(
            "exit: %d   (%d = green again)"
            % (code_after, mutation["green_exit"] if mutation["kind"] == "command" else 0)
        )
        lines.append(
            "the check is green again on the restored file: %s"
            % ("yes" if restored_green else "NO — the check does not pass on the restored tree, which is not the mutation's doing and is counted as a failure")
        )
        lines.append("")
        if not restored_green:
            failures += 1

    lines.append("=" * 78)
    lines.append("%d mutation(s) applied, %d falsification failure(s)" % (len(MUTATIONS), failures))
    lines.append("every mutated file was restored and its sha256 verified; the module's tree is as it was before this run.")
    print("\n".join(lines))

    print("")
    print("%d mutation(s), %d falsification failure(s)" % (len(MUTATIONS), failures))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
