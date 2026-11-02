# Friday FIPS R4 literal staging and single-run recipe

Status: **PENDING INDEPENDENT REVIEW AND FRESH OWNER ACTION-TIME APPROVAL; NOT EXECUTED**.

This packet is restricted to `DESKTOP-P59VRK7`. Run each command separately,
in order. Stop on any mismatch, non-empty `find` output, denial, interruption
or uncertain outcome. This is a single-use packet: no retry is included.

## Action A — create the new immutable R4 staging tree

```text
/usr/bin/test ! -e /var/lib/plebeian-friday-fips-r4-reviewed

/usr/bin/install -d -o root -g root -m 0700 /var/lib/plebeian-friday-fips-r4-reviewed /var/lib/plebeian-friday-fips-r4-reviewed/scripts /var/lib/plebeian-friday-fips-r4-reviewed/lab-bin /var/lib/plebeian-friday-fips-r4-reviewed/.venv /var/lib/plebeian-friday-fips-r4-reviewed/.venv/lib /var/lib/plebeian-friday-fips-r4-reviewed/.venv/lib/python3.12

/usr/bin/cp --archive --no-preserve=ownership -- /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/.venv/lib/python3.12/site-packages /var/lib/plebeian-friday-fips-r4-reviewed/.venv/lib/python3.12/site-packages

/usr/bin/chown -R root:root /var/lib/plebeian-friday-fips-r4-reviewed

/usr/bin/install -o root -g root -m 0700 /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/scripts/friday-fips-lab-r4.py /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/scripts/friday-fips-lab-r3.py /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/scripts/friday-fips-lab-r2.py /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/scripts/friday-fips-lab.py /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/scripts/friday-fips-capture.py /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/scripts/friday-fips-mint-bootstrap.py /var/lib/plebeian-friday-fips-r4-reviewed/scripts/

/usr/bin/install -o root -g root -m 0700 /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/lab-bin/plebeian-auctions-poc /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/lab-bin/plebeian-friday-frost-dkg-r4 /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/lab-bin/plebeian-friday-signer /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/lab-bin/plebeian-friday-integrated-driver /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/lab-bin/plebeian-friday-terminal-driver-r4 /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/lab-bin/coco-demo-frost-participant-3of4 /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/lab-bin/coco-demo-frost-public-inspect /var/lib/plebeian-friday-fips-r4-reviewed/lab-bin/

/usr/bin/install -o root -g root -m 0600 /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/FIPS-LOCAL-LAB-R4-EXECUTION.json /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/FIPS-LOCAL-LAB-R4-BUILD-RECEIPT.json /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/FIPS-LOCAL-LAB-R4-ACTION-SCOPE.md /var/lib/plebeian-friday-fips-r4-reviewed/

/usr/bin/find /var/lib/plebeian-friday-fips-r4-reviewed \( -type l -o -type b -o -type c -o -type p -o -type s \) -print

/usr/bin/find /var/lib/plebeian-friday-fips-r4-reviewed \( ! -user root -o ! -group root -o -perm /022 \) -print

/usr/bin/sha256sum /var/lib/plebeian-friday-fips-r4-reviewed/FIPS-LOCAL-LAB-R4-EXECUTION.json /var/lib/plebeian-friday-fips-r4-reviewed/FIPS-LOCAL-LAB-R4-BUILD-RECEIPT.json /var/lib/plebeian-friday-fips-r4-reviewed/FIPS-LOCAL-LAB-R4-ACTION-SCOPE.md /var/lib/plebeian-friday-fips-r4-reviewed/scripts/friday-fips-lab-r4.py /var/lib/plebeian-friday-fips-r4-reviewed/scripts/friday-fips-lab-r3.py /var/lib/plebeian-friday-fips-r4-reviewed/scripts/friday-fips-lab-r2.py /var/lib/plebeian-friday-fips-r4-reviewed/scripts/friday-fips-lab.py /var/lib/plebeian-friday-fips-r4-reviewed/scripts/friday-fips-capture.py /var/lib/plebeian-friday-fips-r4-reviewed/scripts/friday-fips-mint-bootstrap.py /var/lib/plebeian-friday-fips-r4-reviewed/lab-bin/plebeian-auctions-poc /var/lib/plebeian-friday-fips-r4-reviewed/lab-bin/plebeian-friday-frost-dkg-r4 /var/lib/plebeian-friday-fips-r4-reviewed/lab-bin/plebeian-friday-signer /var/lib/plebeian-friday-fips-r4-reviewed/lab-bin/plebeian-friday-integrated-driver /var/lib/plebeian-friday-fips-r4-reviewed/lab-bin/plebeian-friday-terminal-driver-r4 /var/lib/plebeian-friday-fips-r4-reviewed/lab-bin/coco-demo-frost-participant-3of4 /var/lib/plebeian-friday-fips-r4-reviewed/lab-bin/coco-demo-frost-public-inspect

/usr/bin/find /var/lib/plebeian-friday-fips-r4-reviewed -type d -exec /usr/bin/chmod 0755 '{}' +

/usr/bin/find /var/lib/plebeian-friday-fips-r4-reviewed/.venv/lib/python3.12/site-packages -type f -exec /usr/bin/chmod 0644 '{}' +

/usr/bin/chmod 0755 /var/lib/plebeian-friday-fips-r4-reviewed/scripts/friday-fips-lab-r4.py /var/lib/plebeian-friday-fips-r4-reviewed/scripts/friday-fips-lab-r3.py /var/lib/plebeian-friday-fips-r4-reviewed/scripts/friday-fips-lab-r2.py /var/lib/plebeian-friday-fips-r4-reviewed/scripts/friday-fips-lab.py /var/lib/plebeian-friday-fips-r4-reviewed/scripts/friday-fips-capture.py /var/lib/plebeian-friday-fips-r4-reviewed/scripts/friday-fips-mint-bootstrap.py /var/lib/plebeian-friday-fips-r4-reviewed/lab-bin/plebeian-auctions-poc /var/lib/plebeian-friday-fips-r4-reviewed/lab-bin/plebeian-friday-frost-dkg-r4 /var/lib/plebeian-friday-fips-r4-reviewed/lab-bin/plebeian-friday-signer /var/lib/plebeian-friday-fips-r4-reviewed/lab-bin/plebeian-friday-integrated-driver /var/lib/plebeian-friday-fips-r4-reviewed/lab-bin/plebeian-friday-terminal-driver-r4 /var/lib/plebeian-friday-fips-r4-reviewed/lab-bin/coco-demo-frost-participant-3of4 /var/lib/plebeian-friday-fips-r4-reviewed/lab-bin/coco-demo-frost-public-inspect

/usr/bin/chmod 0644 /var/lib/plebeian-friday-fips-r4-reviewed/FIPS-LOCAL-LAB-R4-EXECUTION.json /var/lib/plebeian-friday-fips-r4-reviewed/FIPS-LOCAL-LAB-R4-BUILD-RECEIPT.json /var/lib/plebeian-friday-fips-r4-reviewed/FIPS-LOCAL-LAB-R4-ACTION-SCOPE.md
```

