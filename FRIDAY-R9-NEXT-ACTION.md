# Friday R9 next action

Status: **exact-current artifacts are built and regression-tested; privileged
FIPS/HTTPS acceptance and deployment are not approved or run.**

Artifact source is `02cdd9270c0778c4ba7acec3f4262193252a3f22`, tree
`d58d145ba2d05ec7bc5015903234165e014c5479`. The browser bundle committed in
that source is byte-identical to the R9 browser artifact. Complete hashes and
test results are in `FRIDAY-CANDIDATE-R9-BUILD-RECEIPT.json` and
`FRIDAY-R9-LIVE-ARTIFACT-MANIFEST.json`.

## Verified locally

- TypeScript typecheck passed.
- Focused cancellation/browser tests passed 17/17 (148 assertions); the
  FundingAbort coordinator tests passed 8/8 (26 assertions).
- The restricted Friday suite passed 249/251 (984 assertions). Its only two
  failures were OS-child IPC cases refused by the restricted sandbox with
  `EPERM`; their exact file passed 6/6 (38 assertions) in the normal runner.
- Go all-package tests passed. The Go artifact embeds VCS revision
  `02cdd927...`, `vcs.modified=false`, and `GOAMD64=v1`.
- The Rust participant passed 21/21. The public inspector test/build passed
  with a zero-test target.
- Independent static review found no P0/P1 in the final logic commit
  `fe05e414...`; `02cdd927...` adds only the rebuilt byte-equivalent browser
  bundle.

These are compile, regression, and static-review results. They are not an
exact-current four-host FIPS run, a trusted-HTTPS browser/Coco payment run, or
a deployment result.

## Required public-origin decision

Friday must use a distinct normally trusted HTTPS origin. Do not reuse
Wednesday V1 `https://172.105.64.142/`: the two deployments have independent
mint issuers, token/keyset identity, recovery state, and rollback lifecycles.

The currently source-compatible proposal is V2 IP origin
`https://172.105.95.57`. A hostname is not executable without a further source
change because the strict Go configuration presently accepts a public HTTPS IP
literal. Do not use copied TLS keys, artificial browser trust, warning bypass,
split public/internal mint identities, or fallback to Wednesday.

## First owner action after return: restore read-only access

The historical socket path exists, but this restricted worker cannot connect
to it, so a usable agent is not verified. In the owner's terminal, first try
unlocking that exact existing agent without sharing a passphrase:

```bash
test -S /tmp/plebeian-poc-owner-agent.sock
SSH_AUTH_SOCK=/tmp/plebeian-poc-owner-agent.sock ssh-add -t 14400 /home/maximoto/.ssh/id_ed25519
SSH_AUTH_SOCK=/tmp/plebeian-poc-owner-agent.sock ssh-add -l -E sha256
```

Expected owner-key fingerprint from the prior verified session:
`SHA256:IGu9dXOSXw4JoPmwNjAgDRI2AY+zJil/haJGjKRYt34`. If it does not match
exactly, stop. Do not scan or replace host keys, copy the private key, forward
the agent, change `known_hosts`, guess another account, unlink an unresponsive
socket, or bypass a denial. If the owner terminal cannot connect to the socket,
stop and establish a separately reviewed agent handoff rather than guessing
that the existing socket is stale.

After the agent check, the already-authorized inventory must pin all four host
keys with `/home/maximoto/.ssh/known_hosts`, use `BatchMode=yes`,
`IdentitiesOnly=yes`, the explicit socket and key, strict host-key checking,
one ten-second attempt, and read only metadata/configuration. No secret values,
database rows, proofs, seeds, private keys, environment values or TLS private
keys may be printed.

The inventory must establish, rather than assume:

- exact current host identities, time, resources, listeners and routes;
- actual Wednesday and Friday unit names, fragments, states and dependencies;
- exact existing Friday destination/path presence versus absence versus access
  error;
- nginx listener, server-name, include, location and default-server precedence;
- certificate SAN/fingerprint/issuer/validity and public-chain paths, never the
  private key;
- host IPv6 posture and full provider-firewall attachment/rules;
- Wednesday health and its unchanged route/certificate baseline.

If local authentication, any pinned host key, any host identity, or provider
firewall state is unavailable, inventory is blocked. Do not infer absence from
an SSH error or inaccessible path.

## Proposed live mapping, pending inventory and action-time approval

- V1 `172.105.64.142`: Friday FIPS, validator and signer only; preserve every
  Wednesday service and the Wednesday HTTPS origin.
- V2 `172.105.95.57`: Friday FIPS, validator, signer, mint, coordinator,
  authority, site and distinct HTTPS proxy.
