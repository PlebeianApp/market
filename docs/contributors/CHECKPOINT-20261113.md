# Maintainer checkpoint — 2026-11-13

Status: local preparation; not published, not a deployment, not a full modular
rewrite or an end-to-end acceptance certificate.

## Source boundary

Public parent: `41c7098e13fb8854abf5e304653d91ca18e23d0b` on
`contrib/auctions-mvp-recovery-2026-11-06`.

Selected source snapshot: `574f90b45bfe0b193f0e87e9a0e1cdaddd77bb34`
(`codex/r86-terminal-fastpath`), tree
`7c2ab1e793bea0f288cb8e087ad40135b4a5e95d`. The source snapshot includes
the reviewed Catalogue/Chief Design A lineage and later payment, terminal and
readiness corrections through R86.

This is a source overlay onto the public contributor lineage. It does not attach
the private/local recovery history. The separate profile/demo candidate at
`9ed795b1810a63d735d6c96cc23e2164f63c8dd3` is not silently merged. The R87-R90
V3 recovery continuations are operational recovery material and are also excluded
from this source checkpoint pending their own review. No server or wallet was
modified while preparing it.

This branch preserves the selected source checkpoint and adds a corrected entry
README, contributor module map, provenance, push plan and agent rules. Historical
README and the November 6 manifest remain available under dated names. Further
module extraction should follow the small tested steps in the guide.

## Remote observations

Read-only GitHub observation on 2026-11-13:
`https://github.com/PlebeianApp/market.git`
- master: `d4757b409b58e0ecf7c43e53629dd464c32dfb4e`
- contrib/auctions-mvp-recovery-2026-11-06:
  `41c7098e13fb8854abf5e304653d91ca18e23d0b`

Read-only ngit observation on 2026-11-13:
`nostr://npub165ka9706vpl8phnw0w5wh89za8nnl56dajz92h6e2m9uxxvkz6wszt0gn5/relay.ngit.dev/auctions-mvp`
- wip/auctions-mvp-checkpoint-2026-10-19:
  `6c022a72e07ae077a70a7e6945184410ff8a7d22`
- wip/auctions-mvp-checkpoint-2026-10-28:
  `c616154735f4a31f1ea140e904d9d0eea2ea92c6`

These observations establish reachability, not publication permission. The
prepared branch name is `checkpoint/auctions-maintainer-2026-11-13-r86`; it does
not exist on either remote. No push occurs during preparation.

## Remaining release gates

- Reconcile the currently deployed release and V3 recovery result against the
  selected R86 source snapshot.
- Review the separate profile candidate before inclusion.
- Complete independent review of the outgoing snapshot, vendored archives and
  publication diff. The bounded scan performed here is not a formal secret audit.
- Run the full test matrix against the final combined tip.
- Complete live bid/refund/close/payout/acknowledgement/conservation acceptance.
- Verify GitHub/ngit write permission immediately before publication and use the
  recorded remote tips as safety anchors. The recommended operation creates a new
  branch and needs no force.

A checked-in clean tree is not sufficient evidence that historical contents are
safe to publish. This checkpoint must not be described as push-ready until those
gates have results.
