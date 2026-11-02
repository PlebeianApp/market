# Friday R16 coordinator and public-manifest action

Status: **source independently accepted; exact action pending fresh owner
approval; not authorized or executed**.

This is the next separable final-host mutation after the completed four-host
enrollment. It stages one current standalone tool on V2, creates one V2-local
coordinator RPC identity, and composes one durable public manifest/receipt pair
from the four already exported signed enrollments. It does not run DKG, derive
pairwise keys or FROST shares, start a service/listener, or contact another
validator.

## Exact immutable inputs

- Source commit/tree: `1dab1a041e494b97d92e55816cfb0b4db15c373e` /
  `78abffc835dc8ea35bdb2830b660cf4496e4c91e`.
- Build receipt: `FRIDAY-R16-CURRENT-BUILD-RECEIPT.json`, SHA-256
  `6f881a8a50a8f966278be9cb51d081bc67059c8aa3628b59c2cb93c6407d1e74`.
- Tool: `plebeian-friday-dkg-deployment`, SHA-256
  `b4e8099424a9916e08d608723d7cee4792cc21a9cb118307483b3d31aaefaed9`,
  size `98559723`, mode `0755`, standalone
  `bun-linux-x64-baseline-v1.3.11`.
- Destination host: V2 only, `linode-108236985` / `172.105.95.57`.
- Release destination:
  `/opt/plebeian-auctions-friday/releases/r16-1dab1a0/plebeian-friday-dkg-deployment`.
- Persistent operator action root, required absent before the action:
  `/var/lib/plebeian-auctions-friday-operator/dkg-coordinator-compose-r16`.
- Root-owned input directory, created exclusively as mode `0700`:
  `/var/lib/plebeian-auctions-friday-operator/dkg-coordinator-compose-r16/inputs`.
- Exact root-owned mode-`0600` public inputs:
  `/var/lib/plebeian-auctions-friday-operator/dkg-coordinator-compose-r16/inputs/participant-{1,2,3,4}.host-enrollment.json`.
- Coordinator private root:
  `/var/lib/plebeian-auctions-friday/coordinator`.
- Coordinator private key, never exported, logged or hashed into evidence:
  `/var/lib/plebeian-auctions-friday/coordinator/coordinator-rpc-identity.key`.
- Coordinator public record:
  `/var/lib/plebeian-auctions-friday/coordinator/coordinator-rpc-identity.public.json`.
- Public output/receipt under the action root:
  `initial-dkg-manifest.json` and `initial-dkg-manifest.receipt.json`.

The signed public enrollment inputs and ordered independent pins are:

| slot | public enrollment SHA-256 | canonical host-pin digest |
|---:|---|---|
| 1 | `6f40bb1694239278615941ee1ef0c9b1ea239180576b9cbb242aa52455081979` | `fbfc366911d0bb1f28f4206fe32762268255c952afcc2f61d41af4d5d327a8e9` |
| 2 | `83f351b1b638aa29e931cbd1e40703885a72c46b080e41c02b58286a94efe513` | `d8f1590d3c9a36833816eb134aee55d9368bcca35332b1d4d431d28b69568dda` |
| 3 | `ec93b3cb6a279b1a7b8713d0fa6c2deec2389088beec18b211c612a325253161` | `36c82f63960c58f27f7babfeaabcc91a6915e12c74078bc1e542bf9201f3601e` |
| 4 | `1bd6349411976adbc341dc67dcf03e76599ebf73f9d0182a145d73d0fe640e2e` | `230a5d64a0ab2a81ba08f7175737b2ec53060f31e370b55af0f019af0574bc83` |

All five records bind deployment `friday-demo-20261023-r14`, application run
`friday-demo-20261023-r14-run1`, DKG run
`friday-demo-20261023-r14-dkg1`, keyset
`friday-demo-frost-keyset-v1`, version `1`.

## Fresh preflight and stop conditions

Use the existing pinned SSH agent/known-host configuration with `BatchMode`,
no forwarding and no alternate access. Before mutation, stop if any item
differs:

1. V2 host ID, IPv4, boot ID, SSH host key, service UID/GID and accepted FIPS
   identity match the recorded receipts. The shared UDP firewall is not an
   authority for this non-networked action.
2. Wednesday PID and restart count are unchanged. Every Friday application
   service is stopped; no Friday application listener or process exists.
   Existing stopped FIPS/enrollment material is unchanged.
3. At least 2 GiB memory and 20 GiB disk are free. The standalone ELF loader
   and recorded libraries resolve without installing anything.
4. The release path and action root are absent. Their parents are real,
   non-symlink and root-controlled. Create the release as root:root `0755` and
   the action root exclusively as root:root `0700`, fsyncing each parent.
5. The coordinator parent is a real service-owned `0700` directory. The final
   coordinator root, its initializing directory and identity lock are all
   absent. Any partial or unexpected path blocks generation.
