# Friday R15 identity and enrollment action

Status: **BLOCKED and superseded; do not authorize or execute**.

Independent review found that this combined packet incorrectly included the
unreviewed coordinator/manifest lane. Use the separately narrowed
`FRIDAY-R15-ENROLLMENT-ONLY-ACTION.md` for enrollment. The coordinator and
manifest composer require create-once recovery, external ordered host-pin
inputs, and durable output repairs before a new packet can be proposed.

This is one bounded, create-once final-host stage. It installs four exact R15
ceremony artifacts, creates each validator's local enrollment identities, and
creates the coordinator RPC identity on V2. It starts no service, opens no
listener, runs no DKG round, creates no FROST share, Comet key, mint key or
browser key, and does not activate funding.

## Approval request

May the operator stage the receipt-pinned R15 ceremony binaries and existing
owner-pinned host record on each of the four demo validators, then run each
host's enrollment initializer once and the V2 coordinator initializer once?

Each private key remains on its final host. The action exports only the four
authenticated public enrollment records, V2's coordinator public record, and
their composed public manifest/digest. It does not run the ceremony or any
service. A failed or uncertain create-once operation is preserved for
inspection and is never automatically retried or regenerated.

## Immutable inputs

- Artifact source commit/tree:
  `15e108acede739312d90291e0dad4b963e6f9117` /
  `6b1b18a1b5e26b7ece4d61c9e04b3464fc40101a`.
- Build receipt: `FRIDAY-CANDIDATE-R15-BUILD-RECEIPT.json`, SHA-256
  `f95bd9c5ab39c15d9bbeb9b07736284f428c89850cfa540221c1a7b7d98ff49a`.
- Versioned destination:
  `/opt/plebeian-auctions-friday/releases/r15-15e108a/`.
- Host enrollment root on each final host:
  `/var/lib/plebeian-auctions-friday/frost/keyset-v1`.
- Coordinator root on V2 only:
  `/var/lib/plebeian-auctions-friday/coordinator`.
- Root-controlled attempt receipts:
  `/var/lib/plebeian-auctions-friday-operator/dkg-enrollment-r15/`.

Exact executable hashes:

| artifact | destination basename | SHA-256 | hosts |
|---|---|---|---|
| repaired enrollment initializer | `plebeian-friday-dkg-enrollment-init` | `35f0ea080c3dd4bd73d614032da9d719ee3f2a651c0584cf58a1ece62649f6ad` | V1-V4 |
| coordinator/manifest tool | `plebeian-friday-dkg-deployment` | `bf6d9d2db4a855014674668728c35b6b0c5754dab96cb7dab9b5b4c3f6fd413f` | V2 |
| FROST participant | `coco-demo-frost-participant-3of4` | `ed2014392707a00387570a56708e32dc7f7a50e3ab3acb11fb58672d75c7e578` | V1-V4 |
| public inspector | `coco-demo-frost-public-inspect` | `ee880c7f376a8d8b2ba6b1dde6388f64b0de36c0857371f656ebabe055d18b0f` | V1-V4 |

The two Bun standalone executables are Linux x86-64 ELF files using
`/lib64/ld-linux-x86-64.so.2` and only `libc`, `libpthread`, `libdl` and
`libm`. The action installs no package or dependency. Each host must already
provide the loader/libraries and must pass the compiled harmless
`self-test-no-replace` gate before any enrollment key is created.

The existing four pin files remain the ceremony identity even though R15
contains the repaired implementation. Their run names are intentionally not
silently rewritten:

- deployment: `friday-demo-20261023-r14`;
- application run: `friday-demo-20261023-r14-run1`;
- DKG run: `friday-demo-20261023-r14-dkg1`;
- keyset: `friday-demo-frost-keyset-v1`, version `1`.

| slot | final host / IPv4 | host-pin file SHA-256 | canonical pin digest |
|---:|---|---|---|
| 1 | `linode-108175009` / `172.105.64.142` | `53fb79b8043bdae154546d8a84f818d6d266365112ef929e596258e47802a57a` | `fbfc366911d0bb1f28f4206fe32762268255c952afcc2f61d41af4d5d327a8e9` |
| 2 | `linode-108236985` / `172.105.95.57` | `f3974192bd79fba5219361b8bfd3ee101519ad35fef233515c5c8beca885bee7` | `d8f1590d3c9a36833816eb134aee55d9368bcca35332b1d4d431d28b69568dda` |
| 3 | `linode-108237290` / `172.104.240.217` | `212a5f1ecd63dee7c479f22cb79b491a4eec786a5c281b08cb838b8f44d87c1b` | `36c82f63960c58f27f7babfeaabcc91a6915e12c74078bc1e542bf9201f3601e` |
| 4 | `linode-108237424` / `172.104.253.247` | `941b27295cc52f7d2d1253c2720f9684fea463b2e6675a2ec726e1ee76f0e0d6` | `230a5d64a0ab2a81ba08f7175737b2ec53060f31e370b55af0f019af0574bc83` |

