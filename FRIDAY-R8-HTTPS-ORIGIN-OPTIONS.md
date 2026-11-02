# Friday R8 trusted HTTPS origin decision

Status: **NO OPTION SELECTED OR EXECUTED.** This is an owner decision and
action-time scope, not deployment approval.

## Non-negotiable identity boundary

`https://172.105.64.142` permanently names the running Wednesday site and its
independent fake mint. Friday consensus receipts, Coco wallets and mint proofs
must not reuse that origin for a different issuer. Source-IP routing, a hidden
upstream selector, an owner-only route, a TLS-warning bypass, a copied TLS key,
or repointing the origin during rollback would make one Cashu identity name two
issuers and is rejected.

Friday therefore needs one distinct normally trusted HTTPS origin on default
TCP 443. Its exact origin is pinned in the Friday application manifest,
authority config, browser deployment facts, consensus genesis and every
payment receipt. The internal transport is separately pinned to exactly the
selected application's FIPS ULA at TCP 3438.

## Option A — distinct hostname on V1 (future source revision only)

Proposed origin: `https://auction-friday.plebeian.market` only if the DNS
controller creates that exact A record to `172.105.64.142` and the owner
separately approves issuance and activation of its certificate.

**This option is not executable at the current R8 source.** The current Go
application deliberately accepts the canonical public HTTPS mint identity only
when its host is a public IP literal; the regression suite rejects a hostname.
Option A therefore requires a separate reviewed source change and fresh tests
before it can enter an action packet. It must not be selected merely because a
DNS record later becomes available.

- `application_host_slot=1`; Friday site/authority stay loopback-only and the
  Friday mint stays on V1's FIPS ULA.
- Nginx gets a separate exact `server_name`/certificate/locations for Friday.
  The existing IP-default Wednesday server remains unchanged.
- No provider TCP 443 change is needed on V1, but DNS ownership and certificate
  control are external prerequisites. This task has neither DNS access nor
  authorization to contact Chiefmonkey.
- Do not use this option unless the record and normally trusted certificate are
  independently verified from a normal browser/client.

## Option B — V2 IP origin, no DNS

Proposed origin: `https://172.105.95.57`, using a new Let's Encrypt short-lived
IP certificate on V2.

- `application_host_slot=2`; Friday mint, authority, coordinator and site run
  in Friday-only paths/ports on V2. All four validators and signers retain their
  original slots and communicate through FIPS.
- V2 needs a dedicated provider firewall with inbound DROP/outbound ACCEPT,
  existing SSH TCP 22 from `71.234.107.170/32`, Friday/Wednesday P2P rules as
  reviewed, FIPS UDP 32121 from only the four demo `/32`s, and public IPv4 TCP
  443. No IPv6, TCP 80, RPC, signer, mint or application ingress.
- V2 must move through its Linode Interface firewall selector in one save after
  the complete replacement firewall is reviewed; never detach first. V1, V3
  and V4 retain their own reviewed protection.
- A fresh V2-only ACME account/certificate action, private-key storage,
  renewal timer and nginx configuration require explicit action-time approval.
  The earlier V1 certificate approval does not silently cover V2.
- This uses an existing demo host, not a new paid server. It changes the app
  role placement and must receive an exact-current FIPS/browser acceptance run.

Option B is the only origin compatible with the current R8 source and is the
domain-independent path. Option A is retained only as a future design option;
it depends on another person's DNS action *and* a reviewed application change.
Option B is not deployable until the owner selects it and the exact current
inventory confirms no conflicting listener or firewall rule.

## Required read-only inventory before either option

The inventory must stop on each command failure and must not print private keys,
environment values, bearer proofs or database content. On the selected app host
it must record:

- complete listener metadata and the Linode Interface/firewall attachment;
- redacted nginx effective `listen`, `server_name`, `location`, proxy target,
  real-IP and cache directives, preserving location precedence;
- public certificate subject/SAN, issuer, serial, SHA-256 fingerprint,
  not-before/not-after and chain verification, never its private key;
- host IPv4/IPv6 addresses, routes and nftables/UFW policy;
- Friday paths/units absent or inactive before staging; and
- Wednesday unit health and public origin unchanged.

Provider firewall state cannot be inferred from host nftables and needs a
Cloud Manager read-only view or already-authorized provider API result.

## Rollback after funding exists

Rollback is not origin reassignment. Disable new Friday funding/bids first, but
keep the Friday origin, mint, authenticated status/recovery, terminal read and
recipient acknowledgement paths online until every accepted or ambiguous
operation is resolved. Preserve all Friday state and keys. Only then may Friday
application and transport units stop in the reviewed order. Wednesday remains
available throughout and never serves Friday receipts.

## Owner choice needed

For the current R8 source, the only executable choice is:

1. authorize the V2 application placement, complete V2-only firewall
   replacement, and V2 IP-certificate setup.

Alternatively, defer deployment and authorize a future source revision adding
strict hostname-origin support; that is not an executable R8 choice.

Selection alone is not permission to execute. The final request must include
fresh inventory, exact artifact/config hashes, firewall delta, certificate
scope, service order, acceptance sequence and rollback commands.
