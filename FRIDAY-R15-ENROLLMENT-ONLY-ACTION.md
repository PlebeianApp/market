# Friday R15 per-host enrollment-only action

Status: **exact approval proposal; not authorized or executed**.

This is the smallest independently reviewed next mutation. It stages exactly
three ceremony artifacts and creates exactly three private enrollment keys on
each of the four final validators. It starts no service or listener and does
not create a coordinator key, compose a DKG manifest, run DKG, create a FROST
share, create a Comet/mint/browser key, or activate funding.

## Approval request

May the operator stage the receipt-pinned R15 enrollment initializer plus the
unchanged FROST participant and public inspector on the four demo validators,
then run the single-host enrollment initializer once on each final host?

No private key leaves its host. The only exported artifact is each host's
dual-signed public enrollment JSON and its SHA-256. A failed or uncertain
create-once operation is preserved for inspection and is never automatically
retried or regenerated.

## Exact inputs

- Source commit/tree:
  `15e108acede739312d90291e0dad4b963e6f9117` /
  `6b1b18a1b5e26b7ece4d61c9e04b3464fc40101a`.
- Receipt `FRIDAY-CANDIDATE-R15-BUILD-RECEIPT.json`, SHA-256
  `f95bd9c5ab39c15d9bbeb9b07736284f428c89850cfa540221c1a7b7d98ff49a`.
- Versioned release:
  `/opt/plebeian-auctions-friday/releases/r15-15e108a/`.
- Enrollment parent:
  `/var/lib/plebeian-auctions-friday/frost`.
- Final enrollment root:
  `/var/lib/plebeian-auctions-friday/frost/keyset-v1`.
- Pin destination:
  `/var/lib/plebeian-auctions-friday/frost/owner-approved-host-enrollment-pin.json`.
- Existing persistent operator parent:
  `/var/lib/plebeian-auctions-friday-operator`.
- New create-once action directory:
  `/var/lib/plebeian-auctions-friday-operator/dkg-enrollment-r15`.

Only these executable files are staged, root:root mode 0755, single-link and
non-symlink:

| artifact | SHA-256 |
|---|---|
| `plebeian-friday-dkg-enrollment-init` | `35f0ea080c3dd4bd73d614032da9d719ee3f2a651c0584cf58a1ece62649f6ad` |
| `coco-demo-frost-participant-3of4` | `ed2014392707a00387570a56708e32dc7f7a50e3ab3acb11fb58672d75c7e578` |
| `coco-demo-frost-public-inspect` | `ee880c7f376a8d8b2ba6b1dde6388f64b0de36c0857371f656ebabe055d18b0f` |

The initializer is a Linux x86-64 Bun standalone ELF using
`/lib64/ld-linux-x86-64.so.2` plus `libc`, `libpthread`, `libdl` and `libm`.
The action installs no package or dependency.

The existing owner-pinned records remain the ceremony identity:

- deployment `friday-demo-20261023-r14`;
- application run `friday-demo-20261023-r14-run1`;
- DKG run `friday-demo-20261023-r14-dkg1`;
- keyset `friday-demo-frost-keyset-v1`, version `1`.

| slot | host / IPv4 | expected FIPS npub / ULA | pin SHA-256 | canonical pin digest |
|---:|---|---|---|---|
| 1 | `linode-108175009` / `172.105.64.142` | `npub1tdcsm26d34sd7tlwmqypc2ctd8hjvpqzwaeechr688ah42mypg0sxga6nj` / `fd08:3b4:d506:649e:50ab:bcaf:4263:9cdf` | `53fb79b8043bdae154546d8a84f818d6d266365112ef929e596258e47802a57a` | `fbfc366911d0bb1f28f4206fe32762268255c952afcc2f61d41af4d5d327a8e9` |
| 2 | `linode-108236985` / `172.105.95.57` | `npub10jac6jktr07h90d4txuer4xpu9taxfq458c0yr0enqcg2l798fps0pzlty` / `fd8d:74d8:4685:355:3df4:3595:f5cd:65c6` | `f3974192bd79fba5219361b8bfd3ee101519ad35fef233515c5c8beca885bee7` | `d8f1590d3c9a36833816eb134aee55d9368bcca35332b1d4d431d28b69568dda` |
| 3 | `linode-108237290` / `172.104.240.217` | `npub1698v40hxh2y8denwrygl46m9m78ayf8p8277f4murx2u3gzqrjxqdytc6r` / `fdbc:58a:eabf:3991:adee:607f:fbc7:9b10` | `212a5f1ecd63dee7c479f22cb79b491a4eec786a5c281b08cb838b8f44d87c1b` | `36c82f63960c58f27f7babfeaabcc91a6915e12c74078bc1e542bf9201f3601e` |
| 4 | `linode-108237424` / `172.104.253.247` | `npub14k9gzekwy6gt3vewmazawspxf84fhz94mjmfpqwspyaq5fwa2axsa7s2uc` / `fd27:e968:2c52:42e4:50b9:4a2e:f665:aefe` | `941b27295cc52f7d2d1253c2720f9684fea463b2e6675a2ec726e1ee76f0e0d6` | `230a5d64a0ab2a81ba08f7175737b2ec53060f31e370b55af0f019af0574bc83` |

## Created host-local material

Every private file is owned by that host's non-root `plebeian-friday`
account, mode 0600, single-link and non-symlink below real service-owned
mode-0700 directories. Numeric UID/GID values are resolved independently on
each host.

