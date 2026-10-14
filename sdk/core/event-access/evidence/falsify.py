#!/usr/bin/env python3
"""
event-access/evidence/falsify.py — proves that the module's evidence obligations are real.

A test that cannot fail is not evidence. For every **evidence obligation this increment
rests on** — LF-1…LF-7 on their named paths, the provenance both-tier precedence,
`persist:false` **and its positive companion**, the filter boundary in both branches and
the echoing fake's counter-case, the two no-socket shapes, the port-conformance case, and
the operations `publish`/`count`/`delete`/the accept boundary/the exclusion list — this
script:

  1. records the sha256 of the file it is about to break,
  2. applies ONE mutation that breaks that obligation (asserting the anchor text occurs
     exactly once, so a mutation can never be applied by accident),
  3. runs the **named case** — a case of the module's own suite, addressed by a leading
     prefix — and captures its own output and exit code; or, for the import allow-list,
     runs the **named command** that asserts it,
  4. restores the file byte-for-byte and verifies the sha256 matches,
  5. runs the same case (or command) again and captures the restored result.

A mutation that does NOT make its named case fail is reported as `FALSIFICATION FAILED` —
that would mean the case is not covering the obligation it is named for. Nothing here is
committed: every mutated file is restored before the run ends and the restore is verified
by hash.

**It takes a lock, and it must.** For the length of one mutation the tree is deliberately
broken, so this script serializes itself against anything else that reads these files
(`flock` on `/tmp/market-retrofit-falsify.lock`, held for the whole run). It prints; the
caller redirects:

    python3 event-access/evidence/falsify.py   >   event-access/evidence/02-invariant-falsification.txt

**Cases are addressed by prefix, not by whole title.** A prefix that matches **zero** or
**more than one** case is a `FALSIFICATION FAILED` report, never a guess. Two harness rules,
both earned elsewhere: the case name is escaped before it reaches the runner (whose `-t`
filter is a regular expression), and a check that matched no case, or that is not green
again on the restored file, is counted as a failure — a defect in this harness or in the
suite, never evidence for an obligation.

**A case that would hang is a failure, not a wait.** Every case that waits on a stream does
so through `harness.ts`'s `collect`, which rejects at its own timeout; the one mutation that
removes a subscription's stated reason is therefore red after ~800 ms rather than pending.
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

# The import allow-list, exactly the expression `run.sh` prints (section 4b): every specifier
# in ts/ is module-relative or one of this module's own declared dependencies, and a specifier
# that is neither is a finding.
ALLOWLIST = (
    "grep -rhoE \"(from|import)[[:space:]]+[\\\"'][^\\\"']+[\\\"']\" --include='*.ts' --exclude-dir=node_modules . "
    "| sed -E \"s/^(from|import)[[:space:]]+[\\\"']?//; s/[\\\"']$//\" | sort -u "
    "| grep -vE '^(\\./[A-Za-z0-9._-]+|applesauce-loaders(/[A-Za-z0-9._/-]+)?|nostr-tools(/[A-Za-z0-9._/-]+)?|rxjs|bun:test)$'"
)
ALLOWLIST_COMMAND = "! ( %s | grep -q . )" % ALLOWLIST

# Each mutation: the file, the unique anchor to break, the broken form, and either the
# **prefix** of the case that must fail because of it, or (for the allow-list) the command
# whose check must go red. The anchors are lines these files carry, so each occurs exactly
# once inside the named file.
MUTATIONS = [
    {
        "obligation": "LF-1 · the local answer precedes any network participation (P1)",
        "why": "the sequence is reversed, so the fill is attempted before the local read — a fixture that recorded nothing could not have shown this",
        "file": "composition.ts",
        "anchor": "    const merged = localFirst\n      ? await local().then(network)\n      : await network().then((outcome) => local().then(() => outcome))",
        "broken": "    const merged = await network().then((outcome) => local().then(() => outcome))",
        "kind": "test",
        "case": "LF-1 · the local read is the first call",
    },
    {
        "obligation": "LF-7 · the pointer read is the sequence with one element (P5)",
        "why": "the local answer's events never enter the union, so the pointer read still walks the sequence but its answer loses the event the pointer named",
        "file": "composition.ts",
        "anchor": "      union.take(localEvents, origin)",
        "broken": "      union.take([], origin)",
        "kind": "test",
        "case": "LF-7 · the pointer read is",
    },
    {
        "obligation": "LF-2 · the query fill's events are written back, with an expected count (D-O17)",
        "why": "the write-back is removed, so the fill answers and the endpoint never sees what it answered",
        "file": "composition.ts",
        "anchor": "      const fresh = union.take(await this.gate(result.events, 'read', deadlineMs), 'network')\n      await applyWriteBack((batch) => this.writeEndpoint(batch), this.policy, fresh, persist)",
        "broken": "      const fresh = union.take(await this.gate(result.events, 'read', deadlineMs), 'network')\n      void fresh",
        "kind": "test",
        "case": "LF-2 · the query fill is written back",
    },
    {
        "obligation": "LF-2 · the subscription fill's events are written back",
        "why": "a live seam event is delivered but never offered to the store",
        "file": "composition.ts",
        "anchor": "              if (!emit(event)) return\n              const outcome = await applyWriteBack((batch) => this.writeEndpoint(batch), this.policy, [event], true)",
        "broken": "              if (!emit(event)) return\n              const outcome = undefined",
        "kind": "test",
        "case": "LF-2 · the subscription fill is written back",
    },
    {
        "obligation": "LF-3 · a later write reaches open subscriptions exactly once",
        "why": "the de-duplication is dropped, so the same write is delivered twice (exactly-once fails on 2, not only on 0)",
        "file": "composition.ts",
        "anchor": "      if (closed || seen.has(event.id)) return false\n      seen.add(event.id)",
        "broken": "      if (closed) return false",
        "kind": "test",
        "case": "LF-3 · a write reaches an open subscription exactly once",
    },
    {
        "obligation": "LF-4 · a cold cache is an empty answer with complete:false, never an absence",
        "why": "completeness is asserted unconditionally, so an incomplete answer is rendered as the whole one",
        "file": "composition.ts",
        "anchor": "    const answer: QueryResult = { events: union.answer(), complete: merged.reached && !merged.failed }",
        "broken": "    const answer: QueryResult = { events: union.answer(), complete: true }",
        "kind": "test",
        "case": "LF-4 · an empty local set is answered",
    },
    {
        "obligation": "LF-5 · a deadline resolves with what arrived and says so",
        "why": "a fired deadline reports completeness anyway — the vacuous shape the criterion was tightened against",
        "file": "composition.ts",
        "anchor": "        if (bounded === DEADLINE) return { reached: false, failed: true }",
        "broken": "        if (bounded === DEADLINE) return { reached: true, failed: false }",
        "kind": "test",
        "case": "LF-5 · a deadline resolves",
    },
    {
        "obligation": "LF-6 · a relay failure reduces completeness, never the answer",
        "why": "a failed fill reports its boundary as reached, so a degraded answer claims to be complete",
        "file": "composition.ts",
        "anchor": "      } catch {\n        return { reached: false, failed: true }\n      }",
        "broken": "      } catch {\n        return { reached: true, failed: false }\n      }",
        "kind": "test",
        "case": "LF-6 · a failing pool over a NON-EMPTY",
    },
    {
        "obligation": "provenance · the both-tier id is 'local' (D-O14(c))",
        "why": "the network copy overwrites the recorded origin, so the both-tier id collapses onto the vendor's sticky-bit defect (`#5015f4`)",
        "file": "merge.ts",
        "anchor": "    if (this.seen.has(event.id)) {\n      if (origin === 'local') this.origins.set(event.id, 'local')\n      return false\n    }",
        "broken": "    if (this.seen.has(event.id)) {\n      this.origins.set(event.id, origin)\n      return false\n    }",
        "kind": "test",
        "case": "provenance · an id both tiers produced is local",
    },
    {
        "obligation": "provenance · on P2 the precedence does not move with the call order (`#34dcaa`, W4a 0.4)",
        "why": "the upgrade is removed, so the documented tier for a both-tier id becomes whichever tier the caller opted to ask first",
        "file": "merge.ts",
        "anchor": "    if (this.seen.has(event.id)) {\n      if (origin === 'local') this.origins.set(event.id, 'local')\n      return false\n    }",
        "broken": "    if (this.seen.has(event.id)) {\n      return false\n    }",
        "kind": "test",
        "case": "provenance · on P2 (localFirst:false)",
    },
    {
        "obligation": "persist:false · this call's fill is not written back (D-O3)",
        "why": "the persistence toggle is ignored, so `persist:false` is honoured by nothing",
        "file": "policy.ts",
        "anchor": "  if (policy.honourPersist && !persist) return undefined",
        "broken": "  if (false) return undefined",
        "kind": "test",
        "case": "persist:false suppresses the write-back",
    },
    {
        "obligation": "persist:false · its POSITIVE COMPANION: persist:true does write (D-O17)",
        "why": "the write-back never reaches the endpoint, so 'suppressed' would have been true of an implementation that writes nothing at all",
        "file": "policy.ts",
        "anchor": "  const outcome = await write(written)\n  return { written, refused: outcome.refused }",
        "broken": "  return { written, refused: 0 }",
        "kind": "test",
        "case": "persist:false suppresses the write-back",
    },
    {
        "obligation": "filter boundary · a malformed identity value is rejected with the typed refusal",
        "why": "the model stops applying the first branch, so a filter the endpoint would refuse is accepted — the echoing hazard itself",
        "file": "harness.ts",
        "anchor": "        assertIdentityFilters(list)\n        const found: Event[] = []",
        "broken": "        const found: Event[] = []",
        "kind": "test",
        "case": "filter boundary · a malformed identity filter is rejected",
    },
    {
        "obligation": "filter boundary · a present-but-empty #-key list is answered as nothing",
        "why": "the match-nothing rule is inverted, so a filter that must answer nothing answers everything",
        "file": "harness.ts",
        "anchor": "    if (Array.isArray(value) && value.length === 0) return true",
        "broken": "    if (Array.isArray(value) && value.length === 0) return false",
        "kind": "test",
        "case": "filter boundary · a present-but-empty #-key list",
    },
    {
        "obligation": "filter boundary · the case FAILS over the echoing fake",
        "why": "the echoing fake is made to apply the predicate, which is exactly the property the counter-case exists to deny",
        "file": "harness.ts",
        "anchor": "        reads.push(toFilters(filters))\n        return [...store]",
        "broken": "        reads.push(toFilters(filters))\n        assertIdentityFilters(toFilters(filters))\n        return [...store]",
        "kind": "test",
        "case": "the filter-boundary case FAILS over the echoing fake",
    },
    {
        "obligation": "P4 · publish writes locally before any relay attempt (`#2ffa85`)",
        "why": "the local write is removed, so `stored` no longer reflects a write and the relay half is all that remains",
        "file": "composition.ts",
        "anchor": "    let stored = false\n    if (permitted.length > 0) {\n      const outcome = await this.writeEndpoint(permitted)\n      stored = outcome.stored > 0\n    }",
        "broken": "    const stored = true",
        "kind": "test",
        "case": "P4 · publish writes locally first",
    },
    {
        "obligation": "P6 · count never fetches (M14, D-O4)",
        "why": "count consults the seam, turning a local, always-answerable operation into a network one with a deadline and a failure mode",
        "file": "composition.ts",
        "anchor": "  async count(filters: FilterIn | FilterIn[]): Promise<CountResult> {\n    const result = await this.countEndpoint(toFilterArray(filters))",
        "broken": "  async count(filters: FilterIn | FilterIn[]): Promise<CountResult> {\n    await this.upstream.query(toFilterArray(filters))\n    const result = await this.countEndpoint(toFilterArray(filters))",
        "kind": "test",
        "case": "P6 · count answers from the local index",
    },
    {
        "obligation": "P7 · delete routes through the endpoint's removal (`#d80075`)",
        "why": "the removal is not routed at all, so the composition decides the deletion itself by doing nothing",
        "file": "composition.ts",
        "anchor": "    return this.removeEndpoint(toRefArray(refs))",
        "broken": "    return { removed: 0 }",
        "kind": "test",
        "case": "P7 · delete routes through the endpoint removal",
    },
    {
        "obligation": "D-O21 · the gate filters the ANSWER — one decision, applied at the three named sites (`#496306`, `#c90101`)",
        "why": "the fill's candidate set stops passing the gate before the union, so a rejected event is inside `events` again — the shape the suite could not see before D-O21",
        "file": "composition.ts",
        "anchor": "      const fresh = union.take(await this.gate(result.events, 'read', deadlineMs), 'network')",
        "broken": "      const fresh = union.take(result.events, 'network')",
        "kind": "test",
        "case": "one gate, applied at the three named sites",
    },
    {
        "obligation": "D-O21 · the gate is applied to the candidate set on EVERY read path, before the union",
        "why": "the local answer enters the union ungated, so a rejected id reaches `events` on both named paths",
        "file": "composition.ts",
        "anchor": "    const localEvents: Event[] = await this.gate(await this.readEndpoint(filterArray), 'read', deadlineMs)",
        "broken": "    const localEvents: Event[] = await this.readEndpoint(filterArray)",
        "kind": "test",
        "case": "the gate runs before the union on BOTH named paths",
    },
    {
        "obligation": "D-O21 · the outgoing set passes the gate before the local write and before the relay attempt (`#2ffa85`)",
        "why": "the publish path is left ungated, so an event the gate would drop is stored AND handed to the seam",
        "file": "composition.ts",
        "anchor": "    const permitted = await this.gate(\n      events.filter((event) => !isExcluded(event, this.policy.excluded)),\n      'publish',\n      DEFAULT_DEADLINE_MS,\n    )",
        "broken": "    const permitted = events.filter((event) => !isExcluded(event, this.policy.excluded))",
        "kind": "test",
        "case": "publish writes nothing the gate dropped",
    },
    {
        "obligation": "D-O21 · the gate is told the flow it is applied for and the tier the endpoint declares (`#bec31a`)",
        "why": "the context reports one flow for every call, so a consumer's rule cannot tell a publish from a read",
        "file": "composition.ts",
        "anchor": "      operation,",
        "broken": "      operation: 'read',",
        "kind": "test",
        "case": "the gate is told the flow it is applied for",
    },
    {
        "obligation": "D-O21 · the link half resolves through the injected resolver, and grows no second read path (`#7f4e0a`)",
        "why": "the injected resolver is ignored, so the rule can never reach a referenced event — and the module silently reads locally instead",
        "file": "composition.ts",
        "anchor": "    if (this.resolver !== undefined) return this.resolver(reference)",
        "broken": "    void this.resolver",
        "kind": "test",
        "case": "a link rule resolves through the injected resolver",
    },
    {
        "obligation": "D-O21 · the gate is bounded by the flow's own wall-clock budget, and an over-budget candidate is DROPPED (LF-5, `#cf8c70`)",
        "why": "an over-budget candidate is kept instead of dropped, so a hook that never answers puts its event into the answer — the gate stops being bounded in effect",
        "file": "composition.ts",
        "anchor": "      if (decision === DEADLINE) continue",
        "broken": "      if (decision === DEADLINE) kept.push(event)",
        "kind": "test",
        "case": "an over-budget gate drops its candidate",
    },
    {
        "obligation": "the exclusion list · a declared value a test reads without driving a call (`#a1e6b7`)",
        "why": "the exclusion stops being applied, so a declared (kind,label) is written back anyway",
        "file": "policy.ts",
        "anchor": "  if (excluded.length === 0) return false\n  return excluded.includes(`${event.kind}:${exclusionLabel(event)}`)",
        "broken": "  return false",
        "kind": "test",
        "case": "the excluded list is a declared value",
    },
    {
        "obligation": "no socket A · a recording, throwing endpoint and seam: the local operations still resolve, typed",
        "why": "a local-only operation is made to need the wire, so over a seam that throws it cannot resolve at all — operations stop being local",
        "file": "composition.ts",
        "anchor": "  async count(filters: FilterIn | FilterIn[]): Promise<CountResult> {\n    const result = await this.countEndpoint(toFilterArray(filters))\n    return { count: result.count, approximate: false }\n  }",
        "broken": "  async count(filters: FilterIn | FilterIn[]): Promise<CountResult> {\n    await this.upstream.query(toFilterArray(filters))\n    const result = await this.countEndpoint(toFilterArray(filters))\n    return { count: result.count, approximate: false }\n  }",
        "kind": "test",
        "case": "M5 · the local operations still RESOLVE",
    },
    {
        "obligation": "no socket · a subscription is never silently dropped (M13, `#239d01`)",
        "why": "every refusal on a subscription is swallowed, so a subscription that cannot live ends with no stated reason — red after the case's own timeout, never a hang",
        "file": "composition.ts",
        "anchor": "    const fail = (error: unknown): void => {\n      if (!closed) errors.next(asEventAccessError(error))\n    }",
        "broken": "    const fail = (error: unknown): void => {\n      void error\n    }",
        "kind": "test",
        "case": "M5 · a recording, throwing endpoint",
    },
    {
        "obligation": "no socket B · the import allow-list (`#0c7fe3`, D-O19)",
        "why": "a specifier that is neither module-relative nor a declared dependency appears — the forbidden store import itself",
        "file": "composition.ts",
        "anchor": "import { ReplaySubject, Subject, timer } from 'rxjs'",
        "broken": "import { ReplaySubject, Subject, timer } from 'rxjs'\nimport 'applesauce-core'",
        "kind": "command",
        "case": ALLOWLIST_COMMAND,
        "command": ALLOWLIST_COMMAND,
        "green_exit": 0,
    },
    {
        "obligation": "D-O5 / W4a N-5 · the endpoint's refusal is surfaced as this module's own ON THE READ PATH",
        "why": "the read path stops surfacing, so a foreign implementer's own error object reaches the caller untranslated — the half of the boundary a mutation on `count` alone cannot reach",
        "file": "composition.ts",
        "anchor": "  private async readEndpoint(filters: FilterIn[]): Promise<Event[]> {\n    try {\n      return await this.endpoint.read(filters)\n    } catch (error) {\n      throw asEventAccessError(error)\n    }\n  }",
        "broken": "  private async readEndpoint(filters: FilterIn[]): Promise<Event[]> {\n    return this.endpoint.read(filters)\n  }",
        "kind": "test",
        "case": "a FOREIGN endpoint refusal is surfaced",
    },
    {
        "obligation": "port conformance · the suite runs over a SECOND, independently written fake",
        "why": "the independently written upstream stops reporting its boundary, so the suite is proved to exercise it rather than assume it",
        "file": "harness.ts",
        "anchor": "        return { events: answer, eose: true, failures: [] }",
        "broken": "        return { events: answer, eose: false, failures: [] }",
        "kind": "test",
        "case": "the conformance suite passes over TWO",
    },
    {
        "obligation": "provenance · the P2 merge order cannot move the documented tier — the call-site half (W4a 0.4)",
        "why": "the local answer is merged under the network's name, so the tier the answer *reports* for a both-tier id depends on which path was asked rather than on which tier produced it",
        "file": "composition.ts",
        "anchor": "      union.take(localEvents, origin)",
        "broken": "      union.take(localEvents, 'network')",
        "kind": "test",
        "case": "provenance · on P2 (localFirst:false)",
    },
    {
        "obligation": "the endpoint's refusal is surfaced as this module's own on the COUNT path (E5, D-O5; W4a 0.1)",
        "why": "the count guard is dropped, so a foreign implementer's own error object reaches the caller untranslated on that verb — a different line from the read path's row, and the only other one the four-verb case reaches",
        "file": "composition.ts",
        "anchor": "  private async countEndpoint(filters: FilterIn[]): Promise<CountResult> {\n    try {\n      return await this.endpoint.count(filters)\n    } catch (error) {\n      throw asEventAccessError(error)\n    }\n  }",
        "broken": "  private async countEndpoint(filters: FilterIn[]): Promise<CountResult> {\n    return this.endpoint.count(filters)\n  }",
        "kind": "test",
        "case": "a FOREIGN endpoint refusal is surfaced",
    },
    {
        "obligation": "the subscription's own filters constrain the change fan-out (found by measurement once the store shrink landed)",
        "why": "the fan-out passes the endpoint's unfiltered change notification straight through, so a `{kinds:[1]}` subscription is handed a local kind-7 write — the store's own live path used to apply the filter, and the endpoint's `changes` cannot",
        "file": "composition.ts",
        "anchor": "        if (!matchFilters(filterArray, event)) return",
        "broken": "        if (false) return",
        "kind": "test",
        "case": "the change fan-out honours the subscription own filters",
    },
    {
        "obligation": "the fail-closed boundary precedes BOTH tiers on P2 (`#f775fb`; the re-verification wave's falsification)",
        "why": "the endpoint's read stops being the first call, so `localFirst:false` asks the seam before the predicate has answered — the raw filter reaches the wire and the fill is written back, i.e. a refusal with side effects behind it",
        "file": "composition.ts",
        "anchor": "    const localEvents: Event[] = await this.gate(await this.readEndpoint(filterArray), 'read', deadlineMs)",
        "broken": "    const localEvents: Event[] = []",
        "kind": "test",
        "case": "the boundary precedes BOTH tiers on P2",
    },
    {
        "obligation": "LF-1 · the local read precedes the seam subscription (the subscription replay path)",
        "why": "the replay's local read is emptied, so the seam is subscribed without the endpoint having been asked at all — the path stops being local-first and its answer loses the local event",
        "file": "composition.ts",
        "anchor": "      let local: Event[]\n      try {\n        local = await this.readEndpoint(filterArray)\n      } catch (error) {\n        fail(error)\n        return\n      }",
        "broken": "      const local: Event[] = []",
        "kind": "test",
        "case": "LF-1 · on the subscription path",
    },
    {
        "obligation": "a signal already aborted opens nothing (W4a 0.3)",
        "why": "the early return is disabled, so an already-cancelled signal still performs a local read and opens a seam subscription it can never cancel",
        "file": "composition.ts",
        "anchor": "    if (options.signal?.aborted) {\n      errors.next(new EventAccessError('rejected', 'the subscription was aborted before it opened'))",
        "broken": "    if (options.signal?.aborted && false) {\n      errors.next(new EventAccessError('rejected', 'the subscription was aborted before it opened'))",
        "kind": "test",
        "case": "a signal already aborted opens NOTHING",
    },
    {
        "obligation": "an endpoint declares its own tier and the merge marks by it (`#bec31a`, W4a 0.5)",
        "why": "the mark is hard-coded to 'local', so an endpoint that declares itself remote has its events mislabelled",
        "file": "composition.ts",
        "anchor": "    return this.endpoint.tier === 'local' ? 'local' : 'network'",
        "broken": "    return 'local'",
        "kind": "test",
        "case": "the endpoint declares its own tier",
    },
    {
        "obligation": "onReject · 'report' has a channel where the answer cannot carry it (`#9b7257`, W4a 0.6)",
        "why": "the report is disabled, so the policy member a test reads is inert and 'report' behaves exactly like 'skip'",
        "file": "composition.ts",
        "anchor": "              if (outcome && outcome.refused > 0 && this.policy.onReject === 'report') {",
        "broken": "              if (false) {",
        "kind": "test",
        "case": "onReject · ",
    },
    {
        "obligation": "LF-3 · the fan-out reaches EVERY open subscription (W4b S3)",
        "why": "delivery is limited to the first subscriber, so a second open subscription is starved with no reason on its error channel (M13)",
        "file": "composition.ts",
        "anchor": "          for (const subscriber of [...this.subscribers]) subscriber.deliver(next.value)",
        "broken": "          for (const subscriber of [...this.subscribers].slice(0, 1)) subscriber.deliver(next.value)",
        "kind": "test",
        "case": "LF-3 · a later write reaches EVERY open subscription",
    },
    {
        "obligation": "the filters reach both tiers unchanged and in the caller's order (`#e391d0`, W4a N-4)",
        "why": "the normaliser reorders the caller's filters, so neither tier sees what the caller wrote — the echo hazard from the composition's side",
        "file": "filters.ts",
        "anchor": "  return Array.isArray(filters) ? [...filters] : [filters]",
        "broken": "  return Array.isArray(filters) ? [...filters].reverse() : [filters]",
        "kind": "test",
        "case": "the filters reach both tiers unchanged",
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


def run_command(command):
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
    # Serialize against anything else that reads these files: for the length of one mutation
    # the tree is deliberately broken.
    lock = open(LOCK, "w")
    fcntl.flock(lock, fcntl.LOCK_EX)

    cases = suite_cases()
    lines = []
    lines.append("event-access module — evidence falsification")
    lines.append("# command:   python3 event-access/evidence/falsify.py   (the caller redirects to event-access/evidence/02-invariant-falsification.txt)")
    lines.append("# generated: %s" % subprocess.run(["date", "-u", "+%Y-%m-%dT%H:%M:%SZ"], capture_output=True, text=True).stdout.strip())
    lines.append("# bun:       %s" % subprocess.run([BUN, "--version"], capture_output=True, text=True).stdout.strip())
    lines.append("# cases in the suite: %d across %d files" % (len(cases), len({case[0] for case in cases})))
    lines.append("# lock:      %s (held for this whole run)" % LOCK)
    lines.append("#")
    lines.append("# For each evidence obligation: one mutation is applied, the named case (or the named")
    lines.append("# command) is run, the file is restored byte-for-byte (sha256 verified) and the check is run")
    lines.append("# again. A mutation whose check does NOT go red is reported FALSIFICATION FAILED.")
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
        lines.append("file:     event-access/ts/%s" % mutation["file"])
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
        lines.append("- %s" % anchor)
        lines.append("+ %s" % mutation["broken"])
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
    fcntl.flock(lock, fcntl.LOCK_UN)
    lock.close()
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
