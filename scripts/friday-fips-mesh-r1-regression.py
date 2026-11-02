#!/usr/bin/python3
"""Static checks for the public-only four-host FIPS mesh R1 packet."""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parent.parent
MESH = ROOT / "deploy/friday/fips-mesh-r1"

HOSTS = {
    1: ("172.105.64.142", "npub1tdcsm26d34sd7tlwmqypc2ctd8hjvpqzwaeechr688ah42mypg0sxga6nj"),
    2: ("172.105.95.57", "npub10jac6jktr07h90d4txuer4xpu9taxfq458c0yr0enqcg2l798fps0pzlty"),
    3: ("172.104.240.217", "npub1698v40hxh2y8denwrygl46m9m78ayf8p8277f4murx2u3gzqrjxqdytc6r"),
    4: ("172.104.253.247", "npub14k9gzekwy6gt3vewmazawspxf84fhz94mjmfpqwspyaq5fwa2axsa7s2uc"),
}
CONFIG_HASHES = {
    1: "3a6ad2b8d516d4626d84a77f897fd5af3d16976917e652524284147d3ef4b8af",
    2: "cdf221427637be9df22abbb4724ba42f36966f0165b89ab4658da961a6d4a483",
    3: "33a9693bfde2f705f6bb40d41014a0c46b9e538923b987ea5c7370d3f3ee0770",
    4: "4a40d565c5b71e33adeec3747ae899b39498de474ef516b413b115f7a1c6a370",
}
FIXED_HASHES = {
    "/opt/plebeian-auctions-friday/releases/fips-identity-20261023-r1/bin/fips":
        "7b26e81e2607483d46b716a330c88ee18c881e3adaefc0542909e6f2a9a287f2",
    "/opt/plebeian-auctions-friday/releases/fips-identity-20261023-r1/bin/fipsctl":
        "15df75d3d9942747c62f690b0f4f5d5a2f9df45c976a96f4799a9574b988fab3",
    "/opt/plebeian-auctions-friday/releases/fips-mesh-20261023-r1/scripts/verify-friday-fips-identity.py":
        "5753d4c95aa55ec91ecb1ac0be0b4729f65808cee59f59431fb9d5f327295808",
    "/etc/systemd/system/plebeian-friday.slice":
        "704133a7c0572d1bf8e2f73fc328773813605993170e9031f5c20af4d94018d6",
    "/etc/systemd/system/plebeian-friday-fips-mesh-r1.service":
        "15f18917bfe35e4d5b772e8eb591a96718a95990b73550f515c2ec3b938d1051",
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def check_config(slot: int) -> None:
    path = MESH / f"v{slot}-fips.yaml"
    assert sha256(path) == CONFIG_HASHES[slot]
    value = yaml.safe_load(path.read_text(encoding="utf-8"))
    assert set(value) == {"node", "tun", "dns", "transports", "peers"}
    assert value["node"] == {
        "identity": {"persistent": True},
        "control": {"socket_path": "/var/lib/plebeian-auctions-friday/fips/control.sock"},
        "rendezvous": {"nostr": {"enabled": False}, "lan": {"enabled": False}},
    }
    assert value["tun"] == {"enabled": True, "name": "fips0", "mtu": 1280}
    assert value["dns"] == {"enabled": False}
    local_ip, _ = HOSTS[slot]
    assert value["transports"] == {"udp": {
        "bind_addr": f"{local_ip}:32121",
        "advertise_on_nostr": False,
        "public": False,
        "accept_connections": True,
        "outbound_only": False,
    }}
    peers = value["peers"]
    assert len(peers) == 3
    assert [peer["alias"] for peer in peers] == [f"friday-v{peer_slot}" for peer_slot in HOSTS if peer_slot != slot]
    for peer, peer_slot in zip(peers, (candidate for candidate in HOSTS if candidate != slot), strict=True):
        peer_ip, peer_npub = HOSTS[peer_slot]
        assert peer == {
            "npub": peer_npub,
            "alias": f"friday-v{peer_slot}",
            "addresses": [{"transport": "udp", "addr": f"{peer_ip}:32121"}],
            "connect_policy": "auto_connect",
        }


def check_unit() -> None:
    path = MESH / "plebeian-friday-fips-mesh-r1.service"
    assert sha256(path) == FIXED_HASHES["/etc/systemd/system/plebeian-friday-fips-mesh-r1.service"]
    text = path.read_text(encoding="utf-8")
    assert re.search(r"(?m)^\[Install\]\s*$", text) is None
    assert "Restart=no" in text
    assert "Conflicts=plebeian-friday-fips.service" in text
    assert "CapabilityBoundingSet=CAP_NET_ADMIN" in text
    assert "AmbientCapabilities=CAP_NET_ADMIN" in text
    assert "ReadWritePaths=/var/lib/plebeian-auctions-friday/fips" in text
    assert "RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX AF_NETLINK" in text
    assert "--check /etc/plebeian-auctions-friday/fips-mesh-r1.sha256" in text
    assert "fipsctl keygen" not in text
    assert "/var/lib/plebeian-auctions-poc" not in text
    assert "/opt/plebeian-auctions-poc" not in text
    assert "/etc/plebeian-auctions-poc" not in text


def check_hash_manifest(slot: int) -> None:
    path = MESH / f"v{slot}-fips-mesh-r1.sha256"
    entries: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        match = re.fullmatch(r"([0-9a-f]{64})  (/\S+)", line)
        assert match is not None
        digest, target = match.groups()
        assert target not in entries
        entries[target] = digest
    expected = dict(FIXED_HASHES)
    expected["/var/lib/plebeian-auctions-friday/fips/identity/fips.yaml"] = CONFIG_HASHES[slot]
    assert entries == expected


def main() -> None:
    check_unit()
    for slot in HOSTS:
        check_config(slot)
        check_hash_manifest(slot)
    print("Friday FIPS mesh R1 static regression: PASS (4 configs, 4 manifests, 1 unit)")


if __name__ == "__main__":
    main()
