# Friday R7 next action — exact-current candidate, not execution approval

R7 source is commit `9622506dcf14c8fd96fed6037515de6b8dc41d94`.
The artifact hashes and completed regression gates are recorded in
`FRIDAY-CANDIDATE-R7-BUILD-RECEIPT.json`.

## What is ready

- The browser bundle embedded in the Go site is byte-identical to the separately
  retained R7 browser bundle.
- The fixed authority CLI composes Coco v2 prepared funding, four authenticated
  FIPS signer clients, 3-of-4 admission FROST, Comet finality, terminal FROST,
  recipient Coco import/ack and the approved FundingAbortV1 recovery path.
- FundingAbort owns separate journal, rollback-anchor and signer-session stores.
  It cannot derive authority from local absence, elapsed time or a coordinator
  journal alone.
- The four dedicated demo hosts, Wednesday paths and public route were not
  accessed or changed while building R7.

## Exact remaining acceptance work

R7 is not deployable merely because it compiles. Before any live mutation, an
independently reviewed, exact-current controller must exercise these R7 hashes:

1. public-origin Nostr sign-in and Coco v2 fake funding;
2. exact bid authorization and 3-of-4 Comet commit over jmcorgan/fips;
3. a competing higher bid, anti-sniping extension and certified outbid return;
4. separate 3-of-4 FROST terminal SIG_ALL authorization, Nutshell 0.19.2
   FakeWallet spend/recovery, recipient Coco import and signed acknowledgement;
5. close/winner payout, reserve-unmet return, validator unavailable and signer
   unavailable;
6. post-lock preparation failure through FundingAbortV1, including permanent
   bid/abort mutual exclusion and exact imported return;
7. restart/lost-response recovery without a second consensus transaction, mint
   spend or recipient import.

The local no-egress namespace lab cannot truthfully prove the public browser
origin `https://172.105.64.142` without either copying the V1 TLS private key or
installing an artificial trust root. Neither is authorized. The smallest honest
acceptance is therefore a reviewed blue/green run on the four dedicated demo
Linodes with an owner-IP-only V1 HTTPS candidate route, while Wednesday remains
the fallback for everyone else. This is a deployment design conclusion, not
evidence that the route or R7 exists on those hosts.

## Consolidated owner actions after review

No command below is approved yet. A final action-time request must contain exact
bytes and hashes for:

- read-only inventory of V1 `172.105.64.142`, V2 `172.105.95.57`, V3
  `172.104.240.217`, V4 `172.104.253.247` and their current firewalls;
- the R7 per-host artifact/config/systemd manifest and literal rollback commands;
- fresh fake-only FIPS, Comet and four-member FROST identity generation and exact
  host placement (never personal SSH keys and never real funds);
- source-restricted UDP 32121 among only the four validator IPv4 `/32`s, with
  existing SSH, P2P and V1-only HTTPS rules preserved;
- create-once state and independent anchor initialization;
- Friday-only service start order and an owner-IP-only V1 nginx route;
- the bounded acceptance/fault sequence above and the exact cleanup/quarantine
  behavior for an interrupted or outcome-unknown payment.

The older R5 and R6 staging recipes must not be reused for R7. Their binary
pins predate FundingAbortV1 and the exact browser bundle in this receipt.

Any interrupted key generation, firewall update, initializer, service start or
payment has an uncertain outcome until inspected. It must not be retried or
cleaned automatically. The Wednesday deployment remains the fallback.

## Explicit non-claims

- R7 has not traversed FIPS in an exact-current run.
- The browser/Coco journey has not run against these exact artifacts.
- No live host is deployed or modified.
- FundingAbortV1 is not a unilateral emergency timeout; the MAIN-versus-refund
  first-mint-spend policy remains unresolved and disabled.
- Own raises remain disabled.
