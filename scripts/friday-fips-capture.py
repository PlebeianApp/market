#!/usr/bin/python3
"""Bounded AF_PACKET counter for the isolated Friday FIPS lab.

This helper never persists packet bytes.  It counts UDP/32121 underlay frames,
hashes their UDP payloads, and counts occurrences of two public test markers.
It is intended to run as uid/gid 1000 with only CAP_NET_RAW, inside one of the
four dedicated lab network namespaces.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import signal
import socket
import struct
import time
from pathlib import Path


INTERFACE = "under0"
PORT = 32121
# The helper is shared by the frozen R1 plan and the separately reviewed R2
# plan.  Accept only those two literal single-run roots; a caller cannot widen
# the capture destination with a run-id argument.
OUTPUT_RE = re.compile(
    r"^/tmp/plebeian-friday-fips-lab\.20261022-(?:r1|r2)/node-[1-4]/capture\.json$"
)
MARKER_RE = re.compile(r"^[0-9a-f]{2,512}$")
stop = False


def request_stop(_signum: int, _frame: object) -> None:
    global stop
    stop = True


def parse_udp_payload(frame: bytes) -> bytes | None:
    # Linux AF_PACKET on a veth supplies Ethernet II frames.
    if len(frame) < 14 or frame[12:14] != b"\x08\x00":
        return None
    packet = frame[14:]
    if len(packet) < 20 or packet[0] >> 4 != 4:
        return None
    header_len = (packet[0] & 0x0F) * 4
    if header_len < 20 or len(packet) < header_len + 8 or packet[9] != 17:
        return None
    udp = packet[header_len:]
    source_port, destination_port, length = struct.unpack("!HHH", udp[:6])
    if PORT not in (source_port, destination_port) or length < 8 or length > len(udp):
        return None
    return udp[8:length]


def main() -> int:
    parser = argparse.ArgumentParser(allow_abbrev=False)
    parser.add_argument("--output", required=True)
    parser.add_argument("--comet-marker-hex", required=True)
    parser.add_argument("--signer-marker-hex", required=True)
    arguments = parser.parse_args()
    if not OUTPUT_RE.fullmatch(arguments.output):
        raise SystemExit("capture output is outside the one approved run root")
    if not MARKER_RE.fullmatch(arguments.comet_marker_hex) or not MARKER_RE.fullmatch(arguments.signer_marker_hex):
        raise SystemExit("capture markers must be bounded lowercase hex")
    if os.getuid() == 0 or os.getgid() == 0:
        raise SystemExit("capture must not run as root")

    output = Path(arguments.output)
    if output.exists() or output.is_symlink() or output.parent.is_symlink():
        raise SystemExit("capture output must be a new regular file in the approved node directory")
    markers = (bytes.fromhex(arguments.comet_marker_hex), bytes.fromhex(arguments.signer_marker_hex))
    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)

    packets = 0
    payload_bytes = 0
    plaintext_matches = 0
    payload_digest = hashlib.sha256()
    started_ns = time.time_ns()
    packet_socket = socket.socket(socket.AF_PACKET, socket.SOCK_RAW, socket.htons(0x0800))
    packet_socket.bind((INTERFACE, 0))
    packet_socket.settimeout(0.25)
    try:
        while not stop:
            try:
                frame = packet_socket.recv(65_535)
            except TimeoutError:
                continue
            payload = parse_udp_payload(frame)
            if payload is None:
                continue
            packets += 1
            payload_bytes += len(payload)
            payload_digest.update(len(payload).to_bytes(4, "big"))
            payload_digest.update(payload)
            plaintext_matches += sum(payload.count(marker) for marker in markers)
    finally:
        packet_socket.close()

    record = {
        "schema": "PLEBEIAN_FIPS_UNDERLAY_CAPTURE_V1",
        "interface": INTERFACE,
        "udp_port": PORT,
        "started_ns": started_ns,
        "finished_ns": time.time_ns(),
        "packets": packets,
        "payload_bytes": payload_bytes,
        "payload_stream_sha256": payload_digest.hexdigest(),
        "plaintext_marker_matches": plaintext_matches,
        "raw_packets_persisted": False,
    }
    descriptor = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        os.write(descriptor, (json.dumps(record, sort_keys=True, separators=(",", ":")) + "\n").encode())
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