The manifest SHA-256 must be
`2d28f2e0be8f4a8b7ef86092a5123fac367efdff107a801a64f2595266f05152`
and the controller SHA-256 must be
`77dbd1bb29e47f71eda570e4af0dc02f683cb093910385bae6e3def20f68f422`.
The build receipt SHA-256 must be
`4aa7d3410e467d187b6d624bdcb64b8695d75a5bf4b36fdee277ea3ca100b0c6`.
Every other hash must match `FIPS-LOCAL-LAB-R4-EXECUTION.json`. The complete
Nutshell tree digest must remain
`5390903ab5cd9b13c2d1476b0e1aa5c28187ca85376b60d3bd02626aba3af64d`.
R4 raises only the dropped child's UID-global `RLIMIT_NPROC` from 128 to 512;
all capabilities, no-new-privileges, file-size, descriptor, process-identity,
timeout and cleanup restrictions remain. This is a reviewed diagnostic change
for the pre-first-phase SIGILL, not a claim that the cause has been proven.

## Action B — one reviewed run

Only after a fresh owner approval for this exact reviewed R4 packet:

```text
/usr/bin/timeout --signal=TERM --kill-after=60s 4200s /usr/bin/python3.12 -I -S -B /var/lib/plebeian-friday-fips-r4-reviewed/scripts/friday-fips-lab-r4.py --manifest /var/lib/plebeian-friday-fips-r4-reviewed/FIPS-LOCAL-LAB-R4-EXECUTION.json --expected-manifest-sha256 2d28f2e0be8f4a8b7ef86092a5123fac367efdff107a801a64f2595266f05152 --expected-harness-sha256 77dbd1bb29e47f71eda570e4af0dc02f683cb093910385bae6e3def20f68f422
```

The controller’s own reviewed wall bound is 3,600 seconds; 4,200 seconds is
only the outer fail-safe. It creates disposable fake-money identities under
the positively identified R4 run root. Normal cleanup removes only recorded
R4 objects whose identities still match. The unrelated host `fips0`, R2/R3
staging/evidence, DKG-diagnostic staging/evidence and Wednesday deployment are
never cleanup targets. `SIGKILL`, host death, an identity mismatch, or a
surviving process group requires inspection and separate cleanup approval.

This packet covers cooperative outbid return, winner payout and reserve-unmet
return. Emergency unilateral refund authority is explicitly not composed and
is not claimed by a successful R4 run.
