# Demo runbook

The service units in `deploy/systemd/` have restart policies, resource bounds,
hardening and journald rate limits. Those settings do not prove 24/7
availability; only live status plus an observation window can support that
claim.

## Key placement invariants

These are three different test-only roles. Never package them together or copy
one node's identity to another node.

- `committee.seed` is the shared Ed25519 application-execution seed expected by
  the ABCI state machine. A fresh copy is required on V1–V4. It is not a
  CometBFT validator identity and not the Cashu lock-attestation key.
- `validator-N/config/node_key.json`,
  `validator-N/config/priv_validator_key.json`, and
  `validator-N/data/priv_validator_state.json` are the distinct CometBFT P2P
  and consensus identity/state for slot N. Install only the matching slot on
  its matching host.
- `cashu-committee.key` is the separate secp256k1 application-coordinator key.
  It signs public lock receipts and derives the AES-GCM key for the encrypted
  coordinator checkpoint. Only V1 receives it. Validators receive only its
  public key through the public network manifest/genesis.

The V1 Nutshell seed is another independent, FakeWallet-only secret generated
and retained on V1. None of these keys is an SSH credential, a production key,
FROST/threshold custody, or suitable for real value. Fresh deployment keys
must never be reused for real money.

## Start / enable

The Linode Cloud Firewall now accepts TCP 26656 only from these four sources:
`172.105.64.142/32`,
`172.105.95.57/32`, `172.104.240.217/32`, and `172.104.253.247/32`.
Preserve the existing SSH rule and inbound DROP/outbound ACCEPT policies.

On each validator host, use only that host's slot number:

```bash
sudo systemctl enable --now plebeian-poc-validator@SLOT.service
```

On V1, after its validator has committed blocks:

```bash
sudo systemctl enable --now plebeian-poc-mint.service
sudo systemctl enable --now plebeian-poc-coordinator.service
sudo systemctl enable --now plebeian-poc-site.service
```

The restricted V1 mint environment must include both
`MINT_AUTH_DATABASE=/var/lib/plebeian-auctions-poc/mint/auth` and
`MINT_INPUT_FEE_PPK=0`. The former keeps Nutshell's separate auth database
inside the unit's permitted writable state; the latter makes new demo keysets
zero-fee. The currently active zero-fee keyset is `00bafe58a7793489`. Do not
enable the Nutshell management RPC for normal operation; its one-time loopback
listener used for that rotation was removed and verified closed.

## Factual status

```bash
systemctl show plebeian-poc-validator@SLOT.service \
  -p ActiveState -p SubState -p Result -p MainPID -p NRestarts
curl --fail --silent http://127.0.0.1:26657/status
curl --fail --silent http://127.0.0.1:8080/api/validators
curl --fail --silent http://127.0.0.1:3339/health
```

Coordinator health must report `checkpoint=encrypted-file-plus-mint-restore`.
Its mode-0600 AES-GCM checkpoint belongs under
`/var/lib/plebeian-auctions-poc/coordinator/`; its encryption key is derived
from the separate demo committee key already required by the coordinator.
Never print, copy into chat, or expose either file through the site.

The validator panel must show a real canonical commit height, app hash and
signature count. A configured restart policy alone is not success.

Current final state on 2026-10-20: all four validator units plus the V1 mint,
coordinator, site and nginx proxy are enabled and active. V4 rejoined after the
fault test and the panel returned to four signatures. The trusted public demo
link is `https://172.105.64.142/`.

## V1 HTTPS activation

The owner approved the Let's Encrypt IP-certificate route and
`dieeoaz@gmail.com` recovery contact. V1 has checksum-verified lego v5.3.1,
Ubuntu nginx `1.24.0-2ubuntu7.18`, the proxy configuration and the ACME units
installed. Nginx and `plebeian-poc-acme.timer` are enabled and active. The
root-only account was registered with the approved contact and the live IP
certificate expires at `2026-10-27T12:02:39Z`.

V1 public interface `1029488` uses the complete V1-only firewall with inbound
DROP, outbound ACCEPT, SSH TCP 22 only from
`71.234.107.170/32`, P2P TCP 26656 only from all four validator `/32`s, and
public IPv4 TCP 443. Do not detach V1 first, add IPv6/80/application/RPC rules,
or add 443 to the firewall shared by V2–V4.

To inspect the live certificate and service:

```bash
sudo openssl x509 \
  -in /etc/plebeian-auctions-poc/acme/certificates/172.105.64.142.crt \
  -noout -subject -issuer -serial -dates -ext subjectAltName
systemctl status nginx.service plebeian-poc-acme.timer --no-pager
systemctl list-timers plebeian-poc-acme.timer --no-pager
curl --fail --silent --show-error https://172.105.64.142/api/validators
```

The ACME service uses TLS-ALPN-01 only on `172.105.64.142:443`, the production
Let's Encrypt directory and `shortlived` profile. Its root-owned mode-0700 data
directory is `/etc/plebeian-auctions-poc/acme`; systemd `UMask=0077` protects
generated account and certificate private keys. When renewal is actually due,
the pre-hook stops nginx, lego answers the challenge, and the post-hook validates
and restores nginx. The timer checks at 00:00 and 12:00 UTC with up to 30 minutes
of jitter. Certificate issuance and validation never require a validator
restart. The initial issuance succeeded before a hardened-sandbox post-hook
failed its redundant standalone `nginx -t` because `/run` was read-only. The
hook now relies on nginx.service's own `ExecStartPre` validation. A subsequent
not-due renewal check kept the same nginx PID and zero restarts. Nginx has an
`on-failure` five-second restart policy, 128 MiB memory limit, 64-task limit and
8,192-file-descriptor limit. Ubuntu's nginx logrotate policy rotates daily,
retains 14 compressed generations and skips empty logs.

