# Friday FIPS R5 literal staging and single-run recipe

Status: **INDEPENDENTLY REVIEWED FOR PRESENTATION; PENDING FRESH OWNER ACTION-TIME APPROVAL; NOT EXECUTED**.

This packet is restricted to `DESKTOP-P59VRK7`. Run each command separately,
in order. Stop on any mismatch, non-empty `find` output, denial, interruption
or uncertain outcome. This is a single-use packet: no retry is included.

## Action A — create the new immutable R5 staging tree

```text
/usr/bin/test ! -e /var/lib/plebeian-friday-fips-r5-reviewed

/usr/bin/install -d -o root -g root -m 0700 /var/lib/plebeian-friday-fips-r5-reviewed /var/lib/plebeian-friday-fips-r5-reviewed/scripts /var/lib/plebeian-friday-fips-r5-reviewed/lab-bin /var/lib/plebeian-friday-fips-r5-reviewed/evidence /var/lib/plebeian-friday-fips-r5-reviewed/.venv /var/lib/plebeian-friday-fips-r5-reviewed/.venv/lib /var/lib/plebeian-friday-fips-r5-reviewed/.venv/lib/python3.12

/usr/bin/cp --archive --no-preserve=ownership -- /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/.venv/lib/python3.12/site-packages /var/lib/plebeian-friday-fips-r5-reviewed/.venv/lib/python3.12/site-packages

/usr/bin/chown -R root:root /var/lib/plebeian-friday-fips-r5-reviewed

/usr/bin/install -o root -g root -m 0700 /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/scripts/friday-fips-lab-r5.py /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/scripts/friday-fips-lab-r3.py /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/scripts/friday-fips-lab-r2.py /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/scripts/friday-fips-lab.py /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/scripts/friday-fips-capture.py /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/scripts/friday-fips-mint-bootstrap.py /var/lib/plebeian-friday-fips-r5-reviewed/scripts/

/usr/bin/install -o root -g root -m 0700 /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/lab-bin/plebeian-auctions-poc /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/lab-bin/plebeian-friday-frost-dkg-r4 /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/lab-bin/plebeian-friday-signer /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/lab-bin/plebeian-friday-integrated-driver /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/lab-bin/plebeian-friday-terminal-driver-r4 /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/lab-bin/coco-demo-frost-participant-3of4 /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/lab-bin/coco-demo-frost-public-inspect /var/lib/plebeian-friday-fips-r5-reviewed/lab-bin/

/usr/bin/install -o root -g root -m 0600 /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/FIPS-LOCAL-LAB-R5-EXECUTION.json /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/FIPS-LOCAL-LAB-R5-BUILD-RECEIPT.json /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc/FIPS-LOCAL-LAB-R5-ACTION-SCOPE.md /var/lib/plebeian-friday-fips-r5-reviewed/

/usr/bin/find /var/lib/plebeian-friday-fips-r5-reviewed \( -type l -o -type b -o -type c -o -type p -o -type s \) -print

/usr/bin/find /var/lib/plebeian-friday-fips-r5-reviewed \( ! -user root -o ! -group root -o -perm /022 \) -print

/usr/bin/sha256sum /var/lib/plebeian-friday-fips-r5-reviewed/FIPS-LOCAL-LAB-R5-EXECUTION.json /var/lib/plebeian-friday-fips-r5-reviewed/FIPS-LOCAL-LAB-R5-BUILD-RECEIPT.json /var/lib/plebeian-friday-fips-r5-reviewed/FIPS-LOCAL-LAB-R5-ACTION-SCOPE.md /var/lib/plebeian-friday-fips-r5-reviewed/scripts/friday-fips-lab-r5.py /var/lib/plebeian-friday-fips-r5-reviewed/scripts/friday-fips-lab-r3.py /var/lib/plebeian-friday-fips-r5-reviewed/scripts/friday-fips-lab-r2.py /var/lib/plebeian-friday-fips-r5-reviewed/scripts/friday-fips-lab.py /var/lib/plebeian-friday-fips-r5-reviewed/scripts/friday-fips-capture.py /var/lib/plebeian-friday-fips-r5-reviewed/scripts/friday-fips-mint-bootstrap.py /var/lib/plebeian-friday-fips-r5-reviewed/lab-bin/plebeian-auctions-poc /var/lib/plebeian-friday-fips-r5-reviewed/lab-bin/plebeian-friday-frost-dkg-r4 /var/lib/plebeian-friday-fips-r5-reviewed/lab-bin/plebeian-friday-signer /var/lib/plebeian-friday-fips-r5-reviewed/lab-bin/plebeian-friday-integrated-driver /var/lib/plebeian-friday-fips-r5-reviewed/lab-bin/plebeian-friday-terminal-driver-r4 /var/lib/plebeian-friday-fips-r5-reviewed/lab-bin/coco-demo-frost-participant-3of4 /var/lib/plebeian-friday-fips-r5-reviewed/lab-bin/coco-demo-frost-public-inspect

/usr/bin/find /var/lib/plebeian-friday-fips-r5-reviewed -type d -exec /usr/bin/chmod 0755 '{}' +

/usr/bin/chmod 0700 /var/lib/plebeian-friday-fips-r5-reviewed/evidence

/usr/bin/find /var/lib/plebeian-friday-fips-r5-reviewed/.venv/lib/python3.12/site-packages -type f -exec /usr/bin/chmod 0644 '{}' +

/usr/bin/chmod 0755 /var/lib/plebeian-friday-fips-r5-reviewed/scripts/friday-fips-lab-r5.py /var/lib/plebeian-friday-fips-r5-reviewed/scripts/friday-fips-lab-r3.py /var/lib/plebeian-friday-fips-r5-reviewed/scripts/friday-fips-lab-r2.py /var/lib/plebeian-friday-fips-r5-reviewed/scripts/friday-fips-lab.py /var/lib/plebeian-friday-fips-r5-reviewed/scripts/friday-fips-capture.py /var/lib/plebeian-friday-fips-r5-reviewed/scripts/friday-fips-mint-bootstrap.py /var/lib/plebeian-friday-fips-r5-reviewed/lab-bin/plebeian-auctions-poc /var/lib/plebeian-friday-fips-r5-reviewed/lab-bin/plebeian-friday-frost-dkg-r4 /var/lib/plebeian-friday-fips-r5-reviewed/lab-bin/plebeian-friday-signer /var/lib/plebeian-friday-fips-r5-reviewed/lab-bin/plebeian-friday-integrated-driver /var/lib/plebeian-friday-fips-r5-reviewed/lab-bin/plebeian-friday-terminal-driver-r4 /var/lib/plebeian-friday-fips-r5-reviewed/lab-bin/coco-demo-frost-participant-3of4 /var/lib/plebeian-friday-fips-r5-reviewed/lab-bin/coco-demo-frost-public-inspect

/usr/bin/chmod 0644 /var/lib/plebeian-friday-fips-r5-reviewed/FIPS-LOCAL-LAB-R5-EXECUTION.json /var/lib/plebeian-friday-fips-r5-reviewed/FIPS-LOCAL-LAB-R5-BUILD-RECEIPT.json /var/lib/plebeian-friday-fips-r5-reviewed/FIPS-LOCAL-LAB-R5-ACTION-SCOPE.md
```

