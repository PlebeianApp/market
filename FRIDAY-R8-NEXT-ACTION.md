# Friday R8 next action

Status: **exact-current local artifacts built; deployment and integrated
acceptance not approved or run.**

Artifact source is `0a6796dba29454b0f2657e932cd3a59a80df0943`.
Deployment templates are `c9d7bb294e7113b60e7b857f2cf6d2b45321c416`.
The complete hashes and test results are in
`FRIDAY-CANDIDATE-R8-BUILD-RECEIPT.json` and
`FRIDAY-R8-LIVE-ARTIFACT-MANIFEST.json`.

## What is locally verified

- TypeScript typecheck passed.
- The restricted Friday suite ran 236 tests: 234 passed and the two OS-child
  cases were blocked by the restricted sandbox with `EPERM`. The exact affected
  file then passed 6/6 (38 assertions) in the normal local runner.
- Go all-package tests passed.
- The Rust FROST participant passed 21/21; the public inspector compiled and
  its zero-test target passed.
- The Go binary embeds VCS revision `0a6796d...` with `vcs.modified=false`.
- The retained browser artifact is byte-identical to the browser bundle
  embedded by the Go site.
- FundingAbort signing now persists the exact policy transcript and signer
  subset, revalidates later safe state without binding to a moving Comet
  height, rejects old database schemas, and anchors its session database in a
  separate SQLite file.

These are regression/build results, not an end-to-end FIPS or browser payment
run.

## Only executable public-origin proposal

Use V2 as the Friday application host:

- public Friday origin: `https://172.105.95.57`;
- `application_host_slot=2`;
- Friday site and authority: V2 loopback TCP 8180/8181;
- Friday mint: V2 FIPS ULA TCP 3438;
- Friday BFT and FROST: all four existing demo hosts over jmcorgan/fips;
- Wednesday V1 `https://172.105.64.142/`: unchanged and never used for Friday
  tokens, receipts, recovery, or rollback.

The hostname option is not executable at this source because strict Go
validation accepts only a public HTTPS IP literal. Do not use split routing,
copied TLS keys, artificial trust, or browser-warning bypass.

## First owner action on return

Confirm the V2 public-origin proposal above and unlock the existing encrypted
SSH key into the previously used owner agent socket. Do not send its passphrase.
Then the already-authorized read-only inventory in
`FRIDAY-R8-READONLY-INVENTORY.md` can fill the missing host, listener, firewall,
certificate and Wednesday-baseline facts. If the key is no longer authorized
by any host, stop; do not copy or replace SSH credentials.

## Consolidated later action-time approvals

After that inventory, one literal mutation request still needs to name and
hash every byte. It must cover:

1. creating a complete V2-only provider firewall, initially unattached, with
   inbound DROP/outbound ACCEPT; SSH TCP 22 only from `71.234.107.170/32`;
   Wednesday TCP 26656 and Friday UDP 32121 only from the four demo `/32`s;
   public IPv4 TCP 443; no IPv6 or internal application ports; then changing
   only V2's Linode Interface firewall selector in one save;
2. accepting the current Let’s Encrypt/ISRG agreement for a new short-lived
   certificate for IP `172.105.95.57`, registering the approved contact,
   creating root-only V2 ACME/TLS keys, and installing the exact reviewed V2
   TLS server and renewal unit. The earlier V1 certificate approval does not
   cover V2;
3. generating fresh, fake-only Friday FIPS, Comet and four-member FROST
   identities; placing each private identity only on its matching V1–V4 demo
   host, and application/mint secrets only on V2; never copying an SSH key or
   using these credentials for real value;
4. staging only the R8 artifact/config hashes, running create-once state and
   independent-anchor initialization, then starting Friday FIPS, validators,
   signers and V2 application services in the reviewed order;
5. running the exact user journey: Nostr sign-in, Coco v2 fake funding, bid,
   higher bid, certified cooperative return and wallet import, anti-sniping
   extension, close/winner payout, validator unavailable, signer unavailable,
   and validator-confirmed pre-admission FundingAbort recovery;
6. preserving all state and inspecting before any retry when an identity,
   firewall, initialization, payment, mint or terminal outcome is uncertain.

No action above is authorized by this document. Exact rendered config hashes,
certificate metadata, provider attachment IDs, current nginx hashes and
literal rollback commands must be added after inventory.

## Rollback boundary

Before any Friday funding, failure means leave the V2 Friday TLS server disabled
and stop only Friday units. After any Friday funding, disable new funding and
bids but retain the V2 Friday origin, mint, status/recovery, terminal-read and
acknowledgement paths until every accepted or ambiguous operation is terminal.
Never repoint the Friday origin to Wednesday. Never delete Friday state or keys
as rollback.

## Disclosed non-goals and gaps

- Emergency unilateral timeout refund is disabled; it is not FundingAbort.
- Own raises are disabled pending full-pool/stable-key continuity.
- A quote lost before a durable operation ID exists is not recovered.
- If a selected three-member FundingAbort FROST session loses one selected
  signer mid-round, it fails closed; the fourth signer is not substituted into
  the existing transcript.
- This is fake money, one operator, coordinator-trusted proof verification and
  no FIPS 140 compliance claim.
