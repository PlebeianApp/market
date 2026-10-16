#!/usr/bin/env python3
"""
signer/evidence/falsify.py — proves that the module's invariant tests are real.

A test that cannot fail is not evidence. For each invariant the module claims to
enforce, this script:

  1. records the sha256 of the file it is about to break,
  2. applies ONE mutation that breaks that invariant (asserting the anchor text
     occurs exactly once, so a mutation can never be applied by accident),
  3. runs the **named check** — a named test case, or, for the state machine, the
     three-way table diff (`evidence/transitions.py`) — and captures its own
     output and exit code,
  4. restores the file byte-for-byte and verifies the sha256 matches,
  5. runs the same case again and captures the restored result.

A mutation that does NOT make its named check fail is reported as
`FALSIFICATION FAILED` — that would mean the check is not covering the invariant
it is named for. Nothing here is committed or executed twice: the file is
restored before the run ends, and the restore is verified by hash.

The suite grew because a green test proves nothing on its own: a case named for
an invariant whose gate can be broken without the case failing is a case that
never tested the gate. Two mutations below exist for exactly that reason — the red
team showed the first pass's suite could not see the allow-list bypass (B1) or the
failed lane's unrun teardown (B2), and a suite that cannot see a defect it names
is the defect's best hiding place.

Usage:  python3 signer/evidence/falsify.py [--out signer/evidence/02-...txt]
"""

import hashlib
import os
import re
import subprocess
import sys

MODULE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TS = os.path.join(MODULE, "ts")
DEFAULT_OUT = os.path.join(MODULE, "evidence", "02-invariant-falsification.txt")
BUN = os.environ.get("BUN", os.path.expanduser("~/.bun/bin/bun"))

def bun_case(file, name):
    """A named case in the module's own suite."""
    return {"kind": "bun", "file": file, "name": name}


def command(argv, label):
    """A command run from the module directory; a non-zero exit means the check failed."""
    return {"kind": "command", "argv": argv, "label": label}