- V3 `172.104.240.217`: Friday FIPS, validator and signer only.
- V4 `172.104.253.247`: Friday FIPS, validator and signer; designated bounded
  validator-unavailable test target only under a separate exact confirmation.
- Excluded: `192.46.234.233`, every production host, and all Wednesday paths,
  credentials, identities, state and services.

Proposed ports are FIPS UDP 32121; Comet P2P TCP 27656 over FIPS only;
loopback Comet RPC 27657; FIPS signer TCP 39101; FIPS mint TCP 3438;
loopback site 8180; loopback authority 8181; and V2 public IPv4 HTTPS 443.

The future V2 firewall proposal, after inventory, must preserve SSH TCP 22 only
from `71.234.107.170/32`, preserve Wednesday TCP 26656 only among the four
validator `/32`s, add Friday UDP 32121 only among the same four `/32`s, and add
public IPv4 TCP 443 only on V2. Inbound policy remains DROP and outbound policy
ACCEPT. No IPv6 ingress and no public 80, 27656, 27657, 3438, 39101, 8180 or
8181. No provider mutation is authorized here.

## Remaining exact action-time approvals

After inventory and after a fresh action packet pins every rendered byte:

1. one bounded local privileged R9 acceptance run using the exact R9 artifacts,
   a normally trusted distinct HTTPS origin, real jmcorgan/fips traversal, four
   Comet validators, separate FROST participants, a throwaway fake mint, and
   the actual browser/Coco service composition;
2. a V2-only firewall replacement or additive rule sequence proven not to
   leave V2 unprotected and not to broaden V1/V3/V4;
3. a new V2 Let’s Encrypt IP-certificate account/key/renewal action or another
   normally trusted distinct origin. The earlier V1 ACME approval does not
   authorize V2 keys or issuance;
4. generation and placement of fresh fake-only Friday FIPS, Comet, validator,
   FROST, signer, coordinator and mint identities, with each private identity
   limited to its exact host/role. No personal SSH or production credential;
5. staging exact R9 artifacts/configs, create-once databases and independent
   rollback anchors, then starting only reviewed Friday units in dependency
   order;
6. the bounded V4-unavailable test and any live rollback/cleanup action.

An interrupted, denied, or uncertain privileged, key-generation, firewall,
certificate, payment, mint, terminal or deployment action must be inspected
before any retry. No blanket approval or deadline substitutes for these exact
action scopes.

## Exact-current acceptance path

The release remains blocked until one retained run proves, with no certificate
warning bypass:

1. Nostr login and separate fake-money payment/refund keys;
2. actual Coco v2 fake-sat funding with NUT-12 DLEQ-valid locked inputs;
3. exact bid preparation, browser authorization and authenticated Comet commit;
4. 3-of-4 BFT finality over jmcorgan/fips, distinct from 3-of-4 FROST signing;
5. a higher bid, certified cooperative displaced-pool return, actual mint
   completion, Coco wallet import and acknowledgement;
6. anti-sniping extension from committed block time;
7. close, winner settlement, seller import and receipt;
8. reserve-unmet return;
9. validator-confirmed pre-admission FundingAbort cancellation and return;
10. one validator unavailable while 3-of-4 BFT continues;
11. public refusal of all internal RPC, mint, signer, site and authority ports;
12. cleanup proving only recorded ephemeral objects were removed.

## Rollback boundary

Before Friday funding, disable and stop only Friday routes/units while leaving
Wednesday untouched. After any funding or ambiguous operation, disable new
funding, bids and auctions but retain the distinct Friday TLS origin, original
Friday mint/keysets, status/recovery, FundingAbort, terminal read/import/ack,
and already-issued seller-plan recovery until every operation is terminal.
Never repoint Friday to Wednesday, create a replacement mint, delete state or
keys, or claim rollback complete while an operation is unresolved.

## Disclosed limitations

- FundingAbortV1 is validator-confirmed cooperative pre-admission cancellation;
  emergency unilateral timeout refund is not composed.
- Own raises remain disabled pending full-pool/stable-key continuity.
- A mint quote lost before a durable operation ID is known is not recovered.
- After a durable FundingAbort signing root is claimed, loss of a selected
  signer fails closed; the fourth signer is not substituted into that session.
- This is fake money, one operator, coordinator-trusted proof verification and
  jmcorgan/fips transport. It is not FIPS 140 compliance and not real-value
  readiness.

Historical note: an earlier local loopback slice at approximately 04:39 UTC
created ephemeral keys/listeners outside a later exact hold. Its evidence is
preserved as a scope deviation and is not authorization, trusted-HTTPS/FIPS
evidence, or a basis to repeat that run.
