# Friday FIPS R3 literal staging and one-run recipe

Status: **READY TO REQUEST ACTION-TIME OWNER APPROVAL; NOT EXECUTED**.

This recipe is restricted to `DESKTOP-P59VRK7`. Run each command separately,
in order. Stop on any failure, unexpected output from either `find`, hash
mismatch, permission denial or uncertain outcome. Do not retry a failed or
interrupted run without read-only inspection and new authorization.

## Privileged action A — new immutable R3 staging

```text
/usr/bin/test ! -e /var/lib/plebeian-friday-fips-r3-reviewed

/usr/bin/install -d -o root -g root -m 0700 /var/lib/plebeian-friday-fips-r3-reviewed /var/lib/plebeian-friday-fips-r3-reviewed/scripts /var/lib/plebeian-friday-fips-r3-reviewed/lab-bin /var/lib/plebeian-friday-fips-r3-reviewed/.venv /var/lib/plebeian-friday-fips-r3-reviewed/.venv/lib /var/lib/plebeian-friday-fips-r3-reviewed/.venv/lib/python3.12

/usr/bin/cp --archive --no-preserve=ownership -- /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/.venv/lib/python3.12/site-packages /var/lib/plebeian-friday-fips-r3-reviewed/.venv/lib/python3.12/site-packages

/usr/bin/chown -R root:root /var/lib/plebeian-friday-fips-r3-reviewed

/usr/bin/install -o root -g root -m 0700 /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/scripts/friday-fips-lab-r3.py /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/scripts/friday-fips-lab-r2.py /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/scripts/friday-fips-lab.py /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/scripts/friday-fips-capture.py /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/scripts/friday-fips-mint-bootstrap.py /var/lib/plebeian-friday-fips-r3-reviewed/scripts/

/usr/bin/install -o root -g root -m 0700 /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/lab-bin/plebeian-auctions-poc /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/lab-bin/plebeian-friday-frost-dkg /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/lab-bin/plebeian-friday-signer /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/lab-bin/plebeian-friday-integrated-driver /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/lab-bin/coco-demo-frost-participant-3of4 /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/lab-bin/coco-demo-frost-public-inspect /var/lib/plebeian-friday-fips-r3-reviewed/lab-bin/

/usr/bin/install -o root -g root -m 0600 /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/FIPS-LOCAL-LAB-R3-EXECUTION.json /var/lib/plebeian-friday-fips-r3-reviewed/FIPS-LOCAL-LAB-R3-EXECUTION.json

/usr/bin/find /var/lib/plebeian-friday-fips-r3-reviewed \( -type l -o -type b -o -type c -o -type p -o -type s \) -print

/usr/bin/find /var/lib/plebeian-friday-fips-r3-reviewed \( ! -user root -o ! -group root -o -perm /022 \) -print

/usr/bin/sha256sum /var/lib/plebeian-friday-fips-r3-reviewed/FIPS-LOCAL-LAB-R3-EXECUTION.json /var/lib/plebeian-friday-fips-r3-reviewed/scripts/friday-fips-lab-r3.py /var/lib/plebeian-friday-fips-r3-reviewed/scripts/friday-fips-lab-r2.py /var/lib/plebeian-friday-fips-r3-reviewed/scripts/friday-fips-lab.py /var/lib/plebeian-friday-fips-r3-reviewed/scripts/friday-fips-capture.py /var/lib/plebeian-friday-fips-r3-reviewed/scripts/friday-fips-mint-bootstrap.py /var/lib/plebeian-friday-fips-r3-reviewed/lab-bin/plebeian-auctions-poc /var/lib/plebeian-friday-fips-r3-reviewed/lab-bin/plebeian-friday-frost-dkg /var/lib/plebeian-friday-fips-r3-reviewed/lab-bin/plebeian-friday-signer /var/lib/plebeian-friday-fips-r3-reviewed/lab-bin/plebeian-friday-integrated-driver /var/lib/plebeian-friday-fips-r3-reviewed/lab-bin/coco-demo-frost-participant-3of4 /var/lib/plebeian-friday-fips-r3-reviewed/lab-bin/coco-demo-frost-public-inspect

/usr/bin/find /var/lib/plebeian-friday-fips-r3-reviewed -type d -exec /usr/bin/chmod 0755 '{}' +

/usr/bin/find /var/lib/plebeian-friday-fips-r3-reviewed/.venv/lib/python3.12/site-packages -type f -exec /usr/bin/chmod 0644 '{}' +

/usr/bin/chmod 0755 /var/lib/plebeian-friday-fips-r3-reviewed/scripts/friday-fips-lab-r3.py /var/lib/plebeian-friday-fips-r3-reviewed/scripts/friday-fips-lab-r2.py /var/lib/plebeian-friday-fips-r3-reviewed/scripts/friday-fips-lab.py /var/lib/plebeian-friday-fips-r3-reviewed/scripts/friday-fips-capture.py /var/lib/plebeian-friday-fips-r3-reviewed/scripts/friday-fips-mint-bootstrap.py /var/lib/plebeian-friday-fips-r3-reviewed/lab-bin/plebeian-auctions-poc /var/lib/plebeian-friday-fips-r3-reviewed/lab-bin/plebeian-friday-frost-dkg /var/lib/plebeian-friday-fips-r3-reviewed/lab-bin/plebeian-friday-signer /var/lib/plebeian-friday-fips-r3-reviewed/lab-bin/plebeian-friday-integrated-driver /var/lib/plebeian-friday-fips-r3-reviewed/lab-bin/coco-demo-frost-participant-3of4 /var/lib/plebeian-friday-fips-r3-reviewed/lab-bin/coco-demo-frost-public-inspect

/usr/bin/chmod 0644 /var/lib/plebeian-friday-fips-r3-reviewed/FIPS-LOCAL-LAB-R3-EXECUTION.json
```

The `sha256sum` output must match the execution manifest and build receipt.
The complete site-packages canonical digest must be
`5390903ab5cd9b13c2d1476b0e1aa5c28187ca85376b60d3bd02626aba3af64d`.
The controller rechecks root ownership/modes, symlink absence, source and
binary hashes, dependency metadata and all 6,410 dependency files before any
namespace or key creation.

## Privileged action B — one sanitized run

Only after action A succeeds, the exact proposed invocation is:

```text
/usr/bin/python3.12 -I -S -B /var/lib/plebeian-friday-fips-r3-reviewed/scripts/friday-fips-lab-r3.py --manifest /var/lib/plebeian-friday-fips-r3-reviewed/FIPS-LOCAL-LAB-R3-EXECUTION.json --expected-manifest-sha256 675e93a43a99f7a9f0d7423ff5743f258cdf8177dd9c14892870035f09257b31 --expected-harness-sha256 cc0c0b6b254a38d483b109bd072817be4685cf98d0de83dc338213f7af975dd3
```

The command uses an empty inherited Python import path (`-I -S`), performs no
network download and accepts no alternate topology, path, executable or
manifest. It may run once for at most 1,800 seconds. No retry is included.

Normal cleanup removes only positively recorded R3 objects whose identities
still match. The unrelated host `fips0` and preserved R2 staging/failure
evidence are never cleanup targets. The run requires no concurrent root or
`CAP_NET_ADMIN` network actor. SIGKILL or host death may leave objects and
requires a new read-only inspection and separate cleanup approval.