# Each mutation: the file, the unique anchor to break, the broken form, and the named
# check that must fail because of it. A check is a named case of the module's own
# suite, or a command — the state machine's table is a fact about a document and the
# code together, which no single test case can hold.
MUTATIONS = [
    {
        "invariant": "I1",
        "why": "the strict-bind gate stops dropping a bare ack, so an unknown remote signer binds on 'ack'",
        "file": "nip46.ts",
        "anchor": "\t\t\t\t\tif (await isBareAckResponse(clientSigner, item)) return null",
        "broken": "\t\t\t\t\tif (false && (await isBareAckResponse(clientSigner, item))) return null",
        "check": bun_case("invariants.test.ts", 'a bare "ack" never binds an unknown remote signer'),
    },
    {
        "invariant": "I2",
        "why": "the NIP-46 capability resolves the CLIENT key as the identity instead of the user's",
        "file": "nip46.ts",
        "anchor": "\t\tgetPublicKey: () => race('get_public_key', signer.getPublicKey(), timeoutMs),",
        "broken": "\t\tgetPublicKey: async () => (signer as unknown as { clientPubkey: string }).clientPubkey,",
        "check": bun_case(
            "invariants.test.ts",
            "behaviourally: a bound session resolves the user, not the client key nor the remote",
        ),
    },
    {
        "invariant": "I3",
        "why": "the identity assertion stops comparing the returned event's pubkey with the resolved identity",
        "file": "capability.ts",
        "anchor": "\t\t\tif (signed.pubkey.toLowerCase() !== identity) {",
        "broken": "\t\t\tif (false) {",
        "check": bun_case(
            "invariants.test.ts",
            "signEvent fails closed when the returned event pubkey differs from the authenticated identity",
        ),
    },
    {
        "invariant": "I4",
        "why": "the extension lane synthesises an encryption capability the extension does not provide",
        "file": "lanes.ts",
        "anchor": "\tif (hasEncryption(extension.nip44)) lane.nip44 = extension.nip44 as NipEncryptionCapability",
        "broken": "\tlane.nip44 = { encrypt: async () => '', decrypt: async () => '' }",
        "check": bun_case(
            "invariants.test.ts",
            "leaves nip04 and nip44 absent when the extension lacks them (fail closed)",
        ),
    },
    {
        "invariant": "I4",
        "why": "the composer's allow-list stops gating the capability set (absent allow-list exposes everything present)",
        "file": "capability.ts",
        "anchor": "\tif (!allowed || allowed.length === 0) return false",
        "broken": "\tif (!allowed || allowed.length === 0) return true",
        "check": bun_case("session.test.ts", "the composer allow-list gates the capability set"),
    },
    {
        "invariant": "I4 · B1",
        "why": "the allow-list stops gating the capability that is HANDED OUT, so currentSigner() offers the scheme the composer refused (the red team's B1 — this mutation is why the suite can see it now)",
        "file": "capability.ts",
        "anchor": "\tif (exposed.nip44) gated.nip44 = exposed.nip44",
        "broken": "\tif (capability.nip44) gated.nip44 = capability.nip44",
        "check": bun_case("invariants.test.ts", "the capability handed out through currentSigner"),
    },
    {
        "invariant": "I5",
        "why": "the vault stops rejecting an envelope whose iteration count was lowered by tampering",
        "file": "vault.ts",
        "anchor": "\tif (!Number.isInteger(parsed.iterations) || parsed.iterations < minIterations) {",
        "broken": "\tif (false) {",
        "check": bun_case("vault.test.ts", "iteration-downgrade tamper"),
    },
    {
        "invariant": "I5",
        "why": "the session persists the raw session token instead of the encrypted envelope (silent plaintext storage)",
        "file": "session.ts",
        "anchor": (
            "\t\tawait this.guard('storage', 'saveVaultedSession', () =>\n"
            "\t\t\tvault.saveVaultedSession(nbunksec, passphrase, this.wrapOptions(), deps),\n"
            "\t\t)"
        ),
        "broken": "\t\tawait deps.storage.setItem('nostr_session_v1', nbunksec)",
        "check": bun_case("session.test.ts", "a bunker session is written encrypted, and endSession clears it"),
    },
    {
        "invariant": "I5 · M1",
        "why": "the record is written BEFORE the identity is resolved, so a login that never happened leaves a vaulted session behind",
        "file": "session.ts",
        "anchor": (
            "\t\t\t\t\tawait this.activate(bundle.capability, 'bunker', attempt)\n"
            "\t\t\t\t\tawait this.persist(bundle.nbunksec)"
        ),
        "broken": (
            "\t\t\t\t\tawait this.persist(bundle.nbunksec)\n"
            "\t\t\t\t\tawait this.activate(bundle.capability, 'bunker', attempt)"
        ),
        "check": bun_case("session.test.ts", "a lane that fails while resolving its identity"),
    },
    {
        "invariant": "B2",
        "why": "a failed lane's teardown is dropped without being run, so the relay subscription it opened stays open (the red team's B2)",
        "file": "session.ts",
        "anchor": "\t\tawait this.runTeardown(attempt)",
        "broken": "\t\t// the teardown is dropped without being run",
        "check": bun_case("nip46.test.ts", "a failed lane releases what it opened"),
    },
    {
        "invariant": "B2 · M6",
        "why": "a `locked` session can no longer be ended, so the record it parked on cannot be cleared",
        "file": "session.ts",
        "anchor": "\tlocked: ['restoring', 'failed', 'closing'],",
        "broken": "\tlocked: ['restoring', 'failed'],",
        "check": bun_case("session.test.ts", "endSession clears the persisted record from"),
    },
    {
        "invariant": "M2",
        "why": "the connect URI (which carries the secret) reaches the caller's sink before the lane's ports are checked",
        "file": "session.ts",
        "anchor": (
            "\t\t\t\t\tconst transport = requireTransport(this.transport())\n"
            "\t\t\t\t\tconst clock = requireClock(this.clock())"
        ),
        "broken": (
            "\t\t\t\t\tconst transport = requireTransport(this.transport())\n"
            "\t\t\t\t\tconst clock = this.clock() as ClockPort"
        ),
        "check": bun_case("session.test.ts", "refuses before the URI reaches the sink"),
    },
    {
        "invariant": "M3",
        "why": "the declared `signerKind` pin is read by nothing again, so a session starts on any lane the caller names",
        "file": "session.ts",
        "anchor": "\t\tif (this.settings.signerKind && this.settings.signerKind !== input.lane) {",
        "broken": "\t\tif (false) {",
        "check": bun_case("session.test.ts", "signerKind pins the lane"),
    },
    {
        "invariant": "M6",
        "why": "the table the implementation enforces gains an edge the spec's list and the diagram do not carry",
        "file": "session.ts",
        "anchor": "\tclosing: ['idle'],",
        "broken": "\tclosing: ['idle', 'active'],",
        "check": command(["python3", "evidence/transitions.py"], "python3 signer/evidence/transitions.py"),
    },
    {
        "invariant": "M7",
        "why": "a failing host port escapes as the host's own raw error instead of a typed refusal",
        "file": "session.ts",
        "anchor": "\t\t\tif (error instanceof SignerError) throw error",
        "broken": "\t\t\tif (true) throw error",
        "check": bun_case("session.test.ts", "a port that fails is a typed refusal"),
    },
    {
        "invariant": "N1",
        "why": "the abandoned-attempt guard is gone, so a lane still in flight re-activates a session that was already ended",
        "file": "session.ts",
        "anchor": "\t\tif (attempt !== undefined && attempt !== this.attempt) {",
        "broken": "\t\tif (false) {",
        "check": bun_case("session.test.ts", "ending a session while a lane is in flight"),
    },
]


