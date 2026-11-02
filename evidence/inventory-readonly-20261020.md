# Read-only deployment inventory result — 2026-10-20

- Historical host-key receipt
  `/home/maximoto/Documents/Codex/2026-10-14/task-4/auction-rehearsal-staging-20261016/inventory/ssh-hostkeys/scan-20261015T144315Z/SHA256SUMS`
  verified locally as SHA-256
  `6c052a85452e501e24515503000a98b08329a4b02f669fefaa6d1405064ced2b`.
- The local pinned `known_hosts` entries for V1–V4 matched the four expected
  ED25519 fingerprints in `DEPLOYMENT-PROPOSAL.md`.
- One bounded, noninteractive, strict-host-key SSH attempt was made only to V1
  (`root@172.105.64.142`) with an 8-second connection timeout and 20-second
  outer timeout. It reached the host and returned `Permission denied
  (publickey)`. No remote command ran and no remote state changed.
- No SSH agent was active. The existing owner key was not unlocked; no
  password/passphrase was requested or printed, and no replacement credential
  was created.
- Read-only DNS lookup: `auction-demo.plebeian.market` returned no A, AAAA or
  CNAME. `plebeian.market` nameservers are `ns1.dreamhost.com`,
  `ns2.dreamhost.com`, and `ns3.dreamhost.com`.

Required next owner action: unlock the existing SSH key in a local agent and
request a retry. Never send the passphrase in chat.
