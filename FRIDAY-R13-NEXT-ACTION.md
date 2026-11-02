# Friday R13 next action

Status: **exact-current artifacts are built and offline-tested; no R13
artifact is installed and no runtime identity or service has been created.**

The artifact receipt is `FRIDAY-CANDIDATE-R13-BUILD-RECEIPT.json` at local
commit `3f90d83`. Its SHA-256 is
`82951f4e854f2dc5a44f6c625facdc7b90d43334c979b2e3db6709a7a6dab7d6`.
The executable code is source commit
`9cacf094ea508316fe5f34b8847314413bfa9370`, while the clean Go build embeds
the evidence-only descendant `3ca1b48e8db5a960d2def7e71ec15464042ab794`
with `vcs.modified=false`.

R13 removes the rejected central DKG program from the release. Each validator
has a final-host-only enrollment tool; the coordinator sees only public records
or recipient-specific ciphertext. The current TypeScript V2 producer hash is
`26f525e86cefaa14efa7beb61f97a514cbde929986927f316b74287dac0b7b9b`.
The current V1 helper hash is `cafaa994e35c512613d9a258cc9d92f77a0165ac3d8a01db23a39dff6eb5b14c`;
the older `725d4d...` value is not current.

## Fresh read-only inventory

The owner SSH identity and all four pinned host keys were verified before one
read-only inventory per host at 2026-10-23 14:23 UTC.

| host | Friday state | Wednesday state | available memory |
|---|---|---|---:|
| V1 `172.105.64.142` | no account/root/binary/unit/identity/`fips0`/UDP 32121 listener | validator slot 1 active, zero restarts | 3284 MiB |
| V2 `172.105.95.57` | inert account and roots; exact reviewed `fips`/`fipsctl`; no config/identity/unit/`fips0`/UDP listener | validator slot 2 active, zero restarts | 3384 MiB |
| V3 `172.104.240.217` | no account/root/binary/unit/identity/`fips0`/UDP 32121 listener | validator slot 3 active, zero restarts | 3401 MiB |
| V4 `172.104.253.247` | no account/root/binary/unit/identity/`fips0`/UDP 32121 listener | validator slot 4 active, zero restarts | 3397 MiB |

Every host has more than 41 GB free on `/` and `/var/lib`. V2's installed
FIPS hashes exactly match R13. Provider rules are owner-confirmed as UDP 32121
from exactly the four validator IPv4 `/32`s on V1, V2 and the shared V3/V4
firewalls, with inbound drop, outbound accept and no IPv6 inbound rule. This is
configuration evidence, not proof of live FIPS connectivity.

The first V1 command used an incorrect remote `bash -c` argument shape and
printed the ordinary root login shell variables before the intended read-only
facts. It did not print a private key, application environment, bearer proof,
database record or configuration payload. The command made no change; the
corrected shape was used for V2-V4. This deviation is retained rather than
silently omitted.

## Proposed next approval: inert R13 staging plus FIPS identities only

This is the smallest action that can produce the public FIPS identities needed
to render the four owner-approved DKG host pins. It is a proposal for a new
explicit approval, not current authority to execute.

Target only V1-V4 above. Production, Wednesday paths, Wednesday units and all
current listeners are excluded.

1. Recheck the pinned SSH identity/host key, boot ID, free space, Friday path
   state, Wednesday validator PID/restart count, UDP listener absence and
   `fips0` absence on each host. Stop the entire stage on a mismatch.
2. On V1/V3/V4, create the local `plebeian-friday` system group and nologin
   account, without assuming numeric UID/GID parity. Create new Friday-only
   parents. On V2, require the existing account and directories to match the
   recorded ownership/modes; do not rewrite them.
3. Stage the exact R13 role binaries below a new root-owned immutable release
   directory `/opt/plebeian-auctions-friday/releases/r13-3ca1b48/`. Verify the
   receipt hashes after transfer. Do not change `/opt/.../bin`, install a unit,
   daemon-reload, create a database, render live config or start a process.
4. For FIPS identity generation only, require
   `/var/lib/plebeian-auctions-friday/fips` to be a local
   `plebeian-friday:plebeian-friday` mode-0700 non-symlink directory. Reserve a
   root-owned create-exclusive operation lock. Require the final `identity`
   path and the run-specific staging path both absent.
