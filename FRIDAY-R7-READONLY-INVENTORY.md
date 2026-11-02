# Friday R7 four-host read-only inventory

Status: **PREPARED ONLY — the prior SSH agent is no longer usable.** These
commands make no remote changes. They must be run only after the owner unlocks
the existing `/home/maximoto/.ssh/id_ed25519` into
`/tmp/plebeian-poc-owner-agent.sock`; no passphrase or key material is sent to
chat, copied to a host, or forwarded.

## Local authentication and host-key gate

```bash
SSH_AUTH_SOCK=/tmp/plebeian-poc-owner-agent.sock ssh-add -l
```

The only acceptable fingerprint is the previously verified owner key
`SHA256:IGu9dXOSXw4JoPmwNjAgDRI2AY+zJil/haJGjKRYt34`. Stop on any error or
different fingerprint. Every SSH command must retain:

```text
-o BatchMode=yes
-o ConnectTimeout=8
-o ConnectionAttempts=1
-o StrictHostKeyChecking=yes
-o UserKnownHostsFile=/home/maximoto/.ssh/known_hosts
-o IdentityAgent=/tmp/plebeian-poc-owner-agent.sock
```

Do not accept or replace a host key. Do not use agent forwarding.

## Exact remote command

Run the following command independently against each approved demo address:
`172.105.64.142`, `172.105.95.57`, `172.104.240.217`, and
`172.104.253.247`. Production `192.46.234.233` is excluded.

```bash
ssh SSH_OPTIONS root@HOST -- /bin/bash -c '
set -eu
printf "section=identity\n"
/usr/bin/date -u +%FT%TZ
/bin/hostname
/usr/bin/uname -srmo
/usr/bin/cat /proc/sys/kernel/random/boot_id
printf "section=resources\n"
/usr/bin/free -m
/bin/df -B1 / /var/lib
/usr/bin/uptime
printf "section=addresses\n"
/usr/sbin/ip -brief address show
/usr/sbin/ip route show
printf "section=listeners\n"
/usr/bin/ss -H -lntup
printf "section=friday-units\n"
/usr/bin/systemctl show --no-pager -p Id -p LoadState -p UnitFileState -p ActiveState -p SubState -p NRestarts -p MainPID -p MemoryCurrent \
  plebeian-friday-fips.service plebeian-friday-validator.service \
  plebeian-friday-signer.service plebeian-friday-mint.service \
  plebeian-friday-coordinator.service plebeian-friday-authority.service \
  plebeian-friday-site.service
printf "section=wednesday-units\n"
/usr/bin/systemctl show --no-pager -p Id -p LoadState -p UnitFileState -p ActiveState -p SubState -p NRestarts -p MainPID -p MemoryCurrent \
  plebeian-poc-validator@1.service plebeian-poc-validator@2.service \
  plebeian-poc-validator@3.service plebeian-poc-validator@4.service \
  plebeian-poc-mint.service plebeian-poc-coordinator.service \
  plebeian-poc-site.service nginx.service
printf "section=failed-units\n"
/usr/bin/systemctl --failed --no-legend --no-pager || true
printf "section=friday-path-metadata\n"
for p in /opt/plebeian-auctions-friday /etc/plebeian-auctions-friday \
  /var/lib/plebeian-auctions-friday /var/lib/plebeian-auctions-friday-anchor; do
  if /usr/bin/test -e "$p"; then /usr/bin/stat -c "%F %a %U:%G %n" "$p"; else printf "absent %s\n" "$p"; fi
done
printf "section=host-firewall\n"
/usr/sbin/nft list ruleset
'
```

Replace `SSH_OPTIONS` textually with the fixed options above and `HOST` with
one address. Do not wrap this in a loop that obscures which host failed. The
command reads metadata, resource state, listeners and firewall rules; it does
not read environments, private keys, bearer proofs, database contents or
configuration payloads.

Provider Cloud Firewall attachment/rules are not visible from the host. The
owner must separately supply current Cloud Manager read-only screenshots or an
already-authenticated read-only provider API result. No provider credential is
available in this task.

## Current access result

At 2026-10-23 06:49 UTC, the socket still existed but `ssh-add -l` returned
`Operation not permitted`; a single bounded strict-host-key V1 attempt reached
the server and returned `Permission denied (publickey)`. No command executed
remotely. This is a known clean denial, not an uncertain operation. It means a
fresh owner unlock is required; it does not prove that the server stopped
trusting the public key.

Public read-only checks at 2026-10-23 06:52 UTC did succeed: normal TLS
validation returned HTTP 200 from `https://172.105.64.142/`, and the public
validator endpoint reported all four Wednesday validators online at height
181356 with identical block/app hashes and four canonical commit signatures.
No Friday readiness is inferred from that fallback health.
