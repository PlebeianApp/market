# POC notes — 2026-10-20

## Genuinely exercised

- The fresh four-host network `plebeian-poc-1792522724` is deployed on the
  pinned V1–V4 Linodes. All four distinct validator and P2P identities reached
  the same canonical commit with four signatures. The units are enabled and
  active with zero validator restarts after the final rehearsal.
- The remote V1 site drove two 10,000-sat faucets, 120- and 180-sat NUT-11
  locks, forged-attestation rejection, consensus close, real mint settlement,
  and the timelocked refund. V4 was stopped through pinned SSH; V1–V3 closed
  and continued to height 925 with three signatures. V4 was restored and the
  network returned to four-signature commits at height 963.
- Nutshell 0.19.2 with `FakeWallet` minted two independent Coco v2 wallets
  10,000 worthless sats each.
- The site API created 120- and 180-sat NUT-11 locks. The 180-sat lock won.
- Four distinct CometBFT validators agreed on both bids. A client-authored lock
  assertion without the committee signature was rejected with HTTP 422.
- Validator 4 was stopped before close. Validators 1–3 committed the close and
  continued to height 164 with three commit signatures.
- The coordinator spent the exact token digest selected by consensus; the
  seller Coco wallet received 180 proofs. An early refund was refused, and the
  losing bidder's mint-enforced refund later restored their balance to 10,000.
- The winner's actual remaining Coco balance was 9,820.
- A separate three-tab browser walkthrough exercised a fresh disposable Nostr
  identity, faucet, auction creation, two funded bids, coordinator restart,
  close with V4 offline, seller payout and losing refund through visible UI
  controls. This was an actual browser test, not only HTTP/API acceptance.
- The coordinator was deliberately restarted with both bid locks outstanding.
  Its encrypted checkpoint loaded, Coco recovered spendable proofs from the
  mint, the 120-sat lock remained refundable, and settlement/refund completed.

Evidence:

- `evidence/remote-cashu-comet-20261020.json`, SHA-256
  `1df69ca1f31f74abbc1573419016977e7e194c06593fbd5964f65f53c116bb9f`,
  records the deployed V1–V4 run: seller 180, loser 10,000, winner 9,820,
  invalid attestation HTTP 422, four signatures before the fault and three
  during the V4 outage.
- `evidence/site-cashu-comet-20261020.json`, SHA-256
  `da09efa96089fa2e98eb20ec214f7670fe3f0931668511b0e72019389bd921a2`
- `evidence/integrated-cashu-comet-20261020.json`, SHA-256
  `d612ab8a511fea5451b1d945fa929310470d362859bb8207e094afe316686f26`
- `evidence/cashu-live-20261020.json`, SHA-256
  `1bec80b16a3d37440382e2f6f65e95ad65ae1f47d28f758e720b36d8142a3e33`
- `evidence/browser-cashu-comet-20261020.json`, SHA-256
  `6b869bace982c1c6ce0cd09ddc8e2085fd30c8cac287a4a25988538878078357`,
  records the actual browser walkthrough.

No evidence file contains a bearer token, wallet seed, committee private key, or
Nostr private key.

## Explicit shortcuts

- One application-level coordinator key attests that Coco created/read back a
  strict mint-signed NUT-11 lock. Consensus verifies that attestation, binding
  mint URL, auction, bidder, amount, operation, token digest, refund key and
  locktime. Consensus does not independently fetch or validate bearer proofs.
- The coordinator hosts in-memory Coco repositories and therefore has custody
  of demo users' worthless tokens. For the demo it now atomically writes a
  mode-0600 AES-GCM checkpoint containing wallet seeds, outstanding locks,
  refund authority and settlement/faucet indexes; on restart Coco restores
  spendable proofs from the mint. The encryption key derives from the separate
  demo committee key, so this is host-local accident protection, not a defense
  against a host or committee-key compromise.
- This is not FROST, threshold custody, durable wallet hosting, FIPS, or a
  production-readiness claim.