| file | key/material |
|---|---|
| `keyset-v1/identity-signing-key.hex` | 32-byte secp256k1 Schnorr DKG identity |
| `keyset-v1/kex-private-key.hex` | 32-byte X25519 transport identity |
| `keyset-v1/signer-rpc-identity.key` | 32-byte secp256k1 Schnorr signer identity |
| `keyset-v1/participant.config.json` | exact non-secret participant configuration |
| `keyset-v1/state/` | empty private state directory |
| `keyset-v1/exchange/friday-demo-20261023-r14-dkg1/participant-SLOT.host-enrollment.json` | public identities and possession signatures; only export |

No pairwise AEAD key or FROST share is created in this action.

## Fresh preflight and stop conditions

Use the reviewed SSH identity and pinned host keys with `BatchMode=yes`, no
agent forwarding and no alternative access route. Before any mutation,
inventory all four hosts and stop the whole action if any check differs:

1. Fingerprint, host key, hostname, slot, IPv4 and boot ID match. The local
   `plebeian-friday` account/group exists, is nologin and non-root; record its
   host-specific UID/GID.
2. Read the existing FIPS public identity from its accepted public receipt and
   independently derive/observe the current ULA. Compare the freshly observed
   slot, hostname, IPv4, FIPS npub and ULA field-by-field to that host's pin
   table row above. A digest match alone is insufficient.
3. The Wednesday validator PID is present with unchanged restart count. Every
   Friday application unit is stopped; no Friday enrollment/participant
   process or listener exists. Do not alter the stopped FIPS mesh artifacts or
   persistent FIPS identity.
4. At least 2 GiB memory and 20 GiB disk are free. The expected loader and four
   libraries resolve without installation.
5. The versioned release is absent. Its parent chain is real, root-owned and
   not service-writable.
6. `/var/lib/plebeian-auctions-friday` is the accepted Friday state root. If
   its `frost` child is absent, create `frost` **exclusively** as the local
   service UID/GID mode 0700 and fsync the state-root parent. If it already
   exists, require a real, non-symlink, service-owned mode-0700 directory.
   Reject every ownership, mode, link or path mismatch.
7. `keyset-v1`, `.keyset-v1.initializing`,
   `.keyset-v1.enrollment-init.lock` and the host-pin destination are absent.
   Any presence is inspection-only and blocks initialization.
8. `/var/lib/plebeian-auctions-friday-operator` already exists as a real
   root:root mode-0700 directory. The `dkg-enrollment-r15` child must be absent.
   Create that child once with exclusive semantics as root:root mode 0700 and
   fsync the existing parent. A raced or existing child blocks the action.

## Bounded action

Maximum wall time is 15 minutes. Execute V1 through V4 sequentially and stop
before the next host on any failure or uncertain result.

1. In the new root-controlled action directory, create and fsync a distinct
   mode-0600 `slot-SLOT-attempt.json` before that host's generation. It binds
   host/slot/boot ID, source/receipt, the three artifact hashes, pin file hash
   and canonical pin digest, and the exact command. It contains no environment
   dump, private key, private hash or secret-derived identifier.
2. Install the three exact artifacts into the fresh release as root:root mode
   0755 regular, single-link, non-symlink files. Fsync and reopen/hash them.
3. Install only that host's pin at the fixed pin destination as the service
   UID/GID, mode 0600, single-link and non-symlink. Fsync it and its parent;
   recompute its canonical digest as the service UID.
4. As the local `plebeian-friday` UID/GID with cleared supplementary groups,
   `umask 077`, no capabilities and no-new-privileges, run the harmless
   compiled FFI gate:

   ```text
   /opt/plebeian-auctions-friday/releases/r15-15e108a/plebeian-friday-dkg-enrollment-init \
     self-test-no-replace \
     --root /tmp/plebeian-friday-enrollment-noreplace-r15-SLOT
   ```

   Require exit 0, schema
   `PLEBEIAN_FRIDAY_ENROLLMENT_NOREPLACE_SELF_TEST_V1`, `supported:true`, and
   the temporary root absent afterward. This creates no key.
5. Reopen/re-hash the initializer and execute exactly once under the same
   restricted identity:

   ```text
   /opt/plebeian-auctions-friday/releases/r15-15e108a/plebeian-friday-dkg-enrollment-init \
     init --participant SLOT --expected-host-pin-digest CANONICAL_PIN_DIGEST
   ```

   Capture stdout only as the public enrollment JSON. Do not capture the
   environment, private files, private hashes or stderr contents.
6. Verify exact final entries, ownership/modes/link counts, config-to-pin
   equality, both public possession signatures, and byte equality between
   stdout and the stored public enrollment. Record only public record/hash and
   bounded metadata in root-owned mode-0600 `slot-SLOT-complete.json`; fsync it
   and the action directory. Never delete the attempt record.
7. Final read-only checks prove no new listener, interface, route, service or
   lingering process and unchanged Wednesday PID/restart observations.

## Failure and recovery

On any failure or uncertain outcome, preserve the persistent attempt record
and every initializer lock, owner, journal, staging and final path. Do not
delete and do not rerun `init`. A later `recover` command requires a separate
approval and is valid only when the recorded owner is dead and complete staged
or final output authenticates exactly. Anonymous, incomplete, torn,
conflicting or simultaneously staged/final state remains locked for manual
inspection. A dropped SSH response is never evidence that generation failed.

Only the public enrollment JSON and its hash may leave the host. Never read,
copy, centrally escrow or record hashes of private key files.

## Explicit exclusions and next gate

This action excludes the coordinator/deployment executable, coordinator key,
manifest composition, pairwise transport keys, DKG rounds, FROST shares,
Comet/mint/browser keys, all service starts, interfaces/listeners, firewall or
nginx changes, and activation. Wednesday and production are excluded.

After successful enrollment, coordinator initialization and manifest
composition remain blocked until their repaired create-once/recovery and
external-pin/durable-output implementations receive independent review. No
DKG round may start from enrollment alone.
