# Friday FIPS R2 exact action-time scope

Status: **READY FOR OWNER ACTION-TIME APPROVAL; NOT APPROVED OR EXECUTED**.
`approval_ready` is now `true` only because independent static review found no
P0/P1 blocker in the exact controller and pins. That flag is not owner
authorization. The owner's approval of the FIPS objective and of planning live
changes does not authorize these root actions. The old R1 request is withdrawn.

Candidate application source: `96c81d8e23602fc9126e63cc6e05ce1f87a56ebc`.
Independent review accepted packet `94479dd03c93b474dc27929b7fe7491b02ebbd49`
for action-time approval presentation, subject to the runtime caveats below.
Build receipt: `FIPS-LOCAL-LAB-R2-BUILD-RECEIPT.json`. The current driver
proves only the outbid-return vertical slice; winner payout, reserve-unmet
return, the emergency first-spend race and VPS rollout remain outside this run.
Literal staging recipe SHA-256:
`9978d97906883c2047a6e31492626d21215fda3369a8d45eabb3f1304041938e`.

## Privileged action 1: immutable staging

The controller will never execute from the developer-writable worktree. A
future approval must authorize the literal root staging operation in
`FIPS-LOCAL-LAB-R2-STAGING-RECIPE.md`, which:

1. Refuses if `/var/lib/plebeian-friday-fips-r2-reviewed` already exists.
2. Creates that directory and only its `scripts`, `lab-bin`, and
   `.venv/lib/python3.12/site-packages` descendants as root:root.
3. Copies exactly the four source entrypoints and six executables named in the
   build receipt, the reviewed execution JSON, and the complete 6,410-file
   site-packages tree whose canonical digest is
   `5390903ab5cd9b13c2d1476b0e1aa5c28187ca85376b60d3bd02626aba3af64d`.
4. Refuses any symlink, device, socket, FIFO, non-root owner, group/other
   writable entry, extra top-level path, or post-copy hash mismatch.
5. Sets directories to 0755, scripts and lab binaries to 0755, the manifest
   and Python dependency files to 0644, and makes the entire staging tree
   root:root. No credentials or keys are staged.

The concrete copy/check sequence has now been generated after independent
review. It uses only `/usr/bin/install`,
`/usr/bin/cp`, `/usr/bin/find`, `/usr/bin/chown`, `/usr/bin/chmod`,
`/usr/bin/sha256sum`, and `/usr/bin/test` with the fixed source and destination
paths above. It may not invoke a user-writable script, package manager, shell
download, network client, or wildcard outside the reviewed site-packages tree.
The controller's own recursive check repeats ownership, mode, symlink and hash
validation before it imports the staged Nutshell tree.

This staging action is persistent only so the exact reviewed bytes cannot be
changed between approval and the one run. Removing it later is a separate
explicit cleanup action; the lab does not silently delete `/var/lib` content.

## Privileged action 2: one exact lab invocation

After staging the exact approval-ready manifest, the only proposed invocation
is:

```text
/usr/bin/python3.12 -I -S -B \
  /var/lib/plebeian-friday-fips-r2-reviewed/scripts/friday-fips-lab-r2.py \
  --manifest /var/lib/plebeian-friday-fips-r2-reviewed/FIPS-LOCAL-LAB-R2-EXECUTION.json \
  --expected-manifest-sha256 7ee10df04083c860a2c168190444765da2470c9c7bb9dd95101fe4746a9afc09 \
  --expected-harness-sha256 ed90e2ae32148f20007694bd1f9a13de090d80142b6ead9ac19c8fce7bb57468
```

No alternate manifest, path, environment-supplied topology, namespace,
address, port, cleanup target or executable is accepted. This document asks
permission only for the exact separately hashed staging recipe and one
invocation above; any later byte change requires a new review and approval.

## Exact temporary host changes

- Host: `DESKTOP-P59VRK7`, kernel
  `6.6.87.2-microsoft-standard-WSL2`.
- Create exactly five network namespaces:
  `poc-friday-fips-sw`, `poc-friday-fips-n1` through `n4`.
- Create one namespace-only bridge and four veth pairs. The host side has no
  address. Node underlay addresses are only `198.18.242.1/29` through `.4/29`.
  There is no default route, forwarding, NAT, host route, DNS or egress.
- Namespace-local nftables has input/output DROP. The host nftables ruleset is
  hash-checked before/after and is never changed.
- Run pinned jmcorgan/fips 0.5.2 (`7b26e81e…287f2`) on UDP/32121 only among
  those four RFC 2544 addresses. Each FIPS child gets only `CAP_NET_ADMIN`
  inside its node namespace. Each capture child gets only `CAP_NET_RAW` and
  records counters/hashes, not packet payloads.
