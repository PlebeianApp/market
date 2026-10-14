#!/usr/bin/env python3
"""
validation/evidence/falsify.py — proves that the module's evidence obligations are real.

A test that cannot fail is not evidence. For every **evidence obligation this increment rests
on** — the pass-through floor on both operations, a refusal and an accept, the format rule both
ways, a link rule for each of matched · mismatched · deleted · expired · malformed · unresolved,
the pass-through re-asserted over an uncovered candidate, a bound exceeded as an outcome, each
of the six bounds, quarantine never admitted and session-scoped, the `accept` operation as the
composition's hook, no repair, the closed comparator vocabulary, and the declared defaults —
and for every obligation the **I4b repair** added, one case each — the format the spec describes
(one check carrying several requirements, each failure naming its own `requirement`), a rejecting
resolver read as quarantine, an uninterpretable preset refused at the preset on every candidate
state, bound 1 counting resolutions attempted with a link reading the occurrence its preset
names, bound 5's eviction record bounded too, the revisit that turns unresolved into matched, a
specific preset winning over a wildcard, and a preset asking for chain following refused at the
preset — this script:

  1. records the sha256 of the file it is about to break,
  2. applies ONE mutation that breaks that obligation (asserting the anchor text occurs exactly
     once, so a mutation can never be applied by accident),
  3. runs the **named case** — a case of the module's own suite, addressed by a leading prefix —
     and captures its own output and exit code,
  4. restores the file byte-for-byte and verifies the sha256 matches,
  5. runs the same case again and captures the restored result.

A mutation that does NOT make its named case fail is reported as `FALSIFICATION FAILED` — that
would mean the case is not covering the obligation it is named for. Nothing here is committed:
every mutated file is restored before the run ends and the restore is verified by hash.

**It takes a lock, and it must.** For the length of one mutation the tree is deliberately broken,
so this script serializes itself against anything else that reads these files (`flock` on
`/tmp/market-retrofit-falsify.lock`, held for the whole run). It prints; the caller redirects:

    python3 validation/evidence/falsify.py   >   validation/evidence/02-invariant-falsification.txt

**Cases are addressed by prefix, not by whole title.** A prefix that matches **zero** or **more
than one** case is a `FALSIFICATION FAILED` report, never a guess. The case name is escaped before
it reaches the runner (whose `-t` filter is a regular expression), and a check that matched no
case, or that is not green again on the restored file, is counted as a failure — a defect in this
harness or in the suite, never evidence for an obligation.

**A case that would hang is a failure, not a wait.** The two budget cases run a resolver that
never answers and a resolver that answers late; bun's own per-test timeout makes them red rather
than pending under their mutations.
"""

import fcntl
import hashlib
import os
import re
import subprocess
import sys

MODULE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TS = os.path.join(MODULE, "ts")
BUN = os.environ.get("BUN", os.path.expanduser("~/.bun/bin/bun"))
LOCK = "/tmp/market-retrofit-falsify.lock"