The manifest SHA-256 must be
`f62349be0b339d3f0638608864ca1cc021db3c142788d69f0bbe8903c8cdf5b2`
and the controller SHA-256 must be
`4534e85e5357915892e782212a688b1428473d3dad0c76c68a05437a70379dc7`.
The build receipt SHA-256 must be
`8f2df1f40eced50b901d9077733f2324c769f40c1b11579344f040f1f27f120f`.
Every other hash must match `FIPS-LOCAL-LAB-R5-EXECUTION.json`. The complete
Nutshell tree digest must remain
`5390903ab5cd9b13c2d1476b0e1aa5c28187ca85376b60d3bd02626aba3af64d`.
R5 raises only the dropped child's UID-global `RLIMIT_NPROC` from 128 to 512;
all capabilities, no-new-privileges, file-size, descriptor, process-identity,
timeout and cleanup restrictions remain. This is a reviewed diagnostic change
for the pre-first-phase SIGILL, not a claim that the cause has been proven.

## Action B — one reviewed run

Only after a fresh owner approval for this exact reviewed R5 packet:

```text
/usr/bin/timeout --signal=TERM --kill-after=60s 4800s /usr/bin/python3.12 -I -S -B /var/lib/plebeian-friday-fips-r5-reviewed/scripts/friday-fips-lab-r5.py --manifest /var/lib/plebeian-friday-fips-r5-reviewed/FIPS-LOCAL-LAB-R5-EXECUTION.json --expected-manifest-sha256 f62349be0b339d3f0638608864ca1cc021db3c142788d69f0bbe8903c8cdf5b2 --expected-harness-sha256 4534e85e5357915892e782212a688b1428473d3dad0c76c68a05437a70379dc7
```

The controller’s own reviewed work bound is 4,200 seconds; 4,800 seconds is
the outer TERM fail-safe and leaves a reviewed 600-second cleanup window. It creates disposable fake-money identities under
the positively identified R5 run root. Normal cleanup removes only recorded
R5 objects whose identities still match. The unrelated host `fips0`, R2/R3
staging/evidence, DKG-diagnostic staging/evidence and Wednesday deployment are
never cleanup targets. `SIGKILL`, host death, an identity mismatch, or a
surviving process group requires inspection and separate cleanup approval.

This packet covers cooperative outbid return, winner payout and reserve-unmet
return. Emergency unilateral refund authority is explicitly not composed and
is not claimed by a successful R5 run.
