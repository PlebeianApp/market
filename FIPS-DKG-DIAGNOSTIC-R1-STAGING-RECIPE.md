# FIPS DKG Diagnostic R1 staging recipe

Do not run this recipe without a fresh owner action-time approval for the exact reviewed packet. Run one command at a time. Stop on any mismatch or uncertain outcome; do not retry.

Repository source:

```bash
cd /home/maximoto/Documents/Codex/2026-10-20/task-2/plebeian-auctions-poc
```

Verify all local source artifacts before using sudo:

```bash
test "$(sha256sum lab-bin-dkg-diagnostic-r1/plebeian-friday-frost-dkg | awk '{print $1}')" = 58e2970313caa3d42e97fe26353ce62ab09b960cc9cacb677e09ad04d1860247
test "$(sha256sum lab-bin/coco-demo-frost-participant-3of4 | awk '{print $1}')" = 715aeb0c390c7f6dd1af26076caaf50afb8aace6cbbaa1ed605d69875bb38d8b
test "$(sha256sum lab-bin/coco-demo-frost-public-inspect | awk '{print $1}')" = ee880c7f376a8d8b2ba6b1dde6388f64b0de36c0857371f656ebabe055d18b0f
test "$(sha256sum scripts/friday-fips-dkg-diagnostic-r1.py | awk '{print $1}')" = c9a6712649ace9caf41a4ff20089668e0d64c311e14b1de122686911537eea60
test "$(sha256sum FIPS-DKG-DIAGNOSTIC-R1-EXECUTION.json | awk '{print $1}')" = 4c51744663de1030e90b01868c3d233fba14ef54d4263620ddbeca8a4dd1383c
test "$(sha256sum /usr/bin/timeout | awk '{print $1}')" = 12690a043dfd555a6c14ccc1564f5649c18f1762c0d6ff66729948130898ec52
```

Confirm every single-use destination is absent:

```bash
test ! -e /var/lib/plebeian-friday-fips-dkg-r1-reviewed && test ! -L /var/lib/plebeian-friday-fips-dkg-r1-reviewed
test ! -e /tmp/plebeian-friday-fips-lab.20261022-dkg-r1 && test ! -L /tmp/plebeian-friday-fips-lab.20261022-dkg-r1
```

Install only the five reviewed artifacts into a new root-owned staging tree:

```bash
sudo install -d -o root -g root -m 0755 /var/lib/plebeian-friday-fips-dkg-r1-reviewed
sudo install -d -o root -g root -m 0755 /var/lib/plebeian-friday-fips-dkg-r1-reviewed/scripts
sudo install -d -o root -g root -m 0755 /var/lib/plebeian-friday-fips-dkg-r1-reviewed/lab-bin
sudo install -d -o root -g root -m 0700 /var/lib/plebeian-friday-fips-dkg-r1-reviewed/evidence
sudo install -o root -g root -m 0755 scripts/friday-fips-dkg-diagnostic-r1.py /var/lib/plebeian-friday-fips-dkg-r1-reviewed/scripts/friday-fips-dkg-diagnostic-r1.py
sudo install -o root -g root -m 0644 FIPS-DKG-DIAGNOSTIC-R1-EXECUTION.json /var/lib/plebeian-friday-fips-dkg-r1-reviewed/FIPS-DKG-DIAGNOSTIC-R1-EXECUTION.json
sudo install -o root -g root -m 0755 lab-bin-dkg-diagnostic-r1/plebeian-friday-frost-dkg /var/lib/plebeian-friday-fips-dkg-r1-reviewed/lab-bin/plebeian-friday-frost-dkg
sudo install -o root -g root -m 0755 lab-bin/coco-demo-frost-participant-3of4 /var/lib/plebeian-friday-fips-dkg-r1-reviewed/lab-bin/coco-demo-frost-participant-3of4
sudo install -o root -g root -m 0755 lab-bin/coco-demo-frost-public-inspect /var/lib/plebeian-friday-fips-dkg-r1-reviewed/lab-bin/coco-demo-frost-public-inspect
```

Verify staged hashes and ownership. Any output difference stops the action:

```bash
sudo sha256sum /var/lib/plebeian-friday-fips-dkg-r1-reviewed/scripts/friday-fips-dkg-diagnostic-r1.py /var/lib/plebeian-friday-fips-dkg-r1-reviewed/FIPS-DKG-DIAGNOSTIC-R1-EXECUTION.json /var/lib/plebeian-friday-fips-dkg-r1-reviewed/lab-bin/plebeian-friday-frost-dkg /var/lib/plebeian-friday-fips-dkg-r1-reviewed/lab-bin/coco-demo-frost-participant-3of4 /var/lib/plebeian-friday-fips-dkg-r1-reviewed/lab-bin/coco-demo-frost-public-inspect
sudo stat -c '%a %U:%G %n' /var/lib/plebeian-friday-fips-dkg-r1-reviewed /var/lib/plebeian-friday-fips-dkg-r1-reviewed/scripts /var/lib/plebeian-friday-fips-dkg-r1-reviewed/lab-bin /var/lib/plebeian-friday-fips-dkg-r1-reviewed/evidence /var/lib/plebeian-friday-fips-dkg-r1-reviewed/scripts/friday-fips-dkg-diagnostic-r1.py /var/lib/plebeian-friday-fips-dkg-r1-reviewed/FIPS-DKG-DIAGNOSTIC-R1-EXECUTION.json /var/lib/plebeian-friday-fips-dkg-r1-reviewed/lab-bin/plebeian-friday-frost-dkg /var/lib/plebeian-friday-fips-dkg-r1-reviewed/lab-bin/coco-demo-frost-participant-3of4 /var/lib/plebeian-friday-fips-dkg-r1-reviewed/lab-bin/coco-demo-frost-public-inspect
```

After a second explicit confirmation that staging matches the reviewed packet, the only approved invocation would be:

```bash
cd /home/maximoto
sudo -- /usr/bin/timeout --signal=TERM --kill-after=60s 300s /usr/bin/python3.12 -I -S -B /var/lib/plebeian-friday-fips-dkg-r1-reviewed/scripts/friday-fips-dkg-diagnostic-r1.py --manifest /var/lib/plebeian-friday-fips-dkg-r1-reviewed/FIPS-DKG-DIAGNOSTIC-R1-EXECUTION.json --expected-manifest-sha256 4c51744663de1030e90b01868c3d233fba14ef54d4263620ddbeca8a4dd1383c --expected-controller-sha256 c9a6712649ace9caf41a4ff20089668e0d64c311e14b1de122686911537eea60
```

Normal execution deletes only the exact identity-bound temporary run root. The root-owned staging tree and its sanitized `evidence/outcome.json` remain. `SIGINT` and `SIGTERM` enter guarded cleanup; an abrupt shutdown or `SIGKILL`, an identity mismatch, a surviving process group, or an uncertain outcome requires inspection and separate cleanup approval.
