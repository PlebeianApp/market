# Reviewer Outreach Messages

Copy and paste these into your messenger.

---

## To Franchovy

Hey Franchovy, apologies for the PR flood — I know it's a lot. I actually made it worse on purpose by decomposing the original 2 large PRs into 5 smaller tightly-scoped ones so they'd be easier to review. I've organized everything with a merge order in [#979](https://github.com/PlebeianApp/market/issues/979) so nothing steps on each other.

I have two small focused PRs I'd appreciate your eyes on when you get a chance:

**#975** — Security: remove committed secrets and hardcoded keys
- 11 files, mostly deletions (`.env.dev`, encrypted wallet, hardcoded fallback keys)
- The one real code change: `contextvm/server.ts` no longer silently falls back to a hardcoded private key — it now refuses to start without `CVM_SERVER_KEY`
- CI green, e2e regression check passed (no regressions vs master)
- Deployed at https://pr975.test-market.orangesync.tech for manual verification
- There's also #986 tracking the key rotation that needs to happen after this merges

**#982** — ContextVM singleton test fix (2 files, 15-line diff)
- Exports `resetCurrencyClient()` so tests can clean up the singleton between runs
- Fixes 3 unit tests that were timing out at 5000ms due to cached client state
- CI green, closes #963

No rush on #947 — I know that's a bigger review. These two are quick.

---

## To maximotodev

Hey! Apologies for the PR flood — I know it's a lot. I actually made it worse on purpose by decomposing the original 2 large PRs into 5 smaller tightly-scoped ones so they'd be easier to review. I've organized everything with a merge order in [#979](https://github.com/PlebeianApp/market/issues/979) so nothing steps on each other.

I just reviewed your #988 and #991 — both approved. Quick note: I recommended #988 merge before #991 since they both touch `auctions.$auctionId.tsx`.

I'd love a reciprocal review on two small PRs if you have a moment:

**#983** — Cart persistence fix (1 file, 12 lines)
- Re-read guard in `reconcileRemoteCartForUser` — prevents overwriting local cart items with stale remote data during the async login window
- CI green, closes #964

**#984** — Alby LNURL proxy bypass (2 files, 3 lines added)
- `{ proxy: false }` on LightningAddress constructor so e2e mocks can intercept requests
- Skip public ZAP_RELAYS when LOCAL_RELAY_ONLY is set
- CI green, addresses #703

---

## To hkarani

Hey! Apologies for all the open PRs — I decomposed my work into small tightly-scoped ones to make review easier. I've organized everything with a merge order in [#979](https://github.com/PlebeianApp/market/issues/979) so nothing steps on each other.

I approved #988 and #991 from maximotodev (both touch auctions detail page FYI). I also saw #951 — looks like Franchovy and maximotodev have some feedback on `isMeaningfulDraft` coverage. Happy to review once you've had a chance to address their comments.

If you get a moment, I have one PR that's in your domain:

**#981** — CI infra improvements (6 files)
- Pins Bun to 1.3.10, expands unit test glob, fixes broken unit tests
- Prettier + unit-integration green. 2 e2e shards fail but those are pre-existing on master (shipping selectors — tracked in #985)
- No production logic changes — only CI workflow files and test infrastructure
