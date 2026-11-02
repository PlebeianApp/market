# Friday R19 read-only DKG input validator

Status: **LOCAL-ONLY COMPOSITE REVIEW CANDIDATE — NOT APPROVED OR RUN REMOTELY**

This proposal preserves the failed R18 ceremony, its slot-1 lock, all four
endpoint-only transport files and every journal/courier receipt. It does not
authorize lock removal, same-run replay, another DKG run, a service start, a
listener, a firewall change or any other host mutation.

## Pinned source and artifact

- Rust participant source:
  `cashu-wrapper/frost-participant-3of4/src/main.rs`, SHA-256
  `d02e6610672f5ebdb4a51d76f8814594513a0642aaf1e6606e3cae084e535c1a`
- standalone entrypoint:
  `cashu-wrapper/frost-participant-3of4/src/dkg_input_validator_main.rs`,
  SHA-256 `419e80300c675e299e61651973da467e8e8f7b0275c26b9c62212ce67da3e61a`
- compiled CLI regression:
  `cashu-wrapper/frost-participant-3of4/tests/dkg_input_validator_cli.rs`,
  SHA-256 `c971f4419c6c0916aee5304575024510ec84ed4f5ed169125ea8a5aa7955ca3e`
- Cargo manifest / lock:
  `c91d146ffefc1ceb2fdb19c0b1034018390596ba1633eec4133ca872e5ab7eab` /
  `5adbd1be21d7a28b9b52f58bfc43c670673059f1f1e97f14bf064189270dbec8`
- release artifact:
  `live-bin-friday-candidate-r19-diagnostic/plebeian-friday-dkg-input-validator`,
  SHA-256 `243910674f59a3cbb4c22a9ef3e351bd35fd75d6bd8fc49101ffdba1bddb9098`,
  762544 bytes, mode 0755.

The artifact was built offline with Cargo/rustc 1.86.0 and the locked dependency
tree. Link-time reachability inspection found only the validator's fixed output
contract and input-validation errors; the participant's DKG/signing command
usage strings are absent. The executable accepts exactly two paths. It has no
state/output path, network/listener API or entropy call reachable from its
entrypoint.

The independently reviewable TypeScript repair set is pinned as follows:

- host source/test: `38061d4189a39fdae5afbec4690aa1907676c72827f98e6bd7a256472fc1097f` /
  `a0d0219fac4dee698065f65431191ddca8dbdcba484d50454ac3dbae8d303ce8`;
- bootstrap source/test/V2 test:
  `4e2a841d1d20afc7395d109b59e6928e5397c766195e2c221b1c76fc64899457` /
  `fe0e9413f2d76f862706ca3c20f37ad4845dee8ea5be0610e0a5294be58d4b50` /
  `beb3d4423d636bcdbe24effd3aefa01cbf0fc5df33afa585fa1df225d710264f`;
- relay source/test: `74e6f96ead45795b72beed548701c1af9eaea41ef16b7b06399734afbda640b0` /
  `73e7a80c1214f3558558e9441d2a6348fe3ce5369031a8f5f71b0f6191859a12`.

These files align the TypeScript verifier with Rust k256's
`SHA-256(frame)` signing contract and distinguish typed diagnostic overflow
from an otherwise unknown child wait/stream outcome.

## Read-only behavior

The validator opens both inputs read-only using `O_NOFOLLOW|O_NOATIME`, records
descriptor identity, then rejects any change in device, inode, link count,
mode, owner, group, size, mtime or ctime across the bounded read. It performs a
second pathname-to-descriptor identity and canonical-path check after the
read. The protected transport
file must deny all group/world access. Paths must be absolute and canonical;
each input is limited to 1 MiB. It then calls the same `validate_config` and
`validate_transport` functions used before R18 round one acquires
`participant.lock` or calls `OsRng`.

The validator **does read and parse the private transport credentials in memory
on V1**. They never leave V1. The serialized buffer, parsed secret strings and
decoded pairwise arrays are zeroized on drop; duplicate checking retains only
references to the zeroizing source strings rather than ordinary secret-byte
copies. Core dumps are disabled for the proposed invocation. No field, digest
or raw error is printed. The only output contract is:

- success: exit 0, stdout `DKG_INPUT_VALIDATION_OK`, empty stderr;
- failure: exit 1, empty stdout, exactly one of
  `DKG_INPUT_VALIDATION_FAILED:ARGUMENTS`, `CONFIG_READ`, `CONFIG_INVALID`,
  `TRANSPORT_READ`, or `TRANSPORT_INVALID` on stderr.

## Current-state preservation gate

The earlier diagnosis retained the final two journal records but did not retain
the SHA-256, byte size and exact link count of the **complete** journal. Those
values cannot be reconstructed safely from the summary, and a digest observed
now cannot prove historical immutability. The reviewed remedy is one composite
operation rather than two approval cycles.

After create-once artifact sealing, the helper collects a bounded sanitized
baseline labeled `CURRENT_STATE_NOT_HISTORICAL_PROOF`, persists it root-owned
mode 0600, immediately recollects every field, and invokes the validator once
only if the two JSON objects are identical. Any mismatch writes a fixed
sanitized failure outcome and stops without invocation or retry.

