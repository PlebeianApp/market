# Friday emergency refund — smallest compliant implementation plan

Status: **REQUIRED GAP; NOT IMPLEMENTED OR TESTED**.

Ordinary outbid return and emergency refund are different authorities.  A
committed certified displacement should start the exact cooperative return
immediately; the bidder need not be online because admission must already have
bound an exact return template and bidder authorization.  The returned amount
becomes spendable only after the mint result is known and recipient proofs are
imported.  An outage or lost response remains pending/unknown and the same
operation is recovered; it is never paid again blindly.

The smallest emergency path keeps the client-held refund key in the admitted
NUT-11 pool.  Admission must bind, in consensus and each signer policy:

- the exact pool proof-Y set, mint/keyset and funded amount;
- the bidder's refund public key and exact refund destination;
- a refund locktime of `originalEnd + 1800 + 900` seconds (maximum extended
  auction end plus a 15-minute signing/mint/recovery budget);
- the exact emergency SIG_ALL template digest and the normal MAIN/outbid
  template digests;
- auction, bid, reservation version, DKG run, roster and keyset identities.

Before admission succeeds, the browser/client must provide the complete exact
emergency authorization package; storing only a key or an arbitrary future
template is insufficient.  After locktime, the bidder can submit that one
pre-authorized exact refund to the mint without a committee share.  The server
persists a durable operation before the mint request, checks NUT-07/09 on
recovery, imports proofs to the bidder, and only then marks the pool terminal.

This escape path cannot revoke a previously signed MAIN spend.  If MAIN and
emergency refund race after locktime, the mint's first valid spend wins.  The
loser must resolve to the same observed spent-input state and terminal branch;
the UI must say which branch won and must not claim refund priority.  A stale,
wrong-keyset, wrong-recipient, changed-proof, duplicate or cross-auction
package is rejected.  Pool excess is returned with the whole displaced pool;
top-ups create a new reservation version and supersede old packages only after
the new backing and package commit atomically.

Required evidence before deployment: online and offline displaced bidder,
pre/post-deadline refusal/success, MAIN-versus-refund ordering both ways,
lost mint response, process crash before request/after unknown/after mint
before import, signer/validator unavailable, exact recipient proof ownership,
single terminal branch and conservation.  R5 does not contain this authority,
so even a successful R5 lab proves only cooperative outbid return, winner
payout and reserve-unmet return.