# Each mutation: the file, the unique anchor to break, the broken form, and the **prefix** of the
# case that must fail because of it. The anchors are lines these files carry, so each occurs
# exactly once inside the named file.
MUTATIONS = [
    {
        "obligation": "the pass-through floor · no presets, both operations refuse nothing (`#07b8c7`, `#ab04eb`)",
        "why": "an empty check set stops being accepted, so the default module refuses a candidate it was handed nothing to check",
        "file": "validator.ts",
        "anchor": "\t\tif (preset.checks.length === 0) return { outcome: 'accepted' }",
        "broken": "\t\tif (preset.checks.length === 0) return { outcome: 'quarantined', preset: preset.name, check: preset.name, reference: '' }",
        "case": "pass-through · with no presets",
    },
    {
        "obligation": "a refusal names its preset and its check (`#029611`)",
        "why": "the refusal loses the preset it came from, so a caller can no longer tell whose rule fired",
        "file": "validator.ts",
        "anchor": "\t\tconst refusal: ValidationRefusal = { preset, check, cause, message, requirement }",
        "broken": "\t\tconst refusal: ValidationRefusal = { preset: '', check, cause, message, requirement }",
        "case": "a refusal · a declared preset that fails",
    },
    {
        "obligation": "an accept · a declared preset that passes is accepted (`#ab04eb`)",
        "why": "every format check fails unconditionally, so a conforming candidate is refused",
        "file": "format.ts",
        "anchor": "export function evaluateFormat(check: FormatCheck, event: Event): FormatFailure | undefined {",
        "broken": "export function evaluateFormat(check: FormatCheck, event: Event): FormatFailure | undefined {\n\treturn { cause: 'differs', message: 'every format fails' }",
        "case": "an accept · a declared preset that passes",
    },
    {
        "obligation": "a format rule · the value domain, one of the three distinguishable refusals",
        "why": "the domain stops being checked, so a value outside it is accepted — the careless shape that reads a tag's presence and not its value",
        "file": "format.ts",
        "anchor": "\t\t\tif (!domain.values.includes(value)) {",
        "broken": "\t\t\tif (false) {",
        "case": "a format rule · refuses a malformed candidate",
    },
    {
        "obligation": "a link rule · matched, so the candidate is accepted",
        "why": "the equality comparator can never be satisfied, so a matched reference is refused — a rule that can only reject",
        "file": "resolve.ts",
        "anchor": "\tif (comparison.comparator === 'eq') return left !== undefined && left === right",
        "broken": "\tif (comparison.comparator === 'eq') return false",
        "case": "a link rule · a held event whose named fields match",
    },
    {
        "obligation": "a link rule · mismatched, so the candidate is refused with cause `'differs'`",
        "why": "the equality comparator is always satisfied, so a mismatched reference is accepted — validation that validates nothing",
        "file": "resolve.ts",
        "anchor": "\tif (comparison.comparator === 'eq') return left !== undefined && left === right",
        "broken": "\tif (comparison.comparator === 'eq') return true",
        "case": "a link rule · a mismatched field",
    },
    {
        "obligation": "a link rule · deleted is a refusal with cause `'deleted'` (D-O25)",
        "why": "a held 'deleted' answer falls through to the comparison, so the distinction the port was asked to make is thrown away",
        "file": "resolve.ts",
        "anchor": "\tif (bounded.state === 'deleted') {",
        "broken": "\tif (false) {",
        "case": "a link rule · a deleted reference",
    },
    {
        "obligation": "a link rule · expired is a refusal with cause `'expired'` (D-O25)",
        "why": "a held 'expired' answer falls through to the comparison, so expiry stops being distinguishable from a mismatch",
        "file": "resolve.ts",
        "anchor": "\tif (bounded.state === 'expired') {",
        "broken": "\tif (false) {",
        "case": "a link rule · an expired reference",
    },
    {
        "obligation": "a link rule · a malformed reference is refused, never repaired (`#0df9fb`)",
        "why": "the id shape stops being read, so a malformed reference is treated as a resolvable one — no parsing, no refusal",
        "file": "resolve.ts",
        "anchor": "const ID = /^[0-9a-f]{64}$/",
        "broken": "const ID = /^.*$/",
        "case": "a link rule · a malformed reference",
    },
    {
        "obligation": "a link rule · unresolved is quarantine, never a refusal (`#029611`'s amendment)",
        "why": "an unanswered reference becomes a refusal, so 'nobody could answer it' is scored as 'the candidate is wrong'",
        "file": "resolve.ts",
        "anchor": "\tif (bounded === undefined) {\n\t\tdeps.store.record(reference, now)\n\t\treturn { kind: 'unresolved', reference }\n\t}",
        "broken": "\tif (bounded === undefined) {\n\t\tdeps.store.forget(reference)\n\t\treturn { kind: 'refused', cause: 'differs', message: 'unanswered' }\n\t}",
        "case": "a link rule · an unresolved reference",
    },
    {
        "obligation": "the pass-through default re-asserted over a candidate no preset covers (`#07b8c7`)",
        "why": "the selection falls back to the first preset whatever the kind, so a candidate no preset covers is judged by a rule that never named it",
        "file": "presets.ts",
        "anchor": "\treturn specific ?? presets.find((preset) => covers(preset, event)) ?? PASS_THROUGH",
        "broken": "\treturn presets[0] ?? PASS_THROUGH",
        "case": "pass-through · re-asserted",
    },
    {
        "obligation": "a bound exceeded is an outcome, never a thrown exception (D-O25)",
        "why": "the fan-out ceiling throws instead of resolving, so an over-bound event escapes as an exception — the exact shape the spec forbids",
        "file": "validator.ts",
        "anchor": "\t\tif (references.length > bounds.maxReferencesPerEvent) {\n\t\t\treturn this.quarantine(preset, first !== undefined ? first.id : preset.name, references[bounds.maxReferencesPerEvent] ?? '')\n\t\t}",
        "broken": "\t\tif (references.length > bounds.maxReferencesPerEvent) {\n\t\t\tthrow new ValidationError({ preset: preset.name, check: preset.checks[0] as ValidationCheck, cause: 'differs', message: 'the fan-out ceiling' })\n\t\t}",
        "case": "a bound exceeded · is an outcome",
    },
    {
        "obligation": "bound 1 · resolutions attempted per event (the fan-out ceiling)",
        "why": "the ceiling is raised by one, so one resolution past the declared bound is attempted instead of held",
        "file": "validator.ts",
        "anchor": "\t\tif (references.length > bounds.maxReferencesPerEvent) {",
        "broken": "\t\tif (references.length > bounds.maxReferencesPerEvent + 1) {",
        "case": "bound 1 · resolutions attempted per event",
    },
    {
        "obligation": "bound 2 · one hop (the referenced event's own links are not followed)",
        "why": "the chain-depth ceiling stops being applied, so a ceiling below one hop no longer forbids the direct reference",
        "file": "validator.ts",
        "anchor": "\t\tif (references.length > 0 && bounds.maxChainDepth < 1) {",
        "broken": "\t\tif (false) {",
        "case": "bound 2 · one hop",
    },
    {
        "obligation": "bound 3 · the wall-clock budget for one reference",
        "why": "a fired per-reference deadline becomes an accept instead of an unresolved reference, so the budget stops producing an outcome",
        "file": "resolve.ts",
        "anchor": "\tif (bounded === DEADLINE) {\n\t\tdeps.store.record(reference, now)\n\t\treturn { kind: 'unresolved', reference }\n\t}",
        "broken": "\tif (bounded === DEADLINE) {\n\t\tdeps.store.forget(reference)\n\t\treturn { kind: 'accepted' }\n\t}",
        "case": "bound 3 · the wall-clock budget for one reference",
    },
    {
        "obligation": "bound 4 · the wall-clock budget for one event",
        "why": "the event budget is made unreachable, so a slow reference is waited out rather than cut off — the whole-event bound is inert",
        "file": "validator.ts",
        "anchor": "\t\tconst bounded = await withDeadline(this.runChecks(preset, event, bounds, resolve), bounds.eventTimeoutMs)",
        "broken": "\t\tconst bounded = await withDeadline(this.runChecks(preset, event, bounds, resolve), 10_000_000)",
        "case": "bound 4 · the wall-clock budget for one event",
    },
    {
        "obligation": "bound 5 · memory held for unresolved references, oldest-first eviction recorded as data loss",
        "why": "eviction stops, so the byte bound is not a bound and no eviction is recorded — the unbounded-memory shape the maintainer's intent names",
        "file": "bounds.ts",
        "anchor": "\t\twhile (this.bytes + bytes > this.limitBytes && this.held.size > 0) {",
        "broken": "\t\twhile (false && this.bytes + bytes > this.limitBytes) {",
        "case": "bound 5 · memory held for unresolved references",
    },
    {
        "obligation": "bound 6 · revisit count and interval — a held reference is not retried inside the interval",
        "why": "the interval gate is dropped, so every evaluation retries a reference it just failed to resolve — no interval, no bound",
        "file": "resolve.ts",
        "anchor": "\t\tif (!deps.store.shouldRevisit(reference, now, deps.bounds.revisitIntervalMs)) {\n\t\t\treturn { kind: 'unresolved', reference }\n\t\t}",
        "broken": "\t\tif (false) {\n\t\t\treturn { kind: 'unresolved', reference }\n\t\t}",
        "case": "bound 6 · revisit count and interval",
    },
    {
        "obligation": "quarantine · never admitted, and session-scoped (D-O25)",
        "why": "the hook's answer is inverted for quarantine, so a held event is admitted — the soft-guard shape `#bc3095` refuses",
        "file": "validator.ts",
        "anchor": "\t\treturn outcome.outcome === 'accepted' ? 'accept' : 'reject'",
        "broken": "\t\treturn outcome.outcome === 'refused' ? 'reject' : 'accept'",
        "case": "quarantine · is never admitted",
    },
    {
        "obligation": "the accept operation · is the composition's hook (flow, tier and resolve all reach it, `#895296`, D-O24)",
        "why": "`accept` stops passing the context through, so the composition's own resolver never reaches the link half and a resolvable reference is quarantined",
        "file": "validator.ts",
        "anchor": "\t\tconst outcome = await this.evaluate(event, context)",
        "broken": "\t\tconst outcome = await this.evaluate(event, undefined)",
        "case": "the accept operation · is the composition's hook",
    },
    {
        "obligation": "no repair · a malformed candidate is refused, never corrected (`#0df9fb`)",
        "why": "the engine writes a tag back onto the candidate it was handed, so a refusal has a side effect on the caller's event",
        "file": "resolve.ts",
        "anchor": "\tif (!wellFormed(reference, check.strategy)) {",
        "broken": "\tevent.tags.push([check.tag, '0'.repeat(64)])\n\tif (!wellFormed(reference, check.strategy)) {",
        "case": "no repair · a malformed candidate",
    },
    {
        "obligation": "the closed comparator vocabulary · a comparison it does not carry is refused, naming it (D-O25)",
        "why": "the unknown-comparator guard is removed from the preset's own precheck, so a comparator the engine does not carry is satisfied by the fall-through — a silent pass",
        "file": "resolve.ts",
        "anchor": "\t\tif (!VOCABULARY.includes(comparison.comparator)) {\n\t\t\tthrow new ValidationError({\n\t\t\t\tpreset,\n\t\t\t\tcheck,\n\t\t\t\tcause: 'malformed-reference',\n\t\t\t\tmessage: `check ${check.id} names the comparator '${String(comparison.comparator)}', which the vocabulary (eq, exists, in) does not carry`,\n\t\t\t})\n\t\t}",
        "broken": "\t\tvoid VOCABULARY",
        "case": "the comparator vocabulary · a comparison it does not carry",
    },
    {
        "obligation": "the declared values · the six bounds are the research §4 suggested defaults",
        "why": "one declared default moves, so the bound a test reads is no longer the suggested value",
        "file": "bounds.ts",
        "anchor": "\tmaxReferencesPerEvent: 10,",
        "broken": "\tmaxReferencesPerEvent: 11,",
        "case": "the declared values · the six bounds",
    },
    # ---- the I4b repair: one mutation per case the red-team findings added -------------------
    {
        "obligation": "the spec's format shape · one check carrying several requirements, each failure naming its own requirement in the value",
        "why": "one requirement kind is reported under another's name, so two failures of the same check collapse into one value again — the falsification RT-B measured",
        "file": "format.ts",
        "anchor": "\t\t\t\trequirement: 'domain',",
        "broken": "\t\t\t\trequirement: 'cardinality',",
        "case": "a format rule · one check carrying several requirements",
    },
    {
        "obligation": "a rejecting resolver is quarantine, never an escaping exception (D-O25)",
        "why": "the resolver's rejection is forwarded again, so a host's resolver fault escapes `validate` as a bare `Error` instead of a value a caller reads",
        "file": "resolve.ts",
        "anchor": "\t} catch {\n\t\tdeps.store.record(reference, now)\n\t\treturn { kind: 'unresolved', reference }\n\t}",
        "broken": "\t} catch (error) {\n\t\tthrow error\n\t}",
        "case": "a link rule · a resolver that rejects",
    },
    {
        "obligation": "the comparator vocabulary is checked at the preset, before any resolution (the order's adjustment 1)",
        "why": "the preset's own precheck is disabled, so an uninterpretable preset is no longer refused when the link check is reached and is judged per candidate state instead",
        "file": "resolve.ts",
        "anchor": "\tassertVocabulary(check, deps.preset)",
        "broken": "\tvoid assertVocabulary",
        "case": "the comparator vocabulary · an uninterpretable preset fails at the preset",
    },
    {
        "obligation": "bound 1 counts resolutions attempted, one per link check, from the occurrence the preset names",
        "why": "the fan-out count walks every matching tag again, so the ceiling caps a quantity the engine never resolves and quarantines a candidate for tags it would never read",
        "file": "resolve.ts",
        "anchor": "\t\tconst value = referenceValue(event, link.tag, link.index)\n\t\tif (value !== undefined) out.push(value)",
        "broken": "\t\tfor (const tag of event.tags) {\n\t\t\tif (tag[0] !== link.tag) continue\n\t\t\tconst value = tag[link.index]\n\t\t\tif (value !== undefined) out.push(value)\n\t\t}",
        "case": "a link rule · reads the occurrence its preset names",
    },
    {
        "obligation": "bound 5 · the eviction record is bounded too (a count plus the last few)",
        "why": "the loss record stops being trimmed, so it grows with every eviction — a memory bound whose own book is the leak",
        "file": "bounds.ts",
        "anchor": "\t\t\tif (this.history.length > EVICTION_RECORD_LIMIT) this.history.shift()",
        "broken": "\t\t\tvoid EVICTION_RECORD_LIMIT",
        "case": "bound 5 · the eviction record is bounded too",
    },
    {
        "obligation": "a revisit that turns unresolved into matched admits the held event (D-O25)",
        "why": "the revisit-count gate is made unconditional, so a held reference is never retried and an event the port has since answered can never be admitted",
        "file": "resolve.ts",
        "anchor": "\t\tif (!deps.store.canRevisit(reference, deps.bounds.revisitCount)) {",
        "broken": "\t\tif (true) {",
        "case": "quarantine · a revisit that turns unresolved into matched",
    },
    {
        "obligation": "a specific preset wins over a wildcard (preset selection)",
        "why": "the specific-match pass is removed, so a wildcard declared first shadows every rule beneath it and a candidate is judged by a preset the host did not mean to apply",
        "file": "presets.ts",
        "anchor": "\tconst specific = presets.find((preset) => preset.kinds.length > 0 && preset.kinds.includes(event.kind))",
        "broken": "\tconst specific = presets.find(() => false)",
        "case": "preset selection · a specific match wins over a wildcard",
    },
    {
        "obligation": "a preset asking for chain following is refused at the preset (`maxChainDepth > 1`, bound 2)",
        "why": "the chain-depth refusal stops firing, so a preset declaring two or more hops is accepted and silently takes one — the declared bound with no mechanism",
        "file": "validator.ts",
        "anchor": "\t\tif (links.length > 0 && bounds.maxChainDepth > 1) {",
        "broken": "\t\tif (false) {",
        "case": "bound 2 · a preset asking for chain following",
    },
    # ---- the I4c repair (finding A6): one mutation for the case it added ---------------------
    {
        "obligation": "bound 6 · the default clock is real, so a reference quarantined with no port and no clock is retried once the interval has passed (A6)",
        "why": "the default clock is frozen again (`Date.now()` back to `0`), so the revisit gate `now - lastAttemptAt >= intervalMs` becomes `0 - 0 >= intervalMs` — false forever — and a reference quarantined in this configuration can never be revisited: a declared bound with no mechanism",
        "file": "validator.ts",
        "anchor": "\t\tthis.clock = options.clock ?? (port !== undefined ? { now: () => port.now() } : { now: () => Date.now() })",
        "broken": "\t\tthis.clock = options.clock ?? (port !== undefined ? { now: () => port.now() } : { now: () => 0 })",
        "case": "bound 6 · the default clock is real",
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
    """The cases a prefix addresses — a list, so zero and many are both visible."""
    return [case for case in cases if case[1].startswith(prefix)]


def run_case(case, title):
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


def did_not_run(output):
    """True when the runner reports that the filter matched no case at all."""
    return "matched 0 tests" in output or "0 tests matched" in output


def main():
    # Serialize against anything else that reads these files: for the length of one mutation the
    # tree is deliberately broken.
    lock = open(LOCK, "w")
    fcntl.flock(lock, fcntl.LOCK_EX)

    cases = suite_cases()
    lines = []
    lines.append("validation module — evidence falsification")
    lines.append("# command:   python3 validation/evidence/falsify.py   (the caller redirects to validation/evidence/02-invariant-falsification.txt)")
    lines.append("# generated: %s" % subprocess.run(["date", "-u", "+%Y-%m-%dT%H:%M:%SZ"], capture_output=True, text=True).stdout.strip())
    lines.append("# bun:       %s" % subprocess.run([BUN, "--version"], capture_output=True, text=True).stdout.strip())
    lines.append("# cases in the suite: %d across %d files" % (len(cases), len({case[0] for case in cases})))
    lines.append("# lock:      %s (held for this whole run)" % LOCK)
    lines.append("#")
    lines.append("# For each evidence obligation: one mutation is applied, the named case is run, the file is")
    lines.append("# restored byte-for-byte (sha256 verified) and the case is run again. A mutation whose case")
    lines.append("# does NOT fail is reported FALSIFICATION FAILED. Run serialized: for the length of one")
    lines.append("# mutation the tree is deliberately broken.")
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
        lines.append("file:     validation/ts/%s" % mutation["file"])
        lines.append("sha256:   %s (before)" % before)
        lines.append("anchor occurrences: %d (must be exactly 1)" % occurrences)
        lines.append("")

        if occurrences != 1:
            lines.append("RESULT: FALSIFICATION FAILED — the anchor is not unique in %s" % mutation["file"])
            lines.append("")
            failures += 1
            continue

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
        lines.append("$ the mutation applied (old -> new):")
        lines.append("- %s" % anchor)
        lines.append("+ %s" % mutation["broken"])
        lines.append("")

        try:
            open(path, "w", encoding="utf-8").write(original.replace(anchor, mutation["broken"], 1))
            code, output, command_line = run_case(case_file, title)
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

        never_ran = did_not_run(output)
        broke_it = code != 0 and not never_ran
        lines.append(
            "RESULT: %s — %s"
            % (
                "FALSIFICATION FAILED (the case never ran)"
                if never_ran
                else "FALSIFIED (the obligation is really covered)"
                if broke_it
                else "FALSIFICATION FAILED (the case stayed green)",
                "the filter matched no case, so this row proves nothing about the obligation and is counted as a failure"
                if never_ran
                else "the named case failed under the mutation"
                if broke_it
                else "the named case did not fail under the mutation",
            )
        )
        if not broke_it:
            failures += 1
        if after != before:
            failures += 1

        code_after, output_after, _ = run_case(case_file, title)
        restored_green = code_after == 0 and not did_not_run(output_after)
        lines.append("")
        lines.append("$ ...and the same case on the restored file:")
        lines.append(output_after)
        lines.append("exit: %d   (0 = green again)" % code_after)
        lines.append(
            "the case is green again on the restored file: %s"
            % ("yes" if restored_green else "NO — the case does not pass on the restored tree, which is not the mutation's doing and is counted as a failure")
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
    fcntl.flock(lock, fcntl.LOCK_UN)
    lock.close()
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