## Bounded logs

```bash
journalctl -u 'plebeian-poc-*' --since '-30 minutes' --no-pager -n 500
```

Units apply per-service rate limits. The operator must also confirm the host's
global journald retention before a long soak.

## One-validator-offline walkthrough

1. Record `/api/validators` with four signatures.
2. Stop only V4: `sudo systemctl stop plebeian-poc-validator@4.service`.
3. Close the auction, settle the seller, and record a later panel response with
   three signatures and V4 absent.
4. Restore V4: `sudo systemctl start plebeian-poc-validator@4.service` and wait
   until `catching_up=false` and four signatures return.

## Stop without deleting state

```bash
sudo systemctl stop plebeian-poc-site.service plebeian-poc-coordinator.service plebeian-poc-mint.service
sudo systemctl stop plebeian-poc-validator@SLOT.service
```

This leaves consensus, mint and encrypted coordinator checkpoint state in
place. Do not delete those paths or rotate identities during the demo. A
planned coordinator restart was exercised locally with two outstanding locks;
the deployed coordinator also restored its encrypted checkpoint. See
`POC-NOTES.md` for the remaining mid-operation crash limitation and the exact
remote evidence hash.

The deployed NUT-11 refund locktime is auction end plus a 60-second settlement
grace. The earlier 10-second value was too short for an operator-observed V4
fault plus remote CometBFT close; the mint correctly rejected a committee spend
after that old locktime. Do not shorten this grace without repeating the remote
fault rehearsal.

Ignore the pre-existing failed `auction-r4-failstop-fix14/fix15` units during
POC status checks. They belong to historical work and must not be reset,
started, edited or removed by this runbook.

## Friday candidate: local-only review

The Friday changes are not deployed. They replace new bid locks with custodial
reservations over already funded proofs, while preserving all Wednesday
NUT-11 records as explicitly tagged legacy state. New auctions accept only the
Friday reservation funding mode; they reject NUT-11 and interim-note bid paths.
The old interim faucet is disabled unless an operator deliberately sets
`POC_ENABLE_LEGACY_INTERIM=true` for a separately isolated historical harness.
Do not set that variable for Friday, and do not point a Friday process at the
live V1 state directory or wallet database.

The Go `scenario` command is also a retired Wednesday harness and is guarded by
the same variable. Friday acceptance uses the isolated
`cashu-wrapper/ts/friday-site-live.ts` flow after the focused suites pass.

Focused review commands:

```bash
GOCACHE=/tmp/plebeian-friday-go-build go test -mod=readonly ./...
cd cashu-wrapper/ts
bun run test:friday
bun build poc-coordinator.ts --target=bun --outfile=/tmp/plebeian-friday-coordinator.js
```

Reproducible isolated live checks own and clean every service they start:

```bash
scripts/friday-live-recovery-test.sh
scripts/friday-local-acceptance.sh
scripts/friday-mint-down-close.sh
```

The first reconstructs Coco over the same SQLite database after lost mint/send
responses, including a proxy that drops one completed swap response. The second
starts a throwaway zero-fee FakeWallet mint, four local validators, coordinator
and site, then runs the real reservation, payout, reserve-unmet and conservation
flow. The third stops only local validator four and the owned throwaway mint,
proves consensus close plus unavailable seller status, restarts that same mint
database/seed, and proves one exact payout. Each script refuses occupied ports,
records exact PIDs, uses bounded timeouts and removes only its own `mktemp`
state. The main acceptance evidence is
`evidence/friday-site-local-20261021T184957Z-1088127.json` with SHA-256
`90c78ce1a778e0d411b237922c25c417315ece15ba6a65e767fd04ae0813d0e8`.
Crash evidence is
`evidence/friday-fault-matrix-20261021T190908Z-1091851.json` with SHA-256
`cc6f6cc19d77a505367973926fd0732a0ee583f002573119807481534b26843f`.
Mint-down/three-validator evidence is
`evidence/friday-mint-down-close-20261021T191556Z-1095740.json` with SHA-256
`c9e6f36d87e3b5b2c14e217625a25701c400b77664a8612841de236fec092ee1`.

`scripts/friday-ui-smoke-server.sh` is only a temporary read-only browser-smoke
server. Interrupt it through its wrapper so the recorded child validator PIDs
are also stopped; it is never a deployment command.

Friday wallets persist under the private directory named by
`POC_WALLET_DB_DIR` (or the `wallets` sibling of `POC_COORDINATOR_STATE`). The
directory is mode 0700 and each SQLite database is mode 0600. The encrypted
checkpoint retains the funding journal, reservation/outbox state and any
short-lived payout bearer token. A reported `unknown` payment is unavailable;
never retry it with a fresh operation ID.

`scripts/friday-seed.sh` defaults to a no-write plan and refuses an existing or
broad target. `scripts/friday-reset.sh` defaults to an inventory and, even when
separately authorized, moves one exact state directory to a recoverable
quarantine instead of deleting it. Its execution gate is not authorization to
reset the deployed demo. No Friday reset or seed has been executed.
