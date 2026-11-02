# Friday R6.2 live action scope — prepared, not authorized to execute

Status: **BLOCKED ON AN EXACT-CURRENT FIPS INTEGRATION RUN AND FRESH
ACTION-TIME OWNER APPROVAL.** This document is an inventory and bounded future
request, not a command recipe and not permission to mutate any host.

## Fixed targets

Only these four dedicated fake-money demo Linodes are in scope:

| slot | Linode | IPv4 |
|---|---:|---|
| V1 | 108175009 | 172.105.64.142 |
| V2 | 108236985 | 172.105.95.57 |
| V3 | 108237290 | 172.104.240.217 |
| V4 | 108237424 | 172.104.253.247 |

Production `192.46.234.233` is explicitly out of scope. The running Wednesday
demo, its ports, paths, identities, databases, TLS key and services must not be
overwritten, stopped or migrated.

## Candidate inputs

- Source branch: `poc/friday-tier1-2026-10-23`.
- R6 artifact receipt: `FRIDAY-CANDIDATE-R6-BUILD-RECEIPT.json`, SHA-256
  `188bc6ede34f057604a751d7ccdfa76f2faf1f1a2a98aa7c626a0e373803dd89`.
- R6.1 Go activation delta: `FRIDAY-CANDIDATE-R6.1-BUILD-RECEIPT.json`,
  SHA-256 `6b5c1cf65503561fa0177d8712265f4fee4d87cd0f87a8756d9e349c9a543783`.
- Application binary after the default-off activation gate:
  `live-bin-friday-candidate-r5/plebeian-auctions-poc`, SHA-256
  `2b57523f6fca7398a95f64d61df6df77762d8f54c8a57588e5bb449f825c3940`.
- Pinned jmcorgan/fips 0.5.2 (`rev 53a3ec4b2f`) binaries copied without
  modification from the reviewed local installation:
  - `fips`: `7b26e81e2607483d46b716a330c88ee18c881e3adaefc0542909e6f2a9a287f2`
  - `fipsctl`: `15df75d3d9942747c62f690b0f4f5d5a2f9df45c976a96f4799a9574b988fab3`

Every other artifact hash is listed in the R6 receipt. No artifact contains a
deployment key or bearer proof.

## Exact future mutations requiring approval

1. Reverify all four SSH host keys, identities, listeners, free memory, current
   services and firewall attachments read-only. Use only the owner's already
   installed SSH key via an owner-unlocked temporary agent; never copy it.
2. In both provider firewalls that protect these demo hosts, add UDP 32121
   ACCEPT only from the four IPv4 `/32`s above. Preserve default inbound DROP,
   outbound ACCEPT, the existing owner SSH allowlist, V1-only public TCP 443,
   and the Wednesday TCP 26656 rule. Do not expose TCP 27656, 27657, 3438,
   39101, 8180 or 8181 publicly. Add no TCP 80, IPv6 ingress, DNS change or
   public admin route.
3. Install only hash-matching R6/R6.1/FIPS artifacts under
   `/opt/plebeian-auctions-friday/bin`; install reviewed configs under
   `/etc/plebeian-auctions-friday`; create isolated state under
   `/var/lib/plebeian-auctions-friday` and rollback anchors under
   `/var/lib/plebeian-auctions-friday-anchor`. Do not reuse Wednesday state.
4. Generate new **fake-only persistent** FIPS identities, four distinct Comet
   node/validator identities, and one four-member FROST DKG/keyset. Each host
   receives only its own private FIPS/Comet/FROST material; V1 receives the
   coordinator/mint identity needed by the fake-money app. Private files are
   service-owned mode 0600 in mode-0700 directories. They must never be used
   for real funds or copied to chat.
5. Run the create-once Friday state initializer before services. It must refuse
   every pre-existing target, bind the exact deployment/generation/artifact
   identities, create independent anchors, fsync, close, and reopen with
   `create:false`. Any partial result is quarantined and inspected; never
   deleted and retried automatically.
6. Install and enable only the Friday blue/green units. Start FIPS, validators,
   signers, V1 fake mint, coordinator, authority, and site in that order. Keep
   `POC_FRIDAY_BROWSER_READY=false` while proving internal health.
7. Prove four distinct validators and four distinct signers, actual FIPS
   traversal, BFT commits, FROST authorization, fixed public mint identity and
   zero-fee Nutshell FakeWallet behavior. Under a separate fault step, stop only
   Friday V4, prove later three-signature BFT commits and a three-participant
   FROST result, then restart/catch up V4.