def sha256(path):
    with open(path, "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()


def run_check(check):
    """Run one named check; return (exit code, output, the command it ran).

    A check is a named case of the module's own suite, or a command, for the one
    thing a test case cannot hold: the state machine's table is a fact about a
    document and the code together, so it is checked by `evidence/transitions.py`.

    The case name is passed **escaped**: `bun test -t` treats its argument as a
    regular expression, so a name containing `(fail closed)` matched no case at
    all and its non-zero exit was read as "the named case failed" — the defect
    class this whole script exists to prevent, found in its own evidence (one row
    of the 16, the I4 extension-lane mutation). `did_not_run` is the guard: a
    check that never ran cannot falsify anything.
    """
    if check["kind"] == "bun":
        pattern = re.escape(check["name"])
        command_line = 'cd signer/ts && bun test %s -t "%s"' % (check["file"], pattern)
        proc = subprocess.run(
            [BUN, "test", check["file"], "-t", pattern],
            cwd=TS,
            capture_output=True,
            text=True,
            timeout=600,
        )
        return proc.returncode, (proc.stdout + proc.stderr).strip(), command_line
    proc = subprocess.run(check["argv"], cwd=MODULE, capture_output=True, text=True, timeout=600)
    return proc.returncode, (proc.stdout + proc.stderr).strip(), check["label"]


def did_not_run(output):
    """True when the runner reports that the filter matched no case at all.

    A non-zero exit from "matched 0 tests" is a name mismatch, not a failing
    assertion: it says nothing about the invariant, so it can never be evidence
    that the invariant is covered.
    """
    return "matched 0 tests" in output or "0 tests matched" in output


def main():
    out_path = DEFAULT_OUT
    if "--out" in sys.argv:
        out_path = os.path.abspath(sys.argv[sys.argv.index("--out") + 1])

    lines = []
    lines.append("signer module — invariant falsification")
    lines.append("# command:   python3 signer/evidence/falsify.py")
    lines.append(
        "# generated: %s" % subprocess.run(["date", "-u", "+%Y-%m-%dT%H:%M:%SZ"], capture_output=True, text=True).stdout.strip()
    )
    lines.append("# bun:       %s" % subprocess.run([BUN, "--version"], capture_output=True, text=True).stdout.strip())
    lines.append("#")
    lines.append("# For each named invariant: one mutation is applied, the named check is run, the file is")
    lines.append("# restored byte-for-byte (sha256 verified) and the check is run again. A mutation whose check")
    lines.append("# does NOT fail is reported FALSIFICATION FAILED. A check is either a named case of the")
    lines.append("# module's own suite, or a command — the state machine's three-way table diff is a command,")
    lines.append("# because the thing that can drift is a document, not a function.")
    lines.append("#")
    lines.append("# Two harness rules, both earned: the case name is escaped before it reaches the runner,")
    lines.append("# whose filter is a regular expression (a name containing `(fail closed)` used to match no")
    lines.append("# case at all, and its non-zero exit was read as a failing assertion); and a check that")
    lines.append("# matched no case, or that is not green again on the restored file, is counted as a")
    lines.append("# failure — it is a defect in this harness or in the suite, never evidence for an invariant.")
    lines.append("")

    failures = 0
    for index, mutation in enumerate(MUTATIONS, 1):
        path = os.path.join(TS, mutation["file"])
        original = open(path).read()
        before = sha256(path)
        anchor = mutation["anchor"]
        occurrences = original.count(anchor)

        lines.append("=" * 78)
        lines.append("mutation %d — %s" % (index, mutation["invariant"]))
        lines.append("breaks:   %s" % mutation["why"])
        lines.append("file:     signer/ts/%s" % mutation["file"])
        lines.append("sha256:   %s (before)" % before)
        lines.append("anchor occurrences: %d (must be exactly 1)" % occurrences)
        lines.append("")

        if occurrences != 1:
            lines.append("RESULT: FALSIFICATION FAILED — the anchor is not unique in %s" % mutation["file"])
            lines.append("")
            failures += 1
            continue

        lines.append("$ the mutation applied (old -> new):")
        lines.append("- %s" % anchor.replace("\t", "    "))
        lines.append("+ %s" % mutation["broken"].replace("\t", "    "))
        lines.append("")

        try:
            open(path, "w").write(original.replace(anchor, mutation["broken"], 1))
            code, output, command_line = run_check(mutation["check"])
        finally:
            open(path, "w").write(original)

        after = sha256(path)
        lines.append("$ %s" % command_line)
        lines.append(output)
        lines.append("exit: %d" % code)
        lines.append("")
        lines.append("$ sha256 after restore: %s (must equal the line above)" % after)
        lines.append("restore verified: %s" % ("yes" if after == before else "NO — THE FILE WAS NOT RESTORED"))
        lines.append("")

        broke_it = code != 0 and not did_not_run(output)
        never_ran = did_not_run(output)
        lines.append(
            "RESULT: %s — %s"
            % (
                (
                    "FALSIFICATION FAILED (the check never ran)"
                    if never_ran
                    else "FALSIFIED (the invariant is really covered)"
                    if broke_it
                    else "FALSIFICATION FAILED (the check stayed green)"
                ),
                (
                    "the filter matched no case, so this row proves nothing about the invariant and is counted as a failure"
                    if never_ran
                    else "the named check failed under the mutation"
                    if broke_it
                    else "the named check did not fail under the mutation"
                ),
            )
        )
        if not broke_it:
            failures += 1
        if after != before:
            failures += 1

        code_after, output_after, _ = run_check(mutation["check"])
        restored_green = code_after == 0 and not did_not_run(output_after)
        lines.append("")
        lines.append("$ ...and the same check on the restored file:")
        lines.append(output_after)
        lines.append("exit: %d   (0 = green again)" % code_after)
        lines.append(
            "the check is green again on the restored file: %s"
            % ("yes" if restored_green else "NO — the check does not pass on the restored tree, which is not the mutation's doing and is counted as a failure")
        )
        lines.append("")
        if not restored_green:
            failures += 1

    lines.append("=" * 78)
    lines.append(
        "%d mutation(s) applied, %d falsification failure(s)"
        % (len(MUTATIONS), failures)
    )
    lines.append(
        "every mutated file was restored and its sha256 verified; the module's tree is as it was before this run."
    )

    with open(out_path, "w") as handle:
        handle.write("\n".join(lines) + "\n")
    print("wrote %s" % out_path)
    print("%d mutation(s), %d falsification failure(s)" % (len(MUTATIONS), failures))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
