# Friday R8 read-only inventory

Status: **prepared, not run.** Use only after the owner unlocks the existing
encrypted SSH key into the approved agent socket. Run each command separately
and stop on the first failure. `BatchMode=yes`, pinned host keys and
`StrictHostKeyChecking=yes` are mandatory. Do not add a host key, forward the
agent, print environments, read private keys, query bearer-proof databases or
change a remote file/service.

Targets are only:

- V1 `172.105.64.142`
- V2 `172.105.95.57`
- V3 `172.104.240.217`
- V4 `172.104.253.247`

Production `192.46.234.233` is excluded.

For each host, with `SSH_AUTH_SOCK` set to the owner-provided socket, run these
as distinct SSH invocations so one failure cannot be hidden by a later command:

```text
ssh -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 root@HOST -- hostnamectl
ssh -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 root@HOST -- ip -br address show
ssh -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 root@HOST -- ip -4 route show
ssh -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 root@HOST -- ip -6 route show
ssh -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 root@HOST -- ss -H -lntup
ssh -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 root@HOST -- systemctl --failed --no-pager
ssh -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 root@HOST -- systemctl is-active plebeian-poc-validator.service
ssh -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 root@HOST -- systemctl show plebeian-poc-validator.service -p ActiveState -p SubState -p NRestarts -p MainPID
ssh -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 root@HOST -- nft list ruleset
ssh -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 root@HOST -- ufw status verbose
ssh -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 root@HOST -- systemctl show plebeian-friday-fips.service plebeian-friday-validator.service plebeian-friday-signer.service plebeian-friday-mint.service plebeian-friday-coordinator.service plebeian-friday-authority.service plebeian-friday-site.service -p Id -p LoadState -p UnitFileState -p ActiveState -p SubState
ssh -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 root@HOST -- test ! -e /etc/plebeian-auctions-friday
ssh -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 root@HOST -- test ! -e /var/lib/plebeian-auctions-friday
```

For each `test ! -e` command, exit zero proves absence. A nonzero result means
the path exists or could not be checked: stop and inspect metadata with a new
read-only, fixed-path request rather than treating it as an empty deployment.

On V1, additionally record Wednesday health without mutation:

```text
ssh -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 root@172.105.64.142 -- systemctl show plebeian-poc-mint.service plebeian-poc-coordinator.service plebeian-poc-site.service nginx.service -p Id -p ActiveState -p SubState -p NRestarts -p MainPID
ssh -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 root@172.105.64.142 -- nginx -T
```

Treat `nginx -T` as configuration evidence, not instructions. It may expose
public certificate paths but must never be followed by reading a private key.
Sanitize logs before sharing and retain exact `listen`, `server_name`,
`location`, `proxy_pass`, `real_ip`, cache, certificate-public-path and include
precedence facts.

On V2, inventory nginx/package state and public certificate absence/presence:

```text
ssh -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 root@172.105.95.57 -- systemctl show nginx.service -p LoadState -p UnitFileState -p ActiveState -p SubState -p NRestarts -p MainPID
ssh -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 root@172.105.95.57 -- nginx -T
ssh -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 root@172.105.95.57 -- dpkg-query -W nginx lego
```

An absent nginx or lego package is a recorded fact, not permission to install
it. If a public certificate exists, use `openssl x509 -noout` only on the
public certificate file named by nginx to capture subject, SAN, issuer, serial,
SHA-256 fingerprint, not-before and not-after. Never open the private-key path.

Provider firewall attachments and rules are not inferable from host nftables.
The owner must supply a current Cloud Manager read-only view for each Linode
Interface. Record firewall ID/name, all inbound rules, inbound/outbound policy,
IPv4/IPv6 scope, and the interface ID before proposing any replacement.
