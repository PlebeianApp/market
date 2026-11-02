# Exact deployment proposal and verified inventory

## Owner-approved demo inventory leads

| Slot | Linode label | Linode ID | IPv4 | Expected ED25519 SSH host key |
|---|---|---:|---|---|
| V1 | `auction-demo-v1-20261016` | 108175009 | 172.105.64.142 | `SHA256:gPo3YN+P9EUShH80R80nizQy6QFG0WtU75EFthvhydc` |
| V2 | `auction-demo-v2-20261016` | 108236985 | 172.105.95.57 | `SHA256:2BgLKY4VmAFj0lpEr3EdD5Rtl1x/7fcJ6/F2j6/wVS8` |
| V3 | `auction-demo-v3-20261016` | 108237290 | 172.104.240.217 | `SHA256:dXtbz59mA2TYzrC3Y7rVUJ4XlxQfD8z1mee07JvBVjY` |
| V4 | `auction-demo-v4-20261016` | 108237424 | 172.104.253.247 | `SHA256:DSKpmtS0Iv5PJgqZbsuTndS9MPlazWdYMmtz2nbtcTk` |

Historical provider firewall: `auction-demo-20261016-fw`, ID 207368807.
Never use production `192.46.234.233`.

## Proposed placement

- V1: validator 1, loopback site/API, loopback Nutshell/FakeWallet mint,
  loopback Cashu coordinator, and the existing HTTPS proxy after conflict
  inspection.
- V2–V4: one validator each. No website or mint workload.
- Each validator RPC stays on `127.0.0.1:26657`. The V1 panel derives the
  other validators' liveness from their signatures in the canonical commit and
  V1's live peer set, so no public RPC port is needed.
- P2P uses TCP 26656. Memory caps in the supplied units keep mint/site load from
  starving V1's validator.

## Verified host and staging state — 2026-10-20

- Strict host-key-checked SSH reached all four pinned hosts with the owner's
  existing key. Each host has 4 GB RAM and about 71 GB free disk. Historical
  R2–R4 files and their inactive failed units remain untouched.
- The public POC binary, public genesis/manifest and enabled validator unit are
  installed and running on all four hosts. V1 also runs the enabled
  site/coordinator/mint units, Bun 1.3.11 and Nutshell 0.19.2. RPC, mint,
  coordinator and site remain loopback-only; only P2P listens off-host.
- A denied pre-install transfer had a partial outcome discovered by a deeper
  metadata check: mode-0600 staging copies of the shared test committee seed
  plus V2's own consensus/P2P identity landed on V2, and the corresponding V3
  set landed on V3. They were never activated or read by a running process.
  With explicit owner approval, all eight exact files were unlinked and every
  path was verified absent. No unrelated remote or local evidence was deleted.
- A completely fresh replacement network, `plebeian-poc-1792522724`, was then
  generated. Its four node keys and four validator keys are unique, its public
  manifest matches genesis, and both application keys differ from the retired
  set. Each host received only its matching identity plus the approved shared
  app seed; V1 alone received the Cashu key. Final secret files are owned by
  the unprivileged app user and mode 0600. The independent V1 FakeWallet mint
  seed lives only in a root-owned mode-0600 environment file. All installed
  units passed `systemd-analyze verify`. The final remote acceptance evidence
  is `evidence/remote-cashu-comet-20261020.json`, SHA-256
  `1df69ca1f31f74abbc1573419016977e7e194c06593fbd5964f65f53c116bb9f`.

## Exact changes still requiring confirmation/approval

1. Provider firewall: TCP 26656 is now accepted **only among the four exact
   `/32` addresses above**. Actual four-node consensus and peer connectivity
   verify the rule is effective. Existing SSH rules remain untouched.
2. Public HTTPS: permit public IPv4 TCP 443 to the chosen proxy. The owner
   approved this exact network surface on 2026-10-20. No direct public exposure
   of 8080, 3338, 3339 or 26657 and no public IPv6 listener without separate
   review. V1 public interface `1029488` is now attached directly to
   `plebeian-poc-web-v1`; V2–V4 remain on the shared validator firewall.
3. HTTPS identity: the owner does not directly control a domain. Chiefmonkey
   reportedly controls `plebeian.market`, but no demo record or delegated
   access is confirmed and this task has made no DNS change. A
   DNS-independent, publicly trusted option is a Let's Encrypt 160-hour IP
   certificate for `172.105.64.142`, using the `shortlived` ACME profile and
   TLS-ALPN-01 on the already-approved TCP 443. The owner approved the CA
   agreement, `dieeoaz@gmail.com` contact and V1-only key generation/storage on
   2026-10-20. The selected
   client is upstream lego v5.3.1 against Let's Encrypt's production directory,
   using `--profile shortlived` and TLS-ALPN-01. The live certificate expires
   at `2026-10-27T12:02:39Z` and is checked for renewal every 12 hours. Certificate
   Transparency will publicly disclose V1's IP, certificate/public key, serial
   and validity dates. The cost is $0.

The approved ACME action covers: accepting the
ISRG/Let's Encrypt Subscriber Agreement v1.8 dated 2026-07-06
(`https://letsencrypt.org/documents/LE-SA-v1.8-July-06-2026.pdf`); either naming
and approving a recovery-contact email sent to ISRG or approving no-contact
registration if accepted; installing verified upstream lego v5.3.1 and Ubuntu
nginx; generating a V1-only EC256 ACME account key and TLS private key in a
root-owned mode-0700 directory with key files mode 0600; and installing the
12-hour renewal/reload timer. Issuance would use Let's Encrypt's production
directory, IP SAN `172.105.64.142`, `--profile shortlived`, and TLS-ALPN-01 on
443. Checksum-verified lego v5.3.1 and Ubuntu nginx `1.24.0-2ubuntu7.18` are
installed. The owner-approved account was registered with the approved contact,
the CA accepted the TLS-ALPN-01 validation, and the trusted IP certificate is
live at `https://172.105.64.142/`. Nginx and the renewal timer are enabled.

TCP 80 is not part of the current approval. The proposed IP-certificate route
uses TLS-ALPN-01 only on 443. Self-signed certificates, browser-warning bypasses
and third-party tunnels are not acceptable substitutes.

The owner used public Linode interface `1029488`'s direct Firewall selector to
replace its assignment with the complete V1-only firewall, without a separate
detach or shutdown. It preserves the exact SSH rule and four-source P2P rule
and adds only public IPv4 443. V2–V4 remain on the shared firewall with no 443
rule. External checks confirm 80, 3338, 3339, 8080 and 26657 remain blocked.

Exact listener plan: validators expose P2P on `0.0.0.0:26656`; validator RPC is
`127.0.0.1:26657` on every host. V1 alone binds the mint to
`127.0.0.1:3338`, coordinator to `127.0.0.1:3339`, site to
`127.0.0.1:8080`, and the inspected TLS proxy to public IPv4 TCP 443.

Remote genesis can be prepared with:

```bash
plebeian-auctions-poc init-remote \
  --home /secure/staging/network \
  --hosts 172.105.64.142,172.105.95.57,172.104.240.217,172.104.253.247
```

Distribute each host only its own `validator-N` directory plus the shared
`network.json`, `genesis.json`, `committee.seed`, and binary. Only V1 receives
`cashu-committee.key`, the coordinator, the mint environment, and site assets.