The baseline contains only journal hash/size/uid/gid/mode/link-count, exact
eight-transition validation, config/transport metadata, current and recorded
dead-owner boot IDs, empty-state/absent-output booleans, and process absence.
It never returns journal records, config contents, a transport digest,
transport contents, command lines or process environments. `/proc/*/exe`
inspection fails closed on permission denial and compares executable device
and inode as well as pathname, so a hard link cannot evade the gate. Bounded
file reads continue through EOF and require the byte count to equal the opened
descriptor's size.

## Proposed V1-only composite action — not yet approved

Fresh preflight must first prove the R18 slot-1 lock, journal, empty private
state metadata and missing public round-one output are unchanged; no DKG host
or participant process may exist. It must also prove the exact R18 config and
transport paths remain regular, canonical, single-link files with their
recorded ownership/modes, without reading their contents.

The complete literal staging and invocation is pinned in
`FRIDAY-R19-READONLY-DKG-INPUT-VALIDATOR-ACTION.json`. It uses the existing
pinned SSH identity/host key, a create-exclusive root-only staging directory,
`renameat2(RENAME_NOREPLACE)`, file and parent `fsync`, and create-once
sanitized evidence. The helper source/test are pinned as:

- `scripts/friday-r19-validator-action.py`:
  `e4276bd77eb5815523aee726d008266ae49df5c05f20484db5fd74673bd6e1b3`;
- `scripts/friday-r19-validator-action.test.py`:
  `3cf8e914540cf8b1e34733bae56fbf0fd59f48abbb326e19047cfba2736cd960`.

Stage the pinned standalone artifact create-once as root-owned mode 0755 at:

```text
/opt/plebeian-auctions-friday/releases/r19-input-validator/plebeian-friday-dkg-input-validator
```

The upload staging directory remains root-only mode `0700`. Immediately before
atomic no-replace promotion it is sealed root-owned mode `0755`; the final
release is reverified at `0755`, so service UID/GID `997:986` can traverse the
parent and execute the pinned file. A disposable unprivileged fixture executes
the promoted file through the final path. Cross-UID root/service execution is
still NOT_RUN and remains a live preflight gate.

After reopening and hashing that installed inode, the one proposed invocation
is the following literal command, with a 30-second outer timeout:

```text
/usr/bin/prlimit --core=0:0 -- \
  /usr/bin/timeout --signal=TERM --kill-after=5s 30s \
  /usr/bin/unshare --net -- \
  /usr/bin/setpriv \
    --reuid=plebeian-friday --regid=plebeian-friday --clear-groups \
    --no-new-privs --bounding-set=-all --inh-caps=-all --ambient-caps=-all \
  /opt/plebeian-auctions-friday/releases/r19-input-validator/plebeian-friday-dkg-input-validator \
  /var/lib/plebeian-auctions-friday/frost/keyset-v1/participant.config.json \
  /var/lib/plebeian-auctions-friday/frost/keyset-v1/transport-secrets.json
```

The action must stop on access denial, hash mismatch, unexpected prestate,
timeout, signal or any output outside the fixed contract. It must not retry.
Only the new root-owned release directory/artifact would persist; R18 state is
otherwise read-only.

## Local evidence

- Rust unit and CLI tests: 23/23 pass (22 unit + 1 compiled CLI integration).
- The compiled standalone artifact passed the disposable valid fixture with
  exact exit/stdout/stderr, and rejected a secret-sentinel fixture with only
  `TRANSPORT_READ`.
- Across each invocation, device, inode, mode, uid, gid, size, SHA-256, mtime
  and ctime of all inputs were byte-for-byte unchanged; no new fixture entry
  appeared.
- TypeScript host test under the compiled baseline Bun runtime: 15/15 pass,
  75 assertions, including the exact pinned Rust round-one child and direct
  non-overflow stream-failure classification.
- Bootstrap suites: 14/14 pass, 71 assertions.
- Relay pure suite: 8/8 pass, including the agreement hash-contract mutation
  matrix. Its unrelated
  local child-pipe test remains blocked by the previously recorded sandbox
  `EPERM` and is not counted.
- Friday TypeScript typecheck and `git diff --check`: pass.
- Create-once staging/promotion/evidence helper fixtures: 2/2 pass, including
  the core-disabled, network-isolated, capability-free inner argv, complete
  journal mutation rejection, exact config/transport metadata, and an actual
  fake `/proc/PID/exe` detection fixture.

## Recovery proposal after the read-only result

Even a validator success does not authorize replay. R18's original child exit
is unavailable, and the current no-replay contract remains controlling.

The smallest reviewable recovery is two later, separately approved actions:

1. Write one create-once, root-controlled R18 abort marker binding the exact old
   manifest/run/keyset, all four signed persist-transport receipts, slot-1 dead
   wrapper PID/boot/start-ticks, slot-1 journal/lock identity, metadata-only
   empty state listing and absent public round-one output. All future drivers
   must reject that aborted run permanently. The marker must not delete any
   R18 file or claim that absence proves no ephemeral secret ever existed.
2. Start a separately reviewed fresh run with a new run ID, manifest digest,
   committee keyset ID/version, keyset root, exchange/journals, courier claims
   and newly derived run-bound pairwise transport credentials. Existing
   long-lived per-host enrollment identities may authenticate the new manifest,
   but no R18 private transport content, nonce, share, lock or journal may be
   copied or reused.

Neither action is implemented or authorized by this document. A validator
failure would instead require repairing the specific fixed category locally
before proposing any abort/new-run action.