8. Before public activation, install a separately reviewed V1 nginx candidate
   route that selects Friday only for the exact owner validation IPv4
   `71.234.107.170/32`; every other request must continue to reach Wednesday.
   The candidate path must preserve the canonical same-origin HTTPS identity
   `https://172.105.64.142` for `/`, `/api/friday/` and `/v1/`, preserve the
   browser `Origin`, and expose no internal listener directly. Only inside this
   allowlisted validation boundary may V1 set
   `POC_FRIDAY_BROWSER_READY=true` and restart the Friday site. If this
   same-origin route cannot be installed and verified without changing the
   public Wednesday path, stop: direct HTTP to port 8180 is not valid browser
   acceptance evidence.
9. Through the allowlisted candidate route, exercise the complete fake-money
   user journey: Nostr sign-in; Coco v2 funding; committed bid; a higher
   committed bid; certified cooperative outbid return and Coco import;
   anti-sniping extension; close; winner settlement and Coco import. In
   separate cases, verify reserve-unmet/no-sale full return, a lost mint
   response recovered under the same durable operation without a second spend,
   and recipient import. Verify mint proof states and recipient ownership, not
   displayed balances. Require no unresolved payment at each terminal
   observation point.
10. Only after step 9 passes may V1 validate the reviewed public Friday nginx
    include with `nginx -t` and reload nginx to switch the existing HTTPS origin
    from Wednesday to Friday for all clients. Public probes of all internal
    ports must still fail.

## Fixed connectivity and services

- FIPS underlay: public IPv4 UDP 32121 among only V1–V4.
- FIPS private ULA: Comet P2P TCP 27656 among V1–V4; signer TCP 39101 from the
  pinned coordinator/participant peers; mint TCP 3438 on V1.
- Loopback only: Comet RPC 27657 on each host, V1 site 8180, V1 authority 8181.
- Public identity: existing `https://172.105.64.142`; nginx maps `/v1/` to the
  V1 FIPS mint transport, `/api/friday/` to loopback authority, and `/` to the
  Friday site. No browser warning bypass or alternate logical mint identity.

The four validator identities implement BFT 3-of-4. The four separate FROST
participants implement committee signing 3-of-4. Neither is a substitute for
the other. This uses jmcorgan/fips transport and does not claim governmental
FIPS validation.

## Rollback and uncertainty

The public switch is one reviewed nginx include/reload and is independent of
Friday service shutdown. On failure, immediately restore the exact Wednesday
include, validate with `nginx -t`, reload, and verify the Wednesday site. If no
Friday payment is unresolved, stop only Friday units in
authority/coordinator/site/mint/signer/validator/FIPS order. If any payment is
`mint_unknown` or `recipient_pending`, first quarantine new Friday admissions,
then keep only its isolated recovery dependencies (mint, FIPS, signers,
authority and coordinator) plus state available for exact recovery and
inspection. Do not retry the spend. Stop those retained services only after the
operation reaches an authenticated terminal state or a separately approved
incident action. Preserve Friday state and bounded logs in either case.

An interrupted key generation, initializer, firewall update, service start or
payment has an uncertain outcome until inspected. No automatic retry, cleanup,
identity rotation or destructive reset is authorized by this document.

## Known non-deployment blockers

- The exact-current successful live payment run used loopback/stdin, not FIPS.
  Historical R5 is not evidence for R6/R6.1. A reviewed exact-current FIPS
  controller/result is still required before this scope can be presented for
  execution.
- Own raises remain disabled pending stable full-pool/key continuity.
- Emergency unilateral refund remains disabled pending an owner decision on
  the unavoidable first-valid-mint-spend race with an already signed MAIN
  branch. Cooperative certified outbid return is implemented and tested.
- Experimental pre-`7c110c7` admitted replay rows require authenticated
  migration or a separately approved clean-state reset; they fail closed.

## Missing action-time packet (must exist before owner execution)

This planning scope is deliberately not an executable recipe. A later reviewed
action-time packet must supply all of the following as exact bytes and hashes:

- final per-host artifact and configuration manifests, including every systemd
  unit and environment file;
- exact persistent key filenames, host placement, owners and modes, plus the
  literal DKG and create-once initializer commands;
- literal service start/health/fault/recovery commands and expected outputs;
- the exact-current FIPS controller, its reviewed result and sanitized evidence
  schema;
- the nginx candidate/public include paths, contents and hashes, the captured
  prior Wednesday include hash, and literal rollback commands;
- a fresh read-only host, listener, service and provider-firewall inventory.

The owner must not execute live mutations from this document alone.
