#!/bin/bash
# Literal remote-side implementation for the reviewed Friday FIPS mesh R1 action.
# This file is sent on stdin to `/bin/bash -s --` by the local controller.

set -euo pipefail

phase="${1:?phase}"
slot="${2:?slot}"
config_name="${3:?config name}"
manifest_name="${4:?manifest name}"
create_config_parent="${5:?create-config-parent flag}"
wednesday_pid="${6:?Wednesday PID}"
target_npub="${7:-}"

case "${slot}" in
  1)
    local_ipv4=172.105.64.142
    local_ula=fd08:3b4:d506:649e:50ab:bcaf:4263:9cdf
    expected_config_hash=3a6ad2b8d516d4626d84a77f897fd5af3d16976917e652524284147d3ef4b8af
    expected_manifest_hash=59c20107d0b884ab89fd77f5ce7befd90672847a70d40ef35c9f5edb2b13cc50
    expected_create_parent=yes
    ;;
  2)
    local_ipv4=172.105.95.57
    local_ula=fd8d:74d8:4685:355:3df4:3595:f5cd:65c6
    expected_config_hash=cdf221427637be9df22abbb4724ba42f36966f0165b89ab4658da961a6d4a483
    expected_manifest_hash=7374e8eac8dedeaf41a5f19240fed8a04f5d7121d316bee28fae0ef05716af5b
    expected_create_parent=no
    ;;
  3)
    local_ipv4=172.104.240.217
    local_ula=fdbc:58a:eabf:3991:adee:607f:fbc7:9b10
    expected_config_hash=33a9693bfde2f705f6bb40d41014a0c46b9e538923b987ea5c7370d3f3ee0770
    expected_manifest_hash=ec7c262e11bc2c4523c59aba1809f44e7aad47199e845107209b9ad541469c02
    expected_create_parent=yes
    ;;
  4)
    local_ipv4=172.104.253.247
    local_ula=fd27:e968:2c52:42e4:50b9:4a2e:f665:aefe
    expected_config_hash=4a40d565c5b71e33adeec3747ae899b39498de474ef516b413b115f7a1c6a370
    expected_manifest_hash=8a0ae6b180fe7467dcbb309bee32352f6e1911c5c5e08216394ac034ba0e213c
    expected_create_parent=yes
    ;;
  *)
    echo "invalid slot" >&2
    exit 64
    ;;
esac

test "${config_name}" = "v${slot}-fips.yaml"
test "${manifest_name}" = "v${slot}-fips-mesh-r1.sha256"
test "${create_config_parent}" = "${expected_create_parent}"
case "${wednesday_pid}" in
  ''|*[!0-9]*) echo "invalid Wednesday PID" >&2; exit 64 ;;
esac

stage_dir="/tmp/plebeian-friday-fips-mesh-r1-stage-v${slot}"
release_dir=/opt/plebeian-auctions-friday/releases/fips-mesh-20261023-r1
control_socket=/var/lib/plebeian-auctions-friday/fips/control.sock
service=plebeian-friday-fips-mesh-r1.service

hash_is() {
  path="$1"
  expected="$2"
  actual="$(/usr/bin/sha256sum -- "${path}" | /usr/bin/cut -d' ' -f1)"
  test "${actual}" = "${expected}"
}

require_wednesday() {
  test -d "/proc/${wednesday_pid}"
}