5. As the local service identity with `umask 077`, run the exact R13
   `fipsctl keygen -d RUN_SPECIFIC_STAGING` once. Never use `--stdout` or
   `--force`. Do not log or hash the private key.
6. Require `fips.key` and `fips.pub` to be bounded regular non-symlink files
   owned by the local service identity; `fips.key` must be 0600. Record the
   actual public-file mode produced under `umask 077` and reject any group or
   world writable/executable mode rather than imposing a false 0644
   assumption.
7. Derive the mesh address independently from `fips.key` and `fips.pub` using
   the exact R13 `fipsctl address -k`; require exact equality and a canonical
   ULA. Record only slot, host, public `npub`, ULA and binary hashes. Fsync both
   files and the staging directory.
8. Promote the staging directory to the final
   `/var/lib/plebeian-auctions-friday/fips/identity` by an independently
   reviewed same-filesystem `renameat2(RENAME_NOREPLACE)` step, then fsync the
   parent. A plain replace-capable `mv`, copy, implicit first-start generation
   or destination deletion is not allowed.
9. On normal success, retain the final identities and delete only the empty
   operation lock. On any generation, validation, fsync or promotion failure,
   preserve the positively identified private staging directory, stop, and
   request separate inspection/cleanup approval. Do not retry or regenerate.

This stage creates four fresh fake-demo FIPS private identities on their final
hosts. It creates no FROST, DKG, signer, Comet, coordinator, mint or Nostr key;
no config, listener, route, service or database; and no private material leaves
its originating host.

The R13 binaries staged per role are:

- V1/V3/V4: `fips`, `fipsctl`, `plebeian-auctions-poc`,
  `plebeian-friday-signer`, `plebeian-friday-dkg-enrollment-init`,
  `plebeian-friday-dkg-host`, `coco-demo-frost-participant-3of4`, and
  `coco-demo-frost-public-inspect`.
- V2: the same set plus `plebeian-friday-authority`,
  `plebeian-friday-coordinator`, `plebeian-friday-terminal-executor`,
  `plebeian-friday-dkg-plan`, `plebeian-friday-dkg-relay`, and
  `friday-browser.js`.

## Following approval, not included in the FIPS stage

Once the four FIPS public records are known, render and independently review
four exact host-pin JSON files for:

- deployment `friday-demo-20261023-r13`;
- application run `friday-demo-20261023-r13-run1`;
- DKG run `friday-demo-20261023-r13-dkg1`;
- committee keyset `friday-demo-frost-keyset-v1`, version `1`;
- the exact host IPv4, generated FIPS `npub` and derived ULA;
- signer endpoint `http://[ULA]:39101/v1/frost`;
- participant binary `ed2014392707a00387570a56708e32dc7f7a50e3ab3acb11fb58672d75c7e578`;
- inspector binary `ee880c7f376a8d8b2ba6b1dde6388f64b0de36c0857371f656ebabe055d18b0f`;
- fixed local config/state paths under
  `/var/lib/plebeian-auctions-friday/frost/keyset-v1`.

Only after those four pins and their digests are approved may each host run
`plebeian-friday-dkg-enrollment-init init --participant SLOT
--expected-host-pin-digest HEX` once. Each host creates only its own DKG,
X25519 and signer identity material. Pairwise transport keys may exist only at
their two endpoints; V2 may hold the three pairs involving participant 2 but
never V1-V3, V1-V4 or V3-V4. The coordinator may relay public records and
recipient ciphertext only. No service start, live DKG exchange, Comet key,
database, or public admission is implied by enrollment approval.

## Remaining gates after enrollment

- final independent review of this exact R13 receipt and action packet;
- per-host DKG ceremony and public V2 result, then Go/TypeScript revalidation;
- separate per-host Comet identities and public-only genesis assembly;
- fresh create-once V2 coordinator/mint/anchor state under exact approval;
- inert unit/config installation and hash verification;
- live FIPS mesh, four-validator BFT, four signer services and controlled mint;
- trusted-HTTPS browser/Coco v2 funding, bid, certified outbid import, extension,
  close and winner settlement with one validator unavailable;
- evidence review, then a separate public activation approval.

Own raises and emergency unilateral timeout refunds remain disabled. A signer
lost after a FundingAbort subset has been claimed remains fail-stop until that
same signer returns. This is fake money only and is not a FIPS 140 claim.
