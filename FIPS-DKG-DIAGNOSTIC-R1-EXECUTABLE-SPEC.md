# FIPS DKG Diagnostic R1 executable specification

This packet diagnoses only the process boundary that failed in the R3 lab. It is not a FIPS transport run, auction settlement, deployment, or evidence that the original `SIGILL` is fixed.

## Single allowed child

The root controller may launch exactly one synchronous child, in `/home/maximoto`, through:

```text
/usr/bin/env -i
  HOME=/tmp/plebeian-friday-fips-lab.20261022-dkg-r1
  LOGNAME=maximoto PATH=/usr/bin:/bin USER=maximoto
  XDG_RUNTIME_DIR=/tmp/plebeian-friday-fips-lab.20261022-dkg-r1/runtime RUST_LOG=info
/usr/bin/setpriv --reuid=1000 --regid=1000 --clear-groups
  --inh-caps=-all --ambient-caps=-all --bounding-set=-all --no-new-privs --pdeathsig=TERM --
/usr/bin/prlimit --core=0:0 --fsize=10485760:10485760 --nofile=256:256 --nproc=128:128 --
/var/lib/plebeian-friday-fips-dkg-r1-reviewed/lab-bin/plebeian-friday-frost-dkg provision
  --config /tmp/plebeian-friday-fips-lab.20261022-dkg-r1/application.json
  --participant-binary /var/lib/plebeian-friday-fips-dkg-r1-reviewed/lab-bin/coco-demo-frost-participant-3of4
  --inspector-binary /var/lib/plebeian-friday-fips-dkg-r1-reviewed/lab-bin/coco-demo-frost-public-inspect
  --phase-journal /tmp/plebeian-friday-fips-lab.20261022-dkg-r1/dkg-phase.jsonl
  --output /tmp/plebeian-friday-fips-lab.20261022-dkg-r1/dkg-result.json
```

The DKG executable may spawn only its pinned Rust participant and public inspector as required by the dealerless four-party DKG. No component has a listener or networking code in this path.

## Phase evidence

Each journal line has exactly `schema`, `stage`, `status`, and `unix_ms`. Stage and status are closed enumerations. The file contains no run ID, participant ID, key, proof, configuration payload, command output, error text, or stack trace. Every append is fsynced.

Raw stdout, stderr, DKG state and keys remain inside the temporary root and are removed after their hashes/sizes and fixed phase records are recorded. Neither raw stream content nor DKG result content enters evidence. A successful child must emit the complete fixed phase sequence in order; a terminal `cli_complete` alone is insufficient.

## Limits and cleanup

- One attempt under pinned GNU `timeout`: `TERM` at 300 seconds and `KILL` 60 seconds later, creating a 360-second hard outer bound except for an uninterruptible kernel state. The child itself is limited to 240 seconds, leaving at least 60 seconds before the soft stop for identity-verified shutdown, validation, cleanup and evidence persistence. A forced kill can leave the owned root/pending evidence and requires inspection rather than retry.
- Core dumps disabled; 10 MiB output/file cap, 256 descriptors and 128 processes.
- The controller records PID/start ticks and owns one new session/process group.
- `SIGINT`/`SIGTERM` enter the same guarded cleanup path. Additional such signals are blocked while cleanup and evidence persistence complete; `SIGKILL` and host failure remain abnormal.
- The group is signalled only while the exact leader PID/start-time/session identity remains live. After that leader exits the numeric PGID is never signalled again; a group whose absence cannot be proved blocks root deletion.
- Normal cleanup requires the exact root inode, root owner/group/mode, exact marker inode/content and a proved-absent process group.
- The controller removes only `/tmp/plebeian-friday-fips-lab.20261022-dkg-r1`.
- An identity mismatch or surviving group refuses deletion and reports a cleanup blocker. Abrupt `SIGKILL` or host shutdown requires inspection and separate cleanup approval.

Before any child launch, the controller exclusively reserves `evidence/outcome.pending` inside the root-owned mode-0700 staging tree. It writes and fsyncs the sanitized result through that already-open descriptor, then creates `evidence/outcome.json` with a no-replace hard link before unlinking the pending name. A reservation conflict refuses before execution; a persistence failure is reported as such and leaves the pending file for inspection. This avoids both overwriting evidence and a writable top-level `/tmp` race. The root-owned staging tree and one sanitized outcome file persist. They contain no credential material.

Static source inspection establishes that the allowlisted DKG command path has no namespace, listener, FIPS-service or network operation. The evidence flag for that boundary is a declared source property, not kernel-observed traffic evidence. Python's standard library, ELF interpreter and shared libraries are host dependencies rather than a hermetic closure; the interpreter executable itself is pinned.