case "${phase}" in
  prepare)
    require_wednesday
    for tool in \
      /bin/bash /usr/bin/awk /usr/bin/cut /usr/bin/grep /usr/bin/install \
      /usr/bin/python3 /usr/bin/rm /usr/bin/rmdir /usr/bin/sha256sum \
      /usr/bin/ss /usr/bin/stat /usr/bin/systemctl /usr/sbin/ip \
      /usr/sbin/runuser; do
      test -x "${tool}"
    done
    test ! -e "${stage_dir}"
    test ! -e /etc/systemd/system/plebeian-friday.slice
    test ! -e /etc/systemd/system/plebeian-friday-fips-mesh-r1.service
    test ! -e /etc/plebeian-auctions-friday/fips-mesh-r1.sha256
    test ! -e /var/lib/plebeian-auctions-friday/fips/identity/fips.yaml
    test ! -e "${release_dir}"
    test ! -e /sys/class/net/fips0
    test -z "$(/usr/bin/ss -H -lun 'sport = :32121')"
    if test "${create_config_parent}" = yes; then
      test ! -e /etc/plebeian-auctions-friday
    else
      test "$(/usr/bin/stat -c '%U:%G:%a:%F' /etc/plebeian-auctions-friday)" = \
        root:plebeian-friday:750:directory
    fi
    /usr/bin/install -d -o root -g root -m 0700 "${stage_dir}"
    echo "slot=${slot} phase=prepare result=PASS"
    ;;

  install)
    require_wednesday
    test "$(/usr/bin/stat -c '%U:%G:%a:%F' "${stage_dir}")" = root:root:700:directory
    hash_is "${stage_dir}/plebeian-friday.slice" \
      704133a7c0572d1bf8e2f73fc328773813605993170e9031f5c20af4d94018d6
    hash_is "${stage_dir}/plebeian-friday-fips-mesh-r1.service" \
      15f18917bfe35e4d5b772e8eb591a96718a95990b73550f515c2ec3b938d1051
    hash_is "${stage_dir}/verify-friday-fips-identity.py" \
      5753d4c95aa55ec91ecb1ac0be0b4729f65808cee59f59431fb9d5f327295808
    hash_is "${stage_dir}/${config_name}" "${expected_config_hash}"
    hash_is "${stage_dir}/${manifest_name}" "${expected_manifest_hash}"
    test ! -e /etc/systemd/system/plebeian-friday.slice
    test ! -e /etc/systemd/system/plebeian-friday-fips-mesh-r1.service
    test ! -e /etc/plebeian-auctions-friday/fips-mesh-r1.sha256
    test ! -e /var/lib/plebeian-auctions-friday/fips/identity/fips.yaml
    test ! -e "${release_dir}"
    if test "${create_config_parent}" = yes; then
      test ! -e /etc/plebeian-auctions-friday
      /usr/bin/install -d -o root -g plebeian-friday -m 0750 /etc/plebeian-auctions-friday
    else
      test "$(/usr/bin/stat -c '%U:%G:%a:%F' /etc/plebeian-auctions-friday)" = \
        root:plebeian-friday:750:directory
    fi
    /usr/bin/install -d -o root -g root -m 0755 "${release_dir}/scripts"
    /usr/bin/install -o root -g root -m 0644 \
      "${stage_dir}/plebeian-friday.slice" /etc/systemd/system/plebeian-friday.slice
    /usr/bin/install -o root -g root -m 0644 \
      "${stage_dir}/plebeian-friday-fips-mesh-r1.service" \
      /etc/systemd/system/plebeian-friday-fips-mesh-r1.service
    /usr/bin/install -o root -g root -m 0755 \
      "${stage_dir}/verify-friday-fips-identity.py" \
      "${release_dir}/scripts/verify-friday-fips-identity.py"
    /usr/bin/install -o plebeian-friday -g plebeian-friday -m 0600 \
      "${stage_dir}/${config_name}" \
      /var/lib/plebeian-auctions-friday/fips/identity/fips.yaml
    /usr/bin/install -o root -g plebeian-friday -m 0640 \
      "${stage_dir}/${manifest_name}" /etc/plebeian-auctions-friday/fips-mesh-r1.sha256
    /usr/bin/systemctl daemon-reload
    /usr/sbin/runuser -u plebeian-friday -- \
      /usr/bin/sha256sum --strict --check /etc/plebeian-auctions-friday/fips-mesh-r1.sha256
    /usr/sbin/runuser -u plebeian-friday -- \
      /usr/bin/python3 -I -S -B "${release_dir}/scripts/verify-friday-fips-identity.py" \
      --config /var/lib/plebeian-auctions-friday/fips/identity/fips.yaml \
      --key /var/lib/plebeian-auctions-friday/fips/identity/fips.key
    /usr/bin/systemctl show "${service}" \
      -p LoadState -p ActiveState -p UnitFileState -p FragmentPath -p Slice -p Restart
    /usr/bin/rm -f -- \
      "${stage_dir}/plebeian-friday.slice" \
      "${stage_dir}/plebeian-friday-fips-mesh-r1.service" \
      "${stage_dir}/verify-friday-fips-identity.py" \
      "${stage_dir}/${config_name}" \
      "${stage_dir}/${manifest_name}"
    /usr/bin/rmdir -- "${stage_dir}"
    echo "slot=${slot} phase=install result=PASS"
    ;;

  prestart)
    require_wednesday
    /usr/sbin/runuser -u plebeian-friday -- \
      /usr/bin/sha256sum --strict --check /etc/plebeian-auctions-friday/fips-mesh-r1.sha256
    /usr/sbin/runuser -u plebeian-friday -- \
      /usr/bin/python3 -I -S -B "${release_dir}/scripts/verify-friday-fips-identity.py" \
      --config /var/lib/plebeian-auctions-friday/fips/identity/fips.yaml \
      --key /var/lib/plebeian-auctions-friday/fips/identity/fips.key
    test "$(/usr/bin/systemctl is-active "${service}" 2>/dev/null || true)" = inactive
    test ! -e /sys/class/net/fips0
    test -z "$(/usr/bin/ss -H -lun 'sport = :32121')"
    /usr/bin/awk '/MemAvailable|SwapFree/ {print}' /proc/meminfo
    /usr/sbin/ip -4 route show default
    /usr/sbin/ip -6 route show default
    echo "slot=${slot} phase=prestart result=PASS"
    ;;

  start)
    require_wednesday
    /usr/bin/systemctl start "${service}"
    echo "slot=${slot} phase=start result=PASS"
    ;;

  inspect)
    require_wednesday
    test "$(/usr/bin/systemctl is-active "${service}")" = active
    test "$(/usr/bin/systemctl show "${service}" -p NRestarts --value)" = 0
    test "$(/usr/bin/systemctl show "${service}" -p MainPID --value)" != 0
    /usr/bin/ss -H -lunp 'sport = :32121' | /usr/bin/grep -F -- "${local_ipv4}:32121"
    /usr/sbin/ip link show dev fips0 | /usr/bin/grep -F -- 'mtu 1280'
    /usr/sbin/ip -6 address show dev fips0 | /usr/bin/grep -F -- "${local_ula}/128"
    /opt/plebeian-auctions-friday/releases/fips-identity-20261023-r1/bin/fipsctl \
      -s "${control_socket}" show status
    /opt/plebeian-auctions-friday/releases/fips-identity-20261023-r1/bin/fipsctl \
      -s "${control_socket}" show peers
    /opt/plebeian-auctions-friday/releases/fips-identity-20261023-r1/bin/fipsctl \
      -s "${control_socket}" show links
    /opt/plebeian-auctions-friday/releases/fips-identity-20261023-r1/bin/fipsctl \
      -s "${control_socket}" show transports
    /opt/plebeian-auctions-friday/releases/fips-identity-20261023-r1/bin/fipsctl \
      -s "${control_socket}" show routing
    /opt/plebeian-auctions-friday/releases/fips-identity-20261023-r1/bin/fipsctl \
      -s "${control_socket}" acl show
    /usr/sbin/ip -4 route show
    /usr/sbin/ip -6 route show
    echo "slot=${slot} phase=inspect result=PASS"
    ;;

  probe)
    require_wednesday
    case "${target_npub}" in
      npub1tdcsm26d34sd7tlwmqypc2ctd8hjvpqzwaeechr688ah42mypg0sxga6nj|\
      npub10jac6jktr07h90d4txuer4xpu9taxfq458c0yr0enqcg2l798fps0pzlty|\
      npub1698v40hxh2y8denwrygl46m9m78ayf8p8277f4murx2u3gzqrjxqdytc6r|\
      npub14k9gzekwy6gt3vewmazawspxf84fhz94mjmfpqwspyaq5fwa2axsa7s2uc) ;;
      *) echo "invalid target npub" >&2; exit 64 ;;
    esac
    /opt/plebeian-auctions-friday/releases/fips-identity-20261023-r1/bin/fipsctl \
      -s "${control_socket}" probe --json --timeout 10 "${target_npub}"
    ;;

  stop)
    /usr/bin/systemctl stop "${service}"
    echo "slot=${slot} phase=stop result=PASS"
    ;;

  postcheck)
    require_wednesday
    test "$(/usr/bin/systemctl is-active "${service}" 2>/dev/null || true)" = inactive
    test ! -e /sys/class/net/fips0
    test -z "$(/usr/bin/ss -H -lun 'sport = :32121')"
    test ! -e "${control_socket}"
    /usr/sbin/ip -4 route show
    /usr/sbin/ip -6 route show
    echo "slot=${slot} phase=postcheck result=PASS"
    ;;

  *)
    echo "invalid phase" >&2
    exit 64
    ;;
esac
