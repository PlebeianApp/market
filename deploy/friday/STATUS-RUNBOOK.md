# Friday blue/green status and rollback runbook

Status: **PROPOSED COMMANDS ONLY — DO NOT RUN UNTIL THE FINAL ARTIFACT,
IDENTITY, FIREWALL, SERVICE AND PROXY MANIFEST IS APPROVED.**

This runbook never deletes state. It keeps the running Wednesday services at
their existing paths and ports until Friday has passed every gate. A failed
Friday check stops only Friday units and leaves the public proxy on Wednesday.

## Health meanings

These are separate health properties and must not be collapsed into one green
indicator:

- **BFT 3-of-4**: Comet has four distinct consensus identities and a block has
  at least three canonical validator signatures. This advances auction state.
- **FROST 3-of-4**: three distinct enrolled committee signers authorize the
  exact admitted payment package. This authorizes the committee half of a
  Cashu spend. It is not Comet consensus.
- **Coco terminal import**: the recipient's Coco v2 wallet has verified and
  imported the exact fake-token result. A signed or mint-submitted payment is
  not yet an imported payment.
- **FIPS transport**: validator P2P and signer RPC traversed the named FIPS
  interfaces. Merely having `fips0` or a process named `fips` is not proof.

One unavailable validator should leave three Comet signatures. One unavailable
committee signer should leave three FROST participants. They may be the same
machine in the demo, but the thresholds and evidence are independent.

## Inert configuration mapping

| surface | bind/reachability | public identity |
|---|---|---|
| HTTPS | selected Friday application host public TCP 443 | distinct, normally trusted Friday-only origin |
| Friday UI/site | application host `127.0.0.1:8180` | proxied at `/` |
| Friday authority | application host `127.0.0.1:8181` | proxied at `/api/friday/` |
| Friday Cashu mint | application-host FIPS ULA TCP 3438 | proxied at `/v1/`; tokens and receipts name the Friday origin |
| Friday Comet RPC | each host `127.0.0.1:27657` | never public |
| Friday Comet P2P | each host FIPS ULA TCP 27656 | never public |
| Friday signer RPC | each host FIPS ULA TCP 39101 | never public |
| FIPS underlay | each host UDP 32121 | only the four validator IPv4 `/32`s |

No provider or host rule should expose 8180, 8181, 3438, 27656, 27657 or
39101. No TCP 80, new IPv6 ingress, DNS mutation or public admin endpoint is
part of this mapping.

## Pre-switch checks

Run these only from the future reviewed operator procedure; record exact UTC
time and command result without printing environments, keys, bearer proofs or
private state.

1. Verify the four host IDs/IPs, SSH pins and complete artifact/config hashes
   against the approved manifest.
2. Verify exact equality before any service starts:
   `application.json.cashu_mint_url == authority.json.public_origin ==
   https://<nginx %FRIDAY_PUBLIC_ORIGIN_HOST%>`. Verify nginx forwards the
   incoming `$http_origin` unchanged to `/api/friday/`; it must not synthesize
   a trusted origin.
3. Verify only UDP 32121 was added, source-restricted to the four approved
   demo-validator IPv4 `/32`s; preserve the SSH allowlist and default drop.
4. Verify every Friday unit is still disabled/inactive before identities and
   anchors are deliberately installed.
5. Start FIPS, then validators, then signers. Prove four distinct validator
   identities, four distinct signer identities, FIPS-path evidence and four
   signatures at advancing heights.
6. Stop only designated Friday V4 under the separately approved rehearsal.
   Prove later blocks have exactly three validator signatures and prove a new
   FROST authorization names three distinct participants. Restart V4 and wait
   for catch-up before continuing.
7. Start the selected application-host fake mint, coordinator, authority and site. The authority must
   remain quarantined/503 if its anchors, fixed artifacts, mint identity,
   consensus reader or signer enrollment differ.
8. Exercise the exact fake-money journey: Nostr sign-in; Coco v2 funding;
   committed bid; higher committed bid; cooperative outbid return and Coco
   import; anti-sniping extension; close; winner settlement and Coco import.