## Keys and exact destinations

Every private file is service-owned, single-link, non-symlink mode 0600 below
a service-owned, real mode-0700 directory. Numeric UID/GID values are resolved
and recorded separately on each host; equality across hosts is never assumed.

| material | type | final destination | host |
|---|---|---|---|
| DKG enrollment identity | secp256k1 Schnorr, 32-byte private scalar | `frost/keyset-v1/identity-signing-key.hex` | each host, local only |
| DKG transport identity | X25519, 32-byte private key | `frost/keyset-v1/kex-private-key.hex` | each host, local only |
| signer RPC identity | secp256k1 Schnorr, 32-byte private scalar | `frost/keyset-v1/signer-rpc-identity.key` | each host, local only |
| participant configuration | non-secret exact JSON | `frost/keyset-v1/participant.config.json` | each host |
| future participant state | empty private mode-0700 directory | `frost/keyset-v1/state/` | each host |
| signed public enrollment | public identities plus possession signatures | `frost/keyset-v1/exchange/friday-demo-20261023-r14-dkg1/participant-SLOT.host-enrollment.json` | each host; only this record is exported |
| coordinator RPC identity | secp256k1 Schnorr, 32-byte private scalar | `coordinator/coordinator-rpc-identity.key` | V2 only |
| coordinator public identity | x-only secp256k1 public key and run bindings | `coordinator/coordinator-rpc-identity.public.json` | V2; public record exported |

This stage creates no pairwise AEAD key. A later ceremony must still enforce
that each pairwise key exists at exactly its two endpoints. V2, participant 2,
may eventually hold only `1-2`, `2-3` and `2-4`; it must never receive
`1-3`, `1-4` or `3-4`.

## Fresh preflight and stop conditions

Before copying or creating anything, perform one bounded read-only inventory
on all four hosts using the already reviewed SSH identity, pinned host-key
file, `BatchMode=yes`, no agent forwarding and no alternate access route.
Stop the whole action before mutation if any item differs:

1. SSH identity fingerprint, host key, hostname/slot/IP and boot ID match the
   recorded inventory. The service account/group exists, is nologin, and the
   account is not root. Resolve and record its local UID/GID.
2. Wednesday validator PID is present with zero restart change. Every Friday
   application unit is stopped; no Friday participant/coordinator process or
   listener exists. The persistent FIPS identity and public receipt match the
   accepted public records; do not alter them.
3. At least 2 GiB memory and 20 GiB disk are free. The loader and four shared
   libraries above resolve without installing anything.
4. The release destination is absent. All parent directories are real,
   non-symlink and root-owned/non-writable by the service account.
5. The local enrollment parent
   `/var/lib/plebeian-auctions-friday/frost` is a real service-owned mode-0700
   directory. The final `keyset-v1`, `.keyset-v1.initializing`, and
   `.keyset-v1.enrollment-init.lock` paths are all absent.
6. V2's coordinator root is absent or is an empty real service-owned
   mode-0700 directory. Both coordinator identity files are absent. One file
   without the other is an inspection-only partial outcome and blocks the
   action.
7. The persistent root-owned mode-0700 operator directory exists. No R15
   attempt/start/completion record exists. A pre-existing record blocks
   generation even if the service roots appear absent.
8. Each destination host-pin path is absent. Its parent is the expected
   service-owned mode-0700 root. The exact local source pin matches both the
   file hash and canonical digest above.

## Bounded action

Maximum wall time is 20 minutes. Execute hosts sequentially, V1 through V4,
then V2 coordinator. A failure stops the remaining sequence. No automatic
retry is allowed.

1. Create the root-controlled R15 operator action directory and fsync its
   parent. Create an exclusive mode-0600 per-host `attempt.json` before that
   host's key generation. It binds host/slot/boot ID, release/source/receipt,
   all artifact hashes, host-pin hash/digest and the exact command. Never put
   a secret, environment dump or private hash in it.
2. Install the listed artifacts into the fresh versioned release as
   root:root, mode 0755, single-link regular files beneath real root-owned
   mode-0755 parents. Fsync files and release directory; re-open and re-hash
   immediately before each invocation.
