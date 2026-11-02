# Friday terminal branches — next live evidence cases

Status: **source plan only; NOT_RUN**. The completed outbid-return evidence is
frozen and is not reopened by these cases.

Each case must use a new throwaway Nutshell 0.19.2/FakeWallet mint with exactly
one active zero-fee sat keyset, a new four-validator loopback Comet network, a
fresh 3-of-4 DKG and distinct signer state. The harness must retain the same
exact DLEQ, NUT-07 input-state, NUT-09 recovery, recipient unblind/import and
exclusive-conservation assertions as the completed outbid case.

## Winner payout

1. Admit an auction-scoped pool and exact seller recipient template.
2. Commit the funded bid and close with reserve met using committed block time.
3. Authenticate H/H+1/H+2 plus S/S+1 state binding.
4. Make one signer unavailable; obtain three independent participant-policy
   acceptances and a real Rust 3-of-4 SIG_ALL signature.
5. Drop the mint response after the spend, recover the exact output set, import
   it using the seller's private recipient journal, and prove the seller owns
   the exact amount as unspent usable proofs.
6. Prove the input pool is spent, swap count is one, winner and refund branches
   cannot both become terminal, and a retry returns the recorded result.

## Reserve unmet / no sale

Repeat the same path with reserve greater than the committed top bid. The exact
full pool returns to the bidder recipient; the seller receives nothing. Prove
one real 3-of-4 refund signature, one mint spend/recovery/import, no winner
payout, and exclusive terminal state.

## Emergency unilateral refund

Use the fixed locktime formula:

`original end + 1,800-second maximum extension + 900-second recovery budget`.

Before locktime the mint must reject the unilateral bidder refund. At or after
locktime, the bidder/refund-key branch may spend without a committee signature
and import the exact amount. A separately retained MAIN signature is not
revoked by time: a controlled competing MAIN/refund attempt must prove the
first valid mint spend wins, the other branch observes spent inputs, and no
fresh payment is created. Evidence must not claim refund priority or an
instant/time-guaranteed refund.

## Required interruption points

For winner and no-sale, kill and restart the owning coordinator at: durable
claim before mint, mint attempting with unknown response, mint succeeded before
recipient import, and after recipient import. For emergency refund, interrupt
after output preparation and after mint acceptance. Every restart must use the
same operation/root identity and independently persisted output openings;
unknown outcomes remain unavailable until exact recovery completes.

Passing component mocks do not satisfy these cases. The acceptance artifact
must identify exact source/binary hashes, owned PIDs, process cleanup, mint and
Comet roots, FROST participants, actual proof-state digests and recipient
ownership while excluding bearer proofs, openings, shares and private keys.