- Comet listens on `[::]:26656` **inside each namespace**. Namespace nftables
  permits that port only on `fips0` from the four derived FIPS ULAs; it is not
  exposed on `under0`, the host or any public interface. RPC and the site bind
  only namespace loopback TCP/26657 and TCP/8080.
- Admission/terminal signer RPC listens on `[FIPS_ULA]:39101`, with nftables
  allowing initiation only from node 1's FIPS ULA. The signed request also
  carries a fixed application plaintext probe; capture must find zero probe
  bytes on encrypted UDP underlay packets.
- Nutshell 0.19.2/FakeWallet binds only node 1's FIPS ULA TCP/3338. The staged
  complete site-packages tree is loaded by `/usr/bin/python3.12 -I -S -B`;
  `.pth` processing and bytecode writes are disabled. A fresh 0600 throwaway
  seed, loopback SQLite state, zero input fees and no Lightning backend are
  mandatory. No real value exists.
- All application, validator, mint, signer, DKG and driver children run as
  UID/GID 1000, no capabilities, `NoNewPrivs=1`, bounded tasks/files/logs and
  parent-death handling. Only the controller is root.
- There is no systemd, `/etc`, UFW, host firewall, SSH, DNS, provider, VPS,
  public listener, file capability, package installation or persistent-access
  change.

## Ephemeral keys, fault and recovery

The run generates fresh one-run FIPS identities, four Comet node/validator
identities, four FROST DKG shares, four signer-RPC identities, one coordinator
identity and one fake-mint seed. Secrets remain mode 0600 under the single
mode-0700 `/tmp/plebeian-friday-fips-lab.20261022-r2` root and are never placed
in evidence/chat/Git. Signer 4 and validator 4 are stopped only after all four
enrollments and listeners are verified. Nodes/signers 1–3 must continue.

The admitted displaced bidder's exact refund authorization is encrypted and
persisted before consensus. Its store key is re-derived only from the
mode-0600 one-run coordinator identity and exact network/DKG/roster binding;
the store is closed and reopened before displacement. This is manager-level
reconstruction, not yet a separate pre-terminal process-crash test. Its Nostr
actor key, NUT-11 MAIN spend key and unilateral REFUND key are all zeroed
before the replacement bid can commit. The prepared result asserts each key's
absence separately. The first driver
process obtains a real 3-of-4 signature, submits
the exact fake-mint SIG_ALL spend, persists `response_unknown`, discards the
response and exits. A fresh recovery process has neither bidder key nor input
proofs; it must prove NUT-07 inputs SPENT, NUT-09 restore the exact outputs,
import and DLEQ-verify exact recipient proofs, and prove them UNSPENT. No second
mint spend is permitted.

## Bounds, cleanup and residual risks

The wall limit is 1,800 seconds; startup 60 seconds; shutdown 15 seconds before
PID/start-time/process-group-checked forced stop; each log is capped at 10 MiB.
For each synchronous helper, the controller blocks SIGINT/SIGTERM before
`Popen`, creates a new session, records the directly owned PID/process group
before restoring the signal mask, and keeps cleanup in an outer `finally`.
This closes the spawn-to-registration interruption window without broadening
which process groups the controller may signal.
Long-lived services and synchronous DKG/init/driver helpers have distinct
recorded process groups; a synchronous leader that exits with descendants is
a failure after bounded group cleanup. Cleanup signals only recorded
identities, removes only the five exact namespaces and the canonical marked
`/tmp` run root, and verifies no owned PID, namespace, fixed lab host-veth name,
root or lab listener remains. Host-veth names are recorded immediately after
creation so a failure between veth creation and namespace movement cannot be
reported clean. It recomputes the host nftables hash.
Success evidence is written only after cleanup succeeds. SIGINT/SIGTERM enter
cleanup; SIGKILL or host death can still strand temporary objects and requires
manual inspection before any retry.

The lab is four same-host namespaces under one OS/user/operator. It proves real
threshold signatures and real FIPS packet traversal, not independent operators,
HA, federal FIPS compliance or production custody. Persistent signer rollback
is bounded by the independently anchored local journal; a rollback of the whole
host plus its anchor remains outside this lab.

## Required evidence

One success artifact must bind the reviewed commit, manifest/controller/binary
and dependency pins, four ULAs, socket ownership, real Comet commit identity,
three separate signer services with signer 4 genuinely unavailable, a verified
3-of-4 FROST result, advancing `under0` and `fips0` counters, encrypted UDP
capture with zero application probe matches, refused direct-underlay
application access, NUT-07 SPENT inputs, NUT-09 exact recovery, recipient import
and NUT-07 UNSPENT outputs. It must first record four distinct validator/node
identities in one four-signature canonical commit, then record validator 4's
verified running identity and deliberate exit before the three-validator run.
Failure or cleanup evidence must never contain
bearer proofs, private keys or raw packets.