## Safety separation

The POC is a fresh module and did not change the R4.4.2 payment candidate, its
guards, the R16 work, the repair workflow, or any sealed artifact. The interim
Ed25519-note harness remains namespaced under `/api/interim/` for local
regression evidence only; the user-facing site uses the Cashu coordinator.

## Known failures / next steps

- All four pinned hosts were verified through strict host-key-checked SSH. The
  validator units are installed, enabled and active on V1–V4. V1 also has
  enabled and active Nutshell 0.19.2, coordinator and site services. P2P is the
  only POC listener reachable off-host; RPC, mint, coordinator and site remain
  loopback-only. The final measured memory use was about 54 MB per validator,
  84 MB mint, 52 MB coordinator and 9 MB site.
- Two pre-existing historical `auction-r4-failstop-fix14/fix15` units remain in
  failed/inactive state on every host. They expose no listener and were not
  started, reset, edited or removed by this POC.
- A denied secret-transfer batch had a confirmed partial outcome: temporary
  root-only staging copies of the shared test seed and each host's own identity
  landed on V2 and V3. No process consumed them. After explicit approval all
  eight exact files were removed and individually verified absent. A fully
  fresh network and key set was generated; it differs from the retired set and
  was deliberately installed with correct per-host separation and permissions.
- The local network generated at 18:42:39 UTC is retired and must not be used
  for deployment. It remains task-local only so the incident can be audited;
  no blanket deletion of local evidence is authorized or needed.
- The owner does not directly control a domain. Chiefmonkey reportedly controls
  `plebeian.market`, but no demo record or delegated access is confirmed; this
  task has made no DNS change. A publicly trusted Let's Encrypt short-lived IP
  certificate for V1 is technically feasible using TLS-ALPN-01 solely on TCP
  443. The owner approved the linked CA agreement, `dieeoaz@gmail.com` recovery
  contact, V1-only keys, lego/nginx and renewal timer on 2026-10-20. The
  account is registered and the key/certificate are stored root-only on V1.
  The trusted link is `https://172.105.64.142/`; no DNS change was needed.
- The owner applied the source-restricted TCP 26656 provider rule, and actual
  four-host peer connectivity proves it is effective. Public IPv4 TCP 443 on
  V1 was directly reassigned through public interface `1029488` to a separate
  ruleset preserving SSH and P2P plus public 443. The shared firewall did not
  receive a broad 443 rule. TCP 80 remains blocked. Do not reuse historical 8443;
  historical FIPS services used that port.
- The site remains bound to `127.0.0.1:8080` behind nginx. Its trusted public
  entry point is `https://172.105.64.142/`; external CA verification passed
  without a warning bypass. No plain public HTTP, domain or tunnel is used.
- The first mint start looped 15 times because Nutshell's separate auth
  database defaulted under the read-only application directory. It was stopped
  and corrected to the existing writable state directory without weakening the
  unit. The final mint process has zero restarts after its last deliberate
  restart. A nonzero default fee keyset was rotated to an active zero-fee demo
  keyset; the temporary loopback management listener was then disabled and is
  closed.
- Failed acceptance rehearsals left only worthless test-state residue: expired
  locks from two pre-fault runner exits and one late-settlement run, plus one
  fee-bearing 179-sat seller payout used to diagnose the default mint fee. They
  are retained as auditable test history and are not completion evidence.
- Units are enabled with restart/resource/log policies and survived deliberate
  coordinator/mint/V4 restarts, but this observation window is not a claim of
  measured 24/7 availability.
- Graceful and between-operation coordinator restart is recoverable and was
  exercised. A hard crash in the narrow interval after a mint mutation but
  before the coordinator checkpoint can still strand a just-created outgoing
  token. A production design still needs Coco's full transactional repository,
  operation reconciliation and independent key custody.
- The older custom signed-note evidence proves the consensus state machine but
  is not Cashu and is not accepted as payment completion evidence.
