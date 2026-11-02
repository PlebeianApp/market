# Friday FIPS R2 literal staging and one-run recipe

Status: **READY TO REQUEST ACTION-TIME OWNER APPROVAL; NOT EXECUTED**.

This recipe is limited to host `DESKTOP-P59VRK7`. It stages the exact reviewed
fake-money lab bytes under one new root-owned directory, then permits one
bounded namespace run. It does not authorize a VPS, production, firewall,
DNS, SSH, package, systemd, real-money or persistent-access change.

Final technical pins:

- application/controller source: `96c81d8e23602fc9126e63cc6e05ce1f87a56ebc`;
- packet accepted for approval presentation: `94479dd03c93b474dc27929b7fe7491b02ebbd49`;
- approval-ready manifest SHA-256:
  `7ee10df04083c860a2c168190444765da2470c9c7bb9dd95101fe4746a9afc09`;
- controller SHA-256:
  `ed90e2ae32148f20007694bd1f9a13de090d80142b6ead9ac19c8fce7bb57468`;
- complete Nutshell 0.19.2 site-packages canonical SHA-256:
  `5390903ab5cd9b13c2d1476b0e1aa5c28187ca85376b60d3bd02626aba3af64d`.

## Privileged action A: immutable staging

The commands below are the complete proposed root staging sequence. They must
run one at a time, in order, with the default environment ignored. If any
command fails or either `find` inspection prints a path, stop before the lab
invocation. There is no wildcard, download, package manager or user-writable
executable in this sequence.

```text
/usr/bin/test ! -e /var/lib/plebeian-friday-fips-r2-reviewed

/usr/bin/install -d -o root -g root -m 0700 /var/lib/plebeian-friday-fips-r2-reviewed /var/lib/plebeian-friday-fips-r2-reviewed/scripts /var/lib/plebeian-friday-fips-r2-reviewed/lab-bin /var/lib/plebeian-friday-fips-r2-reviewed/.venv /var/lib/plebeian-friday-fips-r2-reviewed/.venv/lib /var/lib/plebeian-friday-fips-r2-reviewed/.venv/lib/python3.12

/usr/bin/cp --archive --no-preserve=ownership -- /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/.venv/lib/python3.12/site-packages /var/lib/plebeian-friday-fips-r2-reviewed/.venv/lib/python3.12/site-packages

/usr/bin/chown -R root:root /var/lib/plebeian-friday-fips-r2-reviewed

/usr/bin/install -o root -g root -m 0700 /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/scripts/friday-fips-lab-r2.py /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/scripts/friday-fips-lab.py /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/scripts/friday-fips-capture.py /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/scripts/friday-fips-mint-bootstrap.py /var/lib/plebeian-friday-fips-r2-reviewed/scripts/

/usr/bin/install -o root -g root -m 0700 /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/lab-bin/plebeian-auctions-poc /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/lab-bin/plebeian-friday-frost-dkg /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/lab-bin/plebeian-friday-signer /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/lab-bin/plebeian-friday-integrated-driver /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/lab-bin/coco-demo-frost-participant-3of4 /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/lab-bin/coco-demo-frost-public-inspect /var/lib/plebeian-friday-fips-r2-reviewed/lab-bin/

/usr/bin/install -o root -g root -m 0600 /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/FIPS-LOCAL-LAB-R2-EXECUTION.json /var/lib/plebeian-friday-fips-r2-reviewed/FIPS-LOCAL-LAB-R2-EXECUTION.json

/usr/bin/find /var/lib/plebeian-friday-fips-r2-reviewed \( -type l -o -type b -o -type c -o -type p -o -type s \) -print

/usr/bin/find /var/lib/plebeian-friday-fips-r2-reviewed \( ! -user root -o ! -group root -o -perm /022 \) -print

/usr/bin/sha256sum /var/lib/plebeian-friday-fips-r2-reviewed/FIPS-LOCAL-LAB-R2-EXECUTION.json /var/lib/plebeian-friday-fips-r2-reviewed/scripts/friday-fips-lab-r2.py /var/lib/plebeian-friday-fips-r2-reviewed/scripts/friday-fips-lab.py /var/lib/plebeian-friday-fips-r2-reviewed/scripts/friday-fips-capture.py /var/lib/plebeian-friday-fips-r2-reviewed/scripts/friday-fips-mint-bootstrap.py /var/lib/plebeian-friday-fips-r2-reviewed/lab-bin/plebeian-auctions-poc /var/lib/plebeian-friday-fips-r2-reviewed/lab-bin/plebeian-friday-frost-dkg /var/lib/plebeian-friday-fips-r2-reviewed/lab-bin/plebeian-friday-signer /var/lib/plebeian-friday-fips-r2-reviewed/lab-bin/plebeian-friday-integrated-driver /var/lib/plebeian-friday-fips-r2-reviewed/lab-bin/coco-demo-frost-participant-3of4 /var/lib/plebeian-friday-fips-r2-reviewed/lab-bin/coco-demo-frost-public-inspect

/usr/bin/find /var/lib/plebeian-friday-fips-r2-reviewed -type d -exec /usr/bin/chmod 0755 '{}' +

/usr/bin/find /var/lib/plebeian-friday-fips-r2-reviewed/.venv/lib/python3.12/site-packages -type f -exec /usr/bin/chmod 0644 '{}' +

/usr/bin/chmod 0755 /var/lib/plebeian-friday-fips-r2-reviewed/scripts/friday-fips-lab-r2.py /var/lib/plebeian-friday-fips-r2-reviewed/scripts/friday-fips-lab.py /var/lib/plebeian-friday-fips-r2-reviewed/scripts/friday-fips-capture.py /var/lib/plebeian-friday-fips-r2-reviewed/scripts/friday-fips-mint-bootstrap.py /var/lib/plebeian-friday-fips-r2-reviewed/lab-bin/plebeian-auctions-poc /var/lib/plebeian-friday-fips-r2-reviewed/lab-bin/plebeian-friday-frost-dkg /var/lib/plebeian-friday-fips-r2-reviewed/lab-bin/plebeian-friday-signer /var/lib/plebeian-friday-fips-r2-reviewed/lab-bin/plebeian-friday-integrated-driver /var/lib/plebeian-friday-fips-r2-reviewed/lab-bin/coco-demo-frost-participant-3of4 /var/lib/plebeian-friday-fips-r2-reviewed/lab-bin/coco-demo-frost-public-inspect

/usr/bin/chmod 0644 /var/lib/plebeian-friday-fips-r2-reviewed/FIPS-LOCAL-LAB-R2-EXECUTION.json
```

