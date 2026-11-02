# Friday R14 per-host enrollment action

Status: **approval-ready proposal; not authorized or executed.** This is the
smallest next mutation after the independently observed FIPS mesh. It stages
only exact R14 ceremony executables and creates three local identity secrets
on each final validator. It starts no service or listener.

## Frozen inputs

- Source commit/tree: `92ac5f9da93ee8790385e5a5a7541cc62be1ec2e` /
  `2a0684937f939efcbd31725203d8b6360e99e1a9`.
- Artifact receipt: `FRIDAY-CANDIDATE-R14-BUILD-RECEIPT.json`.
- Versioned destination:
  `/opt/plebeian-auctions-friday/releases/r14-92ac5f9/`.
- Host-private ceremony root:
  `/var/lib/plebeian-auctions-friday/frost/keyset-v1`.
- Owner-approved host pin path:
  `/var/lib/plebeian-auctions-friday/frost/owner-approved-host-enrollment-pin.json`.
- Participant SHA-256:
  `ed2014392707a00387570a56708e32dc7f7a50e3ab3acb11fb58672d75c7e578`.
- Inspector SHA-256:
  `ee880c7f376a8d8b2ba6b1dde6388f64b0de36c0857371f656ebabe055d18b0f`.
- Enrollment executable SHA-256:
  `9285f15d527b0f8f438db6d273ce9b1db6a08f223d20e9304fa2fb509436419e`.
- DKG host executable SHA-256:
  `b79503399651c355423967e5e0dbb27d452f4d804559498bf9775c536382b410`.

Host pin file SHA-256 / canonical pin digest:

| slot | host | file SHA-256 | canonical pin digest |
|---:|---|---|---|
| 1 | `linode-108175009` / `172.105.64.142` | `53fb79b8043bdae154546d8a84f818d6d266365112ef929e596258e47802a57a` | `fbfc366911d0bb1f28f4206fe32762268255c952afcc2f61d41af4d5d327a8e9` |
| 2 | `linode-108236985` / `172.105.95.57` | `f3974192bd79fba5219361b8bfd3ee101519ad35fef233515c5c8beca885bee7` | `d8f1590d3c9a36833816eb134aee55d9368bcca35332b1d4d431d28b69568dda` |
| 3 | `linode-108237290` / `172.104.240.217` | `212a5f1ecd63dee7c479f22cb79b491a4eec786a5c281b08cb838b8f44d87c1b` | `36c82f63960c58f27f7babfeaabcc91a6915e12c74078bc1e542bf9201f3601e` |
| 4 | `linode-108237424` / `172.104.253.247` | `941b27295cc52f7d2d1253c2720f9684fea463b2e6675a2ec726e1ee76f0e0d6` | `230a5d64a0ab2a81ba08f7175737b2ec53060f31e370b55af0f019af0574bc83` |

## Exact action boundary

1. Revalidate the existing owner SSH fingerprint, pinned host keys, host IDs,
   boot IDs, free disk/memory, Wednesday PID and zero-restart state. Require
   every Friday unit stopped, no `fips0`, no UDP 32121 listener, and the
   existing FIPS identity/public receipt unchanged. Stop all hosts on any
   mismatch.
2. Require the versioned R14 release, fixed host-pin path, `keyset-v1`,
   `.keyset-v1.initializing`, and `.keyset-v1.enrollment-init.lock` absent.
   Existing or ambiguous state is inspection-only and forbids initialization.
3. On each host, install only the four public R14 artifacts named above into a
   fresh root-owned, non-writable versioned release. Verify size, mode and
   SHA-256. Do not alter `/opt/plebeian-auctions-friday/bin`, a unit, config,
   route or listener.
4. Create or verify `/var/lib/plebeian-auctions-friday/frost` as a real,
   service-owned mode-0700 directory. Install only that host's reviewed pin as
   a service-owned, single-link, non-symlink mode-0600 file. Fsync it and its
   parent, then recompute the canonical digest with the exact R14 code.
5. Sequentially, once per final host, run as `plebeian-friday`:

   ```text
   /opt/plebeian-auctions-friday/releases/r14-92ac5f9/plebeian-friday-dkg-enrollment-init \
     init --participant SLOT --expected-host-pin-digest EXACT_DIGEST
   ```

   The command creates only that host's DKG signing identity, X25519 transport
   identity, signer-RPC identity, fixed participant config, empty state root,
   and dual-signed public enrollment. It has no all-host mode.
6. Require private files single-link, service-owned and mode 0600; all
   directories mode 0700; the stored config identical to the host pin; and the
   public enrollment to validate under both newly created public identities.
   Export only the public enrollment JSON and its SHA-256.
7. On any failure or uncertain outcome, do not delete, regenerate or retry.
   Preserve the exact lock/journal/staging/final roots and inspect under a new
   approval. The implemented `recover` command is permitted only later when a
   recorded owner is dead and complete staged/final output authenticates.

No key leaves its final validator. This action does not create pairwise AEAD
keys, FROST shares, a coordinator key, Comet keys, a mint key or browser keys.
It does not start FIPS, DKG, signer, validator, mint, authority, coordinator,
site or nginx processes. Wednesday and production are excluded.

## Concrete activation blockers after this action

Service activation is not yet safe or executable. The repository has the
per-host host-stage and public/ciphertext relay commands, but still lacks:

1. a create-once V2-only coordinator RPC identity initializer that emits only
   its public Schnorr identity;
2. a strict initial manifest composer that combines that public identity with
   the four authenticated host enrollments and emits the independently pinned
   manifest digest;
3. the owner-signed Comet deployment-anchor renderer and strict
   FundingAbort-bootstrap renderer bound to the controlled NUT-12 mint;
4. a reviewed operator packet for public/ciphertext DKG couriering, public
   Comet assembly, create-once V2 state, and exact units/configs;
5. a live acceptance driver covering browser Coco funding, admission, outbid
   refund import, anti-sniping, winner settlement and one validator absent.

The corrected full FIPS service unit is prepared locally, but it is not a
substitute for those missing trust-root tools and has not been staged.