6. Copy only the four committed public enrollment bytes into a new
   root-controlled `inputs` directory under the action root, mode `0600` per
   file. The source paths are exactly
   `/home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/deploy/friday/dkg-enrollment-r15/participant-1.host-enrollment.json`
   through
   `/home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/deploy/friday/dkg-enrollment-r15/participant-4.host-enrollment.json`, and
   the destinations are the four absolute input paths listed above. Reopen and
   verify their hashes, exact schemas, signatures, slot order and field-by-field
   host pins. No private enrollment file is read or copied.

## One bounded action

Maximum wall time is 10 minutes. No automatic retry.

1. Write and fsync a root-owned `0600` attempt record containing only the
   public pins above, tool/build hashes, V2 boot identity and exact arguments.
2. Install, fsync, reopen and re-hash the one deployment tool at the versioned
   release destination.
3. As the V2 `plebeian-friday` UID/GID with cleared supplementary groups,
   `umask 077`, no capabilities and no-new-privileges, invoke exactly once:

   ```text
   /opt/plebeian-auctions-friday/releases/r16-1dab1a0/plebeian-friday-dkg-deployment init-coordinator \
     --deployment friday-demo-20261023-r14 \
     --application-run friday-demo-20261023-r14-run1 \
     --dkg-run friday-demo-20261023-r14-dkg1 \
     --keyset friday-demo-frost-keyset-v1 \
     --keyset-version 1
   ```

   The tool uses create-exclusive owner/staging state and atomic no-replace
   promotion. It emits only the public record. Require exact final entries,
   service ownership, `0700` root, two `0600` single-link files and byte-equal
   public output. Do not read, export or record a hash of the private key.
4. Reopen/re-hash the same deployment tool. As root, invoke only its
   public-data composer with this complete absolute-path command:

   ```text
   /opt/plebeian-auctions-friday/releases/r16-1dab1a0/plebeian-friday-dkg-deployment compose-manifest \
     --output /var/lib/plebeian-auctions-friday-operator/dkg-coordinator-compose-r16/initial-dkg-manifest.json \
     --receipt /var/lib/plebeian-auctions-friday-operator/dkg-coordinator-compose-r16/initial-dkg-manifest.receipt.json \
     --expected-host-pin-digests fbfc366911d0bb1f28f4206fe32762268255c952afcc2f61d41af4d5d327a8e9,d8f1590d3c9a36833816eb134aee55d9368bcca35332b1d4d431d28b69568dda,36c82f63960c58f27f7babfeaabcc91a6915e12c74078bc1e542bf9201f3601e,230a5d64a0ab2a81ba08f7175737b2ec53060f31e370b55af0f019af0574bc83 \
     /var/lib/plebeian-auctions-friday/coordinator/coordinator-rpc-identity.public.json \
     /var/lib/plebeian-auctions-friday-operator/dkg-coordinator-compose-r16/inputs/participant-1.host-enrollment.json \
     /var/lib/plebeian-auctions-friday-operator/dkg-coordinator-compose-r16/inputs/participant-2.host-enrollment.json \
     /var/lib/plebeian-auctions-friday-operator/dkg-coordinator-compose-r16/inputs/participant-3.host-enrollment.json \
     /var/lib/plebeian-auctions-friday-operator/dkg-coordinator-compose-r16/inputs/participant-4.host-enrollment.json
   ```
5. Require the create-exclusive composition lock, one `0700` staging
   directory, fsynced exact files, a durable receipt-before-manifest barrier,
   manifest-last commit, exact final bytes and released lock/staging. Record
   only public output/receipt hashes and manifest digest in a root-owned
   `0600` completion record.
6. Final read-only checks prove no new process, listener, interface, route or
   service, unchanged Wednesday PID/restarts, and unchanged host-local
   enrollment/FIPS identities.

## Failure, recovery and exclusions

Any failed, interrupted or uncertain step preserves its attempt, lock,
staging and final state. Do not delete and do not invoke either command again.
The explicit `recover-coordinator` and `recover-manifest` paths require a new
inspection and approval; they accept only the same binding, a dead exact
owner and complete authenticated staged/final bytes. A response timeout or
file absence alone never proves the first action did not occur.

This action excludes pairwise AEAD derivation/export, DKG rounds, FROST
shares, owner/mint/Comet/browser keys, FIPS or application service starts,
network/firewall/nginx changes, public activation and Wednesday. Only the V2
coordinator private key is created, and it remains V2-local.

The composer source and current artifact, including commit `501375d`'s
fsync-order repair as included in `1dab1a0`, are independently accepted for
this bounded action. The operator Comet/fault adapters are concrete and tested,
but the browser/operator bridge and the real four-host payment workflow remain
`NOT_RUN`; this packet does not claim deployment readiness.
