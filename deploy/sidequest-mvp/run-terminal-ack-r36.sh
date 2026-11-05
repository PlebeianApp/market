#!/bin/sh
set -eu

stage=/var/tmp/plebeian-r36-stage-3ee34d9
release=/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4-terminal-ack-r36
authority_unit=/etc/systemd/system/plebeian-friday-authority.service
coordinator_unit=/etc/systemd/system/plebeian-friday-coordinator.service

test "$(systemctl show -p MainPID --value plebeian-friday-authority.service)" = 0
test "$(systemctl show -p MainPID --value plebeian-friday-coordinator.service)" = 0
test "$(sha256sum "$stage/plebeian-friday-authority" | cut -d ' ' -f 1)" = 0369e443008ee4527e186a3690c2e1d1c90d5263105eecb94d75bf19b009c5df
test "$(sha256sum "$stage/plebeian-friday-coordinator" | cut -d ' ' -f 1)" = 34a91af63d4a86701daf2fdafaf5279c684c7c37c77cdf94523b307b68a80fb4
test "$(sha256sum "$stage/plebeian-friday-terminal-executor" | cut -d ' ' -f 1)" = 4598dac4336348878db61d8f4ea8f5e8e57b459ac2563fea0b5a2005ef46f222
test "$(sha256sum "$stage/verify-sidequest-terminal-ack-r36.py" | cut -d ' ' -f 1)" = 6139bc6c533d268d7d19cabec85e6c697a0029a1c9cc8568d6328732a654a314
test "$(sha256sum "$stage/plebeian-friday-authority-r36.service" | cut -d ' ' -f 1)" = 5a20f0b6f6a65cf5608049498a7a1178255846c15aaaaaa6940ee6805515cc1e
test "$(sha256sum "$stage/plebeian-friday-coordinator-r36.service" | cut -d ' ' -f 1)" = dd791057ebe54aa9137ee5a80bfaec3316c7b209d50d3df7b7c08b79b241d21d
test "$(sha256sum "$authority_unit" | cut -d ' ' -f 1)" = 79bf6f0618b770708facc9597f0bbcac8a56fa2b0f534c7560c9e590d2d7ed53
test "$(sha256sum "$coordinator_unit" | cut -d ' ' -f 1)" = db0dfb92a5fe56656c2bab904a9e9f65cca33205e05faa92a4b6a8da43e1c7f0
test ! -e "$release"
test ! -e "$authority_unit.pre-r36-3ee34d9"
test ! -e "$coordinator_unit.pre-r36-3ee34d9"
echo R36_PRECHECK=PASS

install -d -o root -g root -m 0755 "$release/bin"
install -o root -g root -m 0755 "$stage/plebeian-friday-authority" "$release/bin/plebeian-friday-authority"
install -o root -g root -m 0755 "$stage/plebeian-friday-coordinator" "$release/bin/plebeian-friday-coordinator"
install -o root -g root -m 0755 "$stage/plebeian-friday-terminal-executor" "$release/bin/plebeian-friday-terminal-executor"
install -o root -g root -m 0755 "$stage/verify-sidequest-terminal-ack-r36.py" "$release/bin/verify-friday-separated-target.py"
install -o root -g root -m 0644 "$authority_unit" "$authority_unit.pre-r36-3ee34d9"
install -o root -g root -m 0644 "$coordinator_unit" "$coordinator_unit.pre-r36-3ee34d9"
install -o root -g root -m 0644 "$stage/plebeian-friday-authority-r36.service" "$authority_unit"
install -o root -g root -m 0644 "$stage/plebeian-friday-coordinator-r36.service" "$coordinator_unit"
systemctl daemon-reload
echo R36_INSTALL=PASS

cd /var/lib/plebeian-auctions-friday/coordinator-v3/runtime
. /etc/plebeian-auctions-friday/friday.env
test -f "$FRIDAY_APPLICATION"
runuser -u plebeian-friday -- /usr/bin/python3 -I -S -B "$release/bin/verify-friday-separated-target.py" \
  --environment /etc/plebeian-auctions-friday/friday.env \
  --application "$FRIDAY_APPLICATION" \
  --service plebeian-friday-coordinator.service
runuser -u plebeian-friday -- /usr/bin/python3 -I -S -B "$release/bin/verify-friday-separated-target.py" \
  --environment /etc/plebeian-auctions-friday/friday.env \
  --application "$FRIDAY_APPLICATION" \
  --service plebeian-friday-authority.service
echo R36_VERIFY=PASS

systemctl reset-failed plebeian-friday-coordinator.service plebeian-friday-authority.service
systemctl start plebeian-friday-coordinator.service
systemctl start plebeian-friday-authority.service
sleep 4
test "$(systemctl is-active plebeian-friday-coordinator.service)" = active
test "$(systemctl is-active plebeian-friday-authority.service)" = active
test "$(systemctl show -p NRestarts --value plebeian-friday-coordinator.service)" = 0
test "$(systemctl show -p NRestarts --value plebeian-friday-authority.service)" = 0
echo R36_START=PASS
systemctl show -p ActiveState -p NRestarts -p ExecMainStatus -p MainPID \
  plebeian-friday-coordinator.service plebeian-friday-authority.service
