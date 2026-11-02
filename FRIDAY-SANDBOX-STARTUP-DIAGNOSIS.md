# Friday Sandbox Startup Diagnosis

Date: 2026-10-21 UTC. Scope: local throwaway Nutshell startup only.

## Observations

The two preserved in-sandbox failures stopped at Uvicorn's `Waiting for
application startup` with a zero-byte mint SQLite database. They never logged
`Starting mint ledger`; FakeWallet backend inspection showed no external
startup request. Fresh ports and roots were used, and no stale owned mint
process survived either cleanup.

A bounded in-sandbox discriminator produced:

- synchronous `sqlite3`: PASS;
- a normal worker thread running `sqlite3`: PASS;
- direct `aiosqlite.connect`: TIMEOUT after its worker had set the connection,
  emptied its queue and remained alive;
- a worker calling `loop.call_soon_threadsafe`: the callback was delivered only
  when the three-second timeout timer woke the loop, then the wait timed out.

This locates the stall at the restricted sandbox's asyncio cross-thread wakeup,
not database locking, key derivation, FakeWallet, an external backend, a stale
port or the `/v1/info` readiness path.

The same disposable `aiosqlite` create-table diagnostic was then submitted
through the normal elevated-execution review with `require_escalated`. The
review approved it; outside the restricted sandbox it completed and cleaned its
temporary root. This was not a retry after a denial and did not route around a
denied action. Isolated local tests were already in scope; no external endpoint,
credential, persistent service, firewall or live host was used.

## Preflight self-match

The first full-harness preflight did not launch a service. Its process scan
matched its own current Bash command because that command text contained the
future `bash scripts/friday-process-crash.sh` invocation. The exact self-match
was PID `1134356`; the gate exited 76. No test evidence or temporary harness
root was created by that attempt.

The corrected gate passed the current shell's exact PID as `me=$$` and excluded
only rows with `$1 == me`. It still rejected every other exact `bun` or `mint`
process and every other Bash process actually executing
`scripts/friday-process-crash.sh`. It did not change Claude's R3 gate, rename a
process, exempt an unrelated wrapper or kill any process.

The successful preflight shell PID itself was not persisted before its
`exec timeout` replacement and cannot truthfully be reconstructed after exit.
The final harness Bash PID is `1148174`, encoded in every final evidence
filename. Its child/service PIDs and exact start/stop/wait outcomes are recorded
in `evidence/friday-process-manifest-20261021T224928Z-1148174.jsonl`; the final
`post_scan` states that all recorded owned PIDs were absent. This is the
available ancestry/ownership evidence; no stronger PPID claim is made after
`/proc` entries were reaped.

The five historical preserved roots were checked only for continued presence;
they were not opened, cleaned or attributed to this final run. The final run's
owned root was `/tmp/plebeian-friday-crash.GPawm6` and its manifest records
that root's removal. No claim is made that an absence-only scan can reconstruct
the exact exit time or root ownership of an older, already-reaped namespace.

## Result

Running the unchanged loopback-only mint topology outside the restricted
sandbox cleared startup in roughly two seconds. The final corrected process
harness exited 0 and removed its owned root. The five older preserved
`/tmp/plebeian-friday-mint.*` roots were not deleted.
