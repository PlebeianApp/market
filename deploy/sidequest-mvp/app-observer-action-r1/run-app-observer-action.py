#!/usr/bin/env python3
"""One-shot APP public-bundle stage and non-voting observer initialization.

Without the exact --approved-action-sha256 this performs local validation only.
The approved path makes one SSH invocation, preserves every partial result and
never starts, stops, enables or reloads a service.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys


HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
ACTION = HERE / "ACTION.json"
EXPECTED_ACTION_SHA256 = "43c85de722985d28e0b5920e0a7fcab5f80635430a47561cf4a9eecc361bed87"
AGENT = Path("/tmp/ssh-1UGv8p0CgFNJ/agent.263905")
EXPECTED_AGENT_FINGERPRINT = "SHA256:IGu9dXOSXw4JoPmwNjAgDRI2AY+zJil/haJGjKRYt34"
KNOWN_HOSTS = Path("/home/maximoto/Documents/Codex/2026-10-28/task-4/app-https-fresh-guest-read-r2/known-hosts/APP")
EXPECTED_KNOWN_HOSTS_SHA256 = "8894056c53a52d1b8c8ebc4941830530edebf9fd2b8a41e4baab7215a4c16dd7"


class Stop(RuntimeError):
    pass


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def require(value: bool, category: str) -> None:
    if not value:
        raise Stop(category)


def load_action() -> tuple[dict, bytes]:
    raw = ACTION.read_bytes()
    require(digest(raw) == EXPECTED_ACTION_SHA256, "ACTION_BYTES_CHANGED")
    value = json.loads(raw)
    require(value["schema"] == "PLEBEIAN_SIDEQUEST_APP_OBSERVER_ACTION_V1", "ACTION_SCHEMA")
    require(value["status"] == "PENDING_EXACT_ACTION_TIME_CONFIRMATION_NOT_EXECUTED", "ACTION_STATUS")
    require(value["authorization"] == {
        "actionTimeConfirmationReceived": False,
        "serviceActivationAuthorized": False,
    }, "ACTION_AUTHORITY_BOUNDARY")
    return value, raw


def local_payload(action: dict) -> bytes:
    source = REPO / action["publicBundle"]["sourceRoot"]
    records = []
    for expected in action["publicBundle"]["files"]:
        path = source / expected["name"]
        before = path.lstat()
        require(path.is_file() and not path.is_symlink() and before.st_nlink == 1, "SOURCE_FILE_POLICY:" + expected["name"])
        raw = path.read_bytes()
        after = path.lstat()
        require((before.st_dev, before.st_ino, before.st_mode, before.st_size, before.st_mtime_ns, before.st_nlink) ==
                (after.st_dev, after.st_ino, after.st_mode, after.st_size, after.st_mtime_ns, after.st_nlink),
                "SOURCE_CHANGED:" + expected["name"])
        require(len(raw) == expected["bytes"] and digest(raw) == expected["sha256"], "SOURCE_DIGEST:" + expected["name"])
        records.append({**expected, "dataBase64": base64.b64encode(raw).decode("ascii")})
    payload = {
        "schema": "PLEBEIAN_SIDEQUEST_APP_OBSERVER_STAGE_PAYLOAD_V1",
        "actionSha256": EXPECTED_ACTION_SHA256,
        "files": records,
    }
    return (json.dumps(payload, sort_keys=True, separators=(",", ":")) + "\n").encode()


REMOTE = r'''
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

ACTION = "43c85de722985d28e0b5920e0a7fcab5f80635430a47561cf4a9eecc361bed87"
STATE = Path("/var/lib/plebeian-auctions-friday")
STAGE = STATE / "separated-inputs/comet-genesis-bundle-830b87e49bf4ef0ee66664b9b757344a8c9ae8a582473fe28351e8571a7180cf"
HOME = STATE / "network-separated"
BINARY = Path("/opt/plebeian-auctions-friday/releases/separated-deploy-v1/bin/plebeian-auctions-poc")
BUNDLE = "830b87e49bf4ef0ee66664b9b757344a8c9ae8a582473fe28351e8571a7180cf"
OWNER = "3210f99b78ecd0150b6a0efcaffc6f3b532f4e5a3d68f977e77a3b8d10febade"
LISTEN = "tcp://[fdb2:77a9:c591:3ac6:3513:5bf8:cc3b:5a04]:27656"
EXPECTED = {
    "comet-genesis-bundle.json": (2741, "e2ec78c285ca98233bef227379acaf9ef2d6f46c543140289803e9d2b954d383"),
    "deployment-anchor.json": (2411, "777e3df52fc4abcff952d27dc7399af99554cba2c4082211f909f5d8c9ecf1eb"),
    "frost-final-public.json": (17321, "f16c7bf8eebf7ce29878f9e2a34c21c8974ad3bdef3372c364657dc7ee061877"),
    "funding-abort-bootstrap.json": (442, "ee4e7fbf23f9e66731b1d908979875aac3fbeec9c1fa54f0a9ae5fa507e2f2cf"),
    "genesis.json": (1876, "8574fadb77fafea9c56fff7cff32af0205be7b2e05d12f1ab1fcf4a1a8f3a4ea"),
    "network-facts.json": (417, "0dd62cc5270f9e007851ed5c892a7386e2cdf620f8b7e1958fe84019ebe594a5"),
    "network.json": (3716, "0fe06ef2c15fd7f0ecd5eed32ac26111f32357c9139ab6c083e88f5ff29b0203"),
    "separated-runtime-binding.json": (17716, "b3e2632ddd5f2b4601b7b91ac9880ce9274767cfeff5c8b5b80aabdd79e9551a"),
    "validator-roster.json": (4685, "e9d68caccf10cc9d1642f736aff87836127c9f5554d21d74d4ec4c6e1f40d22e"),
}

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def stop(category, **fields):
    print(json.dumps({"schema": "PLEBEIAN_SIDEQUEST_APP_OBSERVER_ACTION_RESULT_V1", "status": "STOPPED", "category": category, **fields}, sort_keys=True, separators=(",", ":")))
    raise SystemExit(1)

def service(name):
    value = subprocess.run(["/usr/bin/systemctl", "is-active", name], text=True, capture_output=True, timeout=10)
    return value.stdout.strip()

raw = sys.stdin.buffer.read(200001)
if len(raw) > 200000:
    stop("PAYLOAD_TOO_LARGE")
try:
    payload = json.loads(raw)
except Exception:
    stop("PAYLOAD_JSON")
if payload.get("schema") != "PLEBEIAN_SIDEQUEST_APP_OBSERVER_STAGE_PAYLOAD_V1" or payload.get("actionSha256") != ACTION:
    stop("PAYLOAD_BINDING")
files = payload.get("files")
if not isinstance(files, list) or [item.get("name") for item in files] != list(EXPECTED):
    stop("PAYLOAD_FILES")
if STAGE.exists() or STAGE.is_symlink() or HOME.exists() or HOME.is_symlink():
    stop("FRESH_PATH_PRECONDITION", stageExists=STAGE.exists() or STAGE.is_symlink(), homeExists=HOME.exists() or HOME.is_symlink())
for path, mode, uid, gid in ((STATE, 0o750, 0, 988), (STATE / "separated-inputs", 0o750, 0, 988)):
    value = path.lstat()
    if not stat.S_ISDIR(value.st_mode) or stat.S_IMODE(value.st_mode) != mode or value.st_uid != uid or value.st_gid != gid or path.is_symlink():
        stop("PARENT_METADATA", path=str(path))
binary = BINARY.read_bytes()
metadata = BINARY.lstat()
if len(binary) != 46580232 or sha(binary) != "8f501da6c7b054d3b33f98f4be52c0299655fc52756af70cd59cbc5740afd7c4" or stat.S_IMODE(metadata.st_mode) != 0o755 or metadata.st_uid != 0:
    stop("INITIALIZER_BYTES")
states = {name: service(name) for name in (
    "plebeian-friday-fips.service", "plebeian-friday-observer.service", "plebeian-friday-site.service",
    "plebeian-friday-authority.service", "plebeian-friday-coordinator.service",
)}
if states["plebeian-friday-fips.service"] != "active" or any(states[name] != "inactive" for name in states if name != "plebeian-friday-fips.service"):
    stop("SERVICE_PRECONDITION", services=states)
for forbidden in (
    STATE / "frost-v3/keyset-v3/participant.config.json",
    STATE / "frost-v3/keyset-v3/identity-signing-key.hex",
    STATE / "frost-v3/keyset-v3/kex-private-key.hex",
    STATE / "frost-v3/keyset-v3/signer-rpc-identity.key",
    STATE / "frost-v3/keyset-v3/transport-secrets.json",
    STATE / "frost-v3/keyset-v3/state",
):
    if forbidden.exists() or forbidden.is_symlink():
        stop("FORBIDDEN_APP_PARTICIPANT_STATE", path=str(forbidden))

os.mkdir(STAGE, 0o700)
staged = []
try:
    for item in files:
        name = item["name"]
        try:
            data = base64.b64decode(item["dataBase64"], validate=True)
        except Exception:
            stop("PAYLOAD_BASE64", name=name, stageCreated=True)
        size, expected = EXPECTED[name]
        if item.get("bytes") != size or item.get("sha256") != expected or len(data) != size or sha(data) != expected:
            stop("PAYLOAD_FILE_DIGEST", name=name, stageCreated=True)
        path = STAGE / name
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
        try:
            view = memoryview(data)
            while view:
                written = os.write(descriptor, view)
                if written < 1:
                    stop("STAGE_WRITE", name=name, stageCreated=True)
                view = view[written:]
            os.fchmod(descriptor, 0o600)
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        staged.append({"name": name, "bytes": size, "sha256": expected, "mode": "0600"})
    directory = os.open(STAGE, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)
except SystemExit:
    raise
except Exception as error:
    stop("STAGE_EXCEPTION", stageCreated=True, errorType=type(error).__name__)

arguments = [
    str(BINARY), "init-observer", "--home", str(HOME), "--bundle", str(STAGE),
    "--expected-bundle-digest", BUNDLE, "--owner-approval-public-key", OWNER,
    "--fips-p2p-listen", LISTEN,
]
try:
    process = subprocess.run(arguments, text=True, capture_output=True, timeout=30)
except subprocess.TimeoutExpired:
    stop("INITIALIZER_TIMEOUT_PARTIAL_STATE_PRESERVED", stageCreated=True, homeExists=HOME.exists())
if process.returncode != 0:
    stop("INITIALIZER_FAILED_PARTIAL_STATE_PRESERVED", stageCreated=True, homeExists=HOME.exists(), returncode=process.returncode,
         stdout=process.stdout[:4096], stderr=process.stderr[:4096])
try:
    stdout_receipt = json.loads(process.stdout)
    receipt_raw = (HOME / "observer.json").read_bytes()
    receipt = json.loads(receipt_raw)
except Exception as error:
    stop("RECEIPT_PARSE_PARTIAL_STATE_PRESERVED", stageCreated=True, homeExists=HOME.exists(), errorType=type(error).__name__)
if stdout_receipt != receipt or receipt.get("schema") != "PLEBEIAN_FRIDAY_NONVOTING_OBSERVER_V1" or receipt.get("role") != "NONVOTING_APPLICATION_OBSERVER" or receipt.get("bundle_digest") != BUNDLE or receipt.get("owner_approval_public_key") != OWNER or receipt.get("p2p_listen") != LISTEN or receipt.get("rpc_listen") != "tcp://127.0.0.1:27657" or not re.fullmatch(r"[0-9a-f]{40}", str(receipt.get("node_id"))) or not re.fullmatch(r"[0-9a-f]{64}", str(receipt.get("public_key"))):
    stop("RECEIPT_SEMANTICS_PARTIAL_STATE_PRESERVED", stageCreated=True, homeExists=True)
node_key = HOME / "observer/config/node_key.json"
node_metadata = node_key.lstat()
if not stat.S_ISREG(node_metadata.st_mode) or stat.S_IMODE(node_metadata.st_mode) != 0o600 or node_metadata.st_uid != 0 or node_key.is_symlink():
    stop("NODE_KEY_METADATA_PARTIAL_STATE_PRESERVED", stageCreated=True, homeExists=True)
for forbidden in (
    HOME / "observer/config/forbidden-validator-key.json",
    HOME / "observer/data/forbidden-validator-state.json",
    HOME / "observer/config/priv_validator_key.json",
    HOME / "observer/data/priv_validator_state.json",
):
    if forbidden.exists() or forbidden.is_symlink():
        stop("OBSERVER_SIGNING_STATE_PRESENT", path=str(forbidden), stageCreated=True, homeExists=True)
after_states = {name: service(name) for name in states}
if after_states != states:
    stop("SERVICE_STATE_CHANGED", before=states, after=after_states, stageCreated=True, homeExists=True)
print(json.dumps({
    "schema": "PLEBEIAN_SIDEQUEST_APP_OBSERVER_ACTION_RESULT_V1",
    "status": "APP_OBSERVER_INITIALIZED_SERVICES_UNCHANGED",
    "actionSha256": ACTION,
    "stagingRoot": str(STAGE),
    "staged": staged,
    "observerHome": str(HOME),
    "observerReceipt": receipt,
    "observerReceiptBytes": len(receipt_raw),
    "observerReceiptSha256": sha(receipt_raw),
    "nodeKeyMetadata": {"path": str(node_key), "mode": "0600", "uid": node_metadata.st_uid, "gid": node_metadata.st_gid, "bytes": node_metadata.st_size, "contentsReadOrHashed": False},
    "services": after_states,
    "servicesStartedStoppedOrReloaded": False,
    "paymentsPerformed": False,
    "validatorOrFrostPrivateMaterialAccessed": False,
}, sort_keys=True, separators=(",", ":")))
'''


def execute(payload: bytes) -> int:
    require(AGENT.is_socket(), "SSH_AGENT_SOCKET")
    require(digest(KNOWN_HOSTS.read_bytes()) == EXPECTED_KNOWN_HOSTS_SHA256, "KNOWN_HOSTS_BYTES")
    environment = {"PATH": "/usr/bin:/bin", "LANG": "C", "LC_ALL": "C", "SSH_AUTH_SOCK": str(AGENT)}
    agent = subprocess.run(["/usr/bin/ssh-add", "-l"], env=environment, text=True, capture_output=True, timeout=10)
    require(agent.returncode == 0 and EXPECTED_AGENT_FINGERPRINT in agent.stdout and len(agent.stdout.splitlines()) == 1, "SSH_AGENT_IDENTITY")
    remote = ["/usr/bin/python3", "-c", REMOTE]
    command = [
        "/usr/bin/ssh", "-T", "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes",
        "-o", "StrictHostKeyChecking=yes", "-o", "UserKnownHostsFile=" + str(KNOWN_HOSTS),
        "-o", "GlobalKnownHostsFile=/dev/null", "-o", "PasswordAuthentication=no",
        "-o", "KbdInteractiveAuthentication=no", "-o", "ForwardAgent=no", "-o", "ClearAllForwardings=yes",
        "-o", "ConnectTimeout=12", "-o", "ConnectionAttempts=1", "root@139.162.161.233",
        " ".join(shlex.quote(value) for value in remote),
    ]
    result = subprocess.run(command, input=payload, env=environment, capture_output=True, timeout=60)
    sys.stdout.buffer.write(result.stdout)
    sys.stderr.buffer.write(result.stderr)
    return result.returncode


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--approved-action-sha256")
    args = parser.parse_args()
    action, _ = load_action()
    payload = local_payload(action)
    if args.approved_action_sha256 is None:
        print(json.dumps({
            "schema": "PLEBEIAN_SIDEQUEST_APP_OBSERVER_ACTION_PREPARED_V1",
            "status": "READY_LOCAL_INPUTS_VERIFIED_AWAITING_EXACT_ACTION_TIME_CONFIRMATION",
            "actionSha256": EXPECTED_ACTION_SHA256,
            "payloadBytes": len(payload),
            "remoteMutation": False,
            "persistentCredentialGenerated": False,
        }, sort_keys=True, separators=(",", ":")))
        return 0
    require(args.approved_action_sha256 == EXPECTED_ACTION_SHA256, "APPROVAL_DIGEST")
    return execute(payload)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, TypeError, Stop, subprocess.SubprocessError) as error:
        print("APP_OBSERVER_ACTION=STOPPED:" + str(error), file=sys.stderr)
        raise SystemExit(1)