The last hashes must exactly match the manifest and build receipt. The
staging tree remains root-only through those inspections and hash checks; its
final read/execute modes are opened only by the subsequent exact `chmod`
commands. The controller then independently verifies ownership, modes, every source/binary
hash, Nutshell distribution metadata and the canonical hash of all 6,410
dependency files before it creates any namespace or key.

The staging tree is persistent, contains no credentials at staging time and is
not silently deleted. A later removal would require its own explicit cleanup
authorization.

## Privileged action B: one bounded run

Only after action A succeeds, the proposed one-run invocation is:

```text
/usr/bin/python3.12 -I -S -B /var/lib/plebeian-friday-fips-r2-reviewed/scripts/friday-fips-lab-r2.py --manifest /var/lib/plebeian-friday-fips-r2-reviewed/FIPS-LOCAL-LAB-R2-EXECUTION.json --expected-manifest-sha256 7ee10df04083c860a2c168190444765da2470c9c7bb9dd95101fe4746a9afc09 --expected-harness-sha256 ed90e2ae32148f20007694bd1f9a13de090d80142b6ead9ac19c8fce7bb57468
```

This one invocation may create exactly five fixed local network namespaces,
one namespace-only bridge, four transient host veth peers moved immediately
into namespaces, namespace-local nftables, four ephemeral FIPS identities,
four throwaway Comet/FROST/signer identities and one fake-mint seed. It has no
route, forwarding, NAT, DNS or external egress and does not change the host
firewall. Application children drop to UID/GID 1000; only FIPS gets namespace
`CAP_NET_ADMIN` and capture gets namespace `CAP_NET_RAW`. The monotonic wall
limit is 1,800 seconds.

Normal and handled-error cleanup stops only recorded identities, removes only
the five fixed namespaces and the marked run root, checks exact host-veth and
listener absence and requires the host nftables hash to be unchanged. The
accepted controller now blocks SIGINT/SIGTERM across every synchronous
`Popen`-to-registration interval and performs cleanup from an outer `finally`.
A root Python startup uses `-I -S -B`, so inherited Python path/home settings,
site initialization and bytecode writes cannot precede the controller's own
trusted-copy and hash checks.
A SIGKILL or host death can still strand temporary objects; in that case no
retry is authorized until a new read-only inspection and explicit cleanup
approval.

The executable proof covers the cooperative outbid return only. Winner payout,
reserve-unmet return, emergency first-spend behavior and live VPS rollout are
not authorized or proven by this one-run request.
