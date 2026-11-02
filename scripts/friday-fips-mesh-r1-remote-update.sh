#!/bin/bash
set -euo pipefail

phase="${1:?phase}"
slot="${2:?slot}"
config_name="${3:?config name}"
manifest_name="${4:?manifest name}"
create_config_parent="${5:?create-config-parent flag}"
wednesday_pid="${6:?Wednesday PID}"

stage_dir="/tmp/plebeian-friday-fips-mesh-r1-corrected-v${slot}"
case "${slot}" in
  1) old_manifest=59c20107d0b884ab89fd77f5ce7befd90672847a70d40ef35c9f5edb2b13cc50; new_manifest=118bda4c289e934ffd09789fc4c28ff28002518d3adb41a56801c45a19b16ea6 ;;
  2) old_manifest=7374e8eac8dedeaf41a5f19240fed8a04f5d7121d316bee28fae0ef05716af5b; new_manifest=c01aa2a7690fba6267d29c7d1a2486961d3da14d9fd3c40fbe5c8a8d798d7bba ;;
  3) old_manifest=ec7c262e11bc2c4523c59aba1809f44e7aad47199e845107209b9ad541469c02; new_manifest=b1d3ff6a1363e0edd77fd7d6d0c1b4da5b25bf97fae3e42046c09758093479e9 ;;
  4) old_manifest=8a0ae6b180fe7467dcbb309bee32352f6e1911c5c5e08216394ac034ba0e213c; new_manifest=d7c7644d612b0ca1f7bf388af4102b688bf2ff4d911097fd7727ea5d90748d7b ;;
  *) exit 64 ;;
esac
test "${config_name}" = "v${slot}-fips.yaml"
test "${manifest_name}" = "v${slot}-fips-mesh-r1.sha256"
test -d "/proc/${wednesday_pid}"
if test "${phase}" = prepare; then
  test ! -e "${stage_dir}"
  install -d -o root -g root -m 0700 "${stage_dir}"
  echo "slot=${slot} corrected-unit-prepare=PASS"
  exit 0
fi
test "${phase}" = install
test "$(sha256sum /etc/systemd/system/plebeian-friday-fips-mesh-r1.service | cut -d' ' -f1)" = d6e080d453f8978811fd9cf0a1e352fb64084c9fde8dc50bf4cb0608b352d4fa
test "$(sha256sum /etc/plebeian-auctions-friday/fips-mesh-r1.sha256 | cut -d' ' -f1)" = "${old_manifest}"
test "$(sha256sum "${stage_dir}/plebeian-friday-fips-mesh-r1.service" | cut -d' ' -f1)" = 15f18917bfe35e4d5b772e8eb591a96718a95990b73550f515c2ec3b938d1051
test "$(sha256sum "${stage_dir}/${manifest_name}" | cut -d' ' -f1)" = "${new_manifest}"
test "$(systemctl show plebeian-friday-fips-mesh-r1.service -p ActiveState --value)" = failed
test "$(systemctl show plebeian-friday-fips-mesh-r1.service -p MainPID --value)" = 0
test ! -e /sys/class/net/fips0
test -z "$(ss -H -lun 'sport = :32121')"
install -o root -g root -m 0644 "${stage_dir}/plebeian-friday-fips-mesh-r1.service" /etc/systemd/system/plebeian-friday-fips-mesh-r1.service
install -o root -g plebeian-friday -m 0640 "${stage_dir}/${manifest_name}" /etc/plebeian-auctions-friday/fips-mesh-r1.sha256
systemctl daemon-reload
systemctl reset-failed plebeian-friday-fips-mesh-r1.service
runuser -u plebeian-friday -- sha256sum --strict --check /etc/plebeian-auctions-friday/fips-mesh-r1.sha256
test "$(systemctl is-active plebeian-friday-fips-mesh-r1.service 2>/dev/null || true)" = inactive
test "$(systemctl show plebeian-friday-fips-mesh-r1.service -p UnitFileState --value)" = static
rm -f "${stage_dir}/plebeian-friday-fips-mesh-r1.service" "${stage_dir}/${manifest_name}"
rmdir "${stage_dir}"
echo "slot=${slot} corrected-unit-update=PASS"
