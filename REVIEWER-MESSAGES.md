# Reviewer Outreach Messages

Copy and paste these into your messenger.

---

## To Franchovy

Hey Maxime, apologies for the PR flood earlier — I've cleaned up. I moved all the test cleanup and smaller bugfix PRs to my fork to reduce noise. The only PRs left on upstream are the ones that matter most:

**#975** — Security: remove committed secrets and hardcoded keys
- 8 files, mostly deletions (`.env.dev`, encrypted wallet, hardcoded fallback keys)
- The one real code change: `contextvm/server.ts` no longer silently falls back to a hardcoded private key — it now refuses to start without `CVM_SERVER_KEY`
- CI green, e2e regression check passed (no regressions vs master)
- Deployed at https://pr975.test-market.orangesync.tech for manual verification
- There's also #986 tracking the key rotation that needs to happen after this merges

**#947** — NIP-53 auction live chat
- I know this one is already in your queue. No rush, just flagging that the other PRs are out of the way now.

---

## To maximotodev

Hey! I just approved #951 from hkarani (with a note about the reserve='0' UX issue). I also moved all my test cleanup PRs to my fork to reduce noise — the only ones left on upstream are security (#975) and NIP-53 (#947).

If you have a moment, I'd appreciate your eyes on #975 too — the security fix. It touches payment/wallet code you know well (removes hardcoded CVM key, fixes .env.dev leak).

I'll re-open the smaller PRs on upstream later when bandwidth frees up.

---

## To hkarani

Hey! I approved #951 (with a note about the reserve='0' UX issue Franchovy flagged). I moved all my test cleanup PRs to my fork to reduce noise on the upstream repo — the only ones left upstream are security (#975) and NIP-53 (#947). No asks from me right now, just wanted to give you a heads-up.