9. Require zero unresolved payment operations at the chosen observation point
   (active bid reservations are not unresolved payments). Verify actual mint
   input/output states and recipient ownership, not UI balances alone.
10. Validate the candidate nginx file with the exact existing TLS server config.
   Only after `nginx -t` succeeds may the approved include be selected and
   nginx reloaded. Never stop nginx merely to switch upstreams.

## Switch and rollback boundaries

The switch enables only the reviewed Friday virtual host/include on its selected
application host. It does not repoint or replace the Wednesday IP origin and
does not move, overwrite or stop Wednesday state. After the reload, validate the certificate
normally and confirm `/`, `/api/friday/status`, and `/v1/info` on the public
HTTPS origin. Confirm public probes of all internal ports still fail.

If any check fails:

1. disable only new Friday funding on the Friday origin; do not repoint that
   origin to Wednesday or make Wednesday answer for Friday mint receipts;
2. run `nginx -t`; if validation fails, do not reload and preserve the existing
   running worker;
3. reload nginx only after validation succeeds;
4. verify the Wednesday HTTPS site and validator panel remain unchanged;
5. keep the Friday origin, mint, recovery, terminal read and acknowledgement
   paths available until every accepted or ambiguous Friday operation reaches a
   verified terminal state;
6. only after that drain, stop Friday authority, coordinator, site, mint,
   signer, validator and FIPS units in the separately approved order;
7. preserve all Friday state and logs for diagnosis. Do not reset, delete,
   rotate identities or retry an uncertain payment.

Rollback of the public proxy is independent of stopping Friday. If a Friday
payment is `mint_unknown` or `recipient_pending`, leave the isolated Friday
services/state available to the recovery procedure; never point the public UI
back to it until recovery is verified.

### Recovery-only control

`POC_FRIDAY_RECOVERY_ONLY=true` must be applied to both the Friday site and
Friday authority environments under an exact action-time approval. It is not
a browser flag:

- the site rejects new faucet, event, close and offline-control mutations and
  reports both browser wallet/admission readiness flags false;
- the authority rejects new funding and seller-plan intent and permits
  recovery only when the exact operation identity already exists in its
  reviewed durable stores; `/funding/confirm` additionally requires the exact
  journal phase to be `broadcasting`, `broadcast`, or `admitted`, so a merely
  prepared or signed row cannot become a new broadcast in recovery mode;
- the public mint proxy uses the reviewed recovery-only `/v1/` include. It
  denies quote creation, mint execution, melts and unknown routes while
  retaining mint/key reads, existing quote-status reads and the
  value-conserving swap/checkstate/restore calls required by recorded recovery;
- the Friday origin, original mint/keysets, status, FundingAbort,
  terminal read/import/ack and pre-issued seller-plan recovery remain online.

Before calling recovery-only effective, verify that a harmless new mutation is
refused without changing a revision, then verify that one named retained
operation is readable and completes or acknowledges idempotently. Do not use
recovery-only to create a replacement operation or compensate invalid proof
evidence.

Enabling the two application environment flags without selecting the
recovery-only mint include is incomplete and must fail the operator gate. The
normal and recovery-only `/v1/` location sets must not be loaded together.

Before initial activation, all distinct Friday databases, rollback anchors and
browser-origin stores must be empty. A pre-existing record fails the gate and
is preserved; it is never cleared or migrated in place. The controlled mint
must also pass an exact real NUT-12/DLEQ canary. If it later emits missing or
invalid DLEQ, R10 retains the same Coco operation as unavailable rather than
fabricating an instant refund.

## Known release blocker

The ordinary cooperative outbid return is distinct from an emergency
unilateral refund. The latter still has an unresolved MAIN-versus-REFUND
first-mint-spend race after its deadline. It must remain disabled and visibly
disclosed unless the owner selects and approves that exact policy. This gap
does not permit replacing the cooperative return with a fake balance update.