3. Install only that host's pin as
   `/var/lib/plebeian-auctions-friday/frost/owner-approved-host-enrollment-pin.json`,
   service-owned mode 0600, single-link and non-symlink. Fsync it and its
   parent; verify the canonical digest again as the service UID.
4. On each host first run, as the local `plebeian-friday` UID/GID with cleared
   supplementary groups, `umask 077`, no capabilities and no-new-privileges:

   ```text
   /opt/plebeian-auctions-friday/releases/r15-15e108a/plebeian-friday-dkg-enrollment-init \
     self-test-no-replace \
     --root /tmp/plebeian-friday-enrollment-noreplace-r15-SLOT
   ```

   Require schema `PLEBEIAN_FRIDAY_ENROLLMENT_NOREPLACE_SELF_TEST_V1`,
   `supported:true`, exit 0 and the temporary root absent afterward. This
   generates no key.
5. Re-hash the same open/inode-checked initializer and run it exactly once as
   the same restricted service identity:

   ```text
   /opt/plebeian-auctions-friday/releases/r15-15e108a/plebeian-friday-dkg-enrollment-init \
     init --participant SLOT --expected-host-pin-digest CANONICAL_PIN_DIGEST
   ```

   Capture stdout only as the public enrollment record. Do not capture the
   environment, private files, private hashes or stderr contents.
6. Verify the promoted final root, exact entries, ownership/modes/link counts,
   config-to-pin equality, public possession signatures and public enrollment
   byte equality. Record only public record/hash and bounded metadata. Write
   and fsync a root-owned mode-0600 `complete.json` in the operator directory;
   never delete the persistent attempt record.
7. After all four enrollments succeed, create a separate exclusive V2
   coordinator attempt record. Re-hash the deployment executable and run once
   as the restricted V2 service identity:

   ```text
   /opt/plebeian-auctions-friday/releases/r15-15e108a/plebeian-friday-dkg-deployment \
     init-coordinator \
     --deployment friday-demo-20261023-r14 \
     --application-run friday-demo-20261023-r14-run1 \
     --dkg-run friday-demo-20261023-r14-dkg1 \
     --keyset friday-demo-frost-keyset-v1 \
     --keyset-version 1
   ```

   Verify both V2 files against their exact public derivation. Export only the
   coordinator public JSON/hash; write and fsync the root-owned public-only
   completion record.
8. Using only the five exported public JSON records and the same pinned
   deployment binary, compose (without key generation):

   ```text
   plebeian-friday-dkg-deployment compose-manifest \
     COORDINATOR_PUBLIC ENROLLMENT_1 ENROLLMENT_2 ENROLLMENT_3 ENROLLMENT_4
   ```

   Require exact slot order, common deployment/run/keyset identity, verified
   enrollment signatures and the computed roster/manifest digests. Preserve
   the public manifest and digest for independent review. Do not install or
   owner-pin it on a host in this action.
9. Final read-only checks prove no new listener, interface, route, service or
   process; all Wednesday PID/restart observations remain unchanged. The
   versioned artifacts and newly created identity roots remain in place.

## Failure and recovery rules

- **Enrollment:** an error or uncertain outcome preserves the persistent
  attempt record plus every initializer lock, owner, journal, staging and final
  path. Do not delete or rerun `init`. The separate `recover` command may be
  considered only under a new approval when the recorded process is dead and
  a complete staged or final identity authenticates exactly; anonymous,
  incomplete, torn or conflicting state remains locked.
- **Coordinator:** both identity files present and exactly matching the same
  arguments is an idempotent completed state. One file without the other,
  malformed content, a mismatched public derivation, or an attempt record
  without a verified completion is inspection-only. There is no automatic
  repair or regeneration command.
- **Transfer:** only the signed public enrollments, coordinator public JSON,
  composed manifest/digest and sanitized receipts may leave a host. Never read,
  copy, hash into a receipt, log or centrally escrow a private key.
- **Uncertain SSH/tool outcome:** inspect exact paths and process identity;
  never infer failure from a dropped response and never issue the command a
  second time.

## Explicit exclusions and post-action gate

This action does not generate pairwise AEAD keys or FROST shares, run DKG,
configure/start FIPS, start Comet or any signer, initialize an owner approval
key or mint/keyset, install the composed manifest, change nginx/firewalls, or
activate the browser/API. Wednesday and production are excluded.

After successful completion, the next separately reviewed and approved action
is the public/ciphertext-only DKG ceremony. No service activation follows
automatically from this identity stage.
