#!/usr/bin/env python3
"""Fail-closed pre-start verification for the side-quest site successor."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import stat


class Stop(RuntimeError):
    pass


def require(value: bool, category: str) -> None:
    if not value:
        raise Stop(category)


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def hex64(value: object, category: str) -> str:
    require(isinstance(value, str) and len(value) == 64, category)
    require(all(character in "0123456789abcdef" for character in value), category)
    return value


def read_regular(path: Path, limit: int = 134_217_728) -> tuple[bytes, os.stat_result]:
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(descriptor)
        require(stat.S_ISREG(before.st_mode), "NOT_REGULAR:" + str(path))
        require(before.st_nlink == 1, "MULTI_LINK:" + str(path))
        require(before.st_size <= limit, "FILE_TOO_LARGE:" + str(path))
        chunks: list[bytes] = []
        total = 0
        while True:
            block = os.read(descriptor, min(1 << 20, limit + 1 - total))
            if not block:
                break
            total += len(block)
            require(total <= limit, "FILE_TOO_LARGE:" + str(path))
            chunks.append(block)
        after = os.fstat(descriptor)
        fields = lambda value: (
            value.st_dev, value.st_ino, value.st_mode, value.st_size,
            value.st_mtime_ns, value.st_ctime_ns, value.st_nlink,
        )
        require(fields(before) == fields(after), "FILE_CHANGED:" + str(path))
        return b"".join(chunks), before
    finally:
        os.close(descriptor)


def verify_record(path: Path, record: dict, expected_mode: str | None = None, expected_owner: int = 0) -> bytes:
    raw, metadata = read_regular(path)
    require(len(raw) == record["bytes"], "BYTES_CHANGED:" + str(path))
    require(digest(raw) == record["sha256"], "SHA256_CHANGED:" + str(path))
    mode = f"{stat.S_IMODE(metadata.st_mode):04o}"
    if expected_mode is not None:
        require(mode == expected_mode, "MODE_CHANGED:" + str(path))
    require(metadata.st_uid == expected_owner, "OWNER_CHANGED:" + str(path))
    require(stat.S_IMODE(metadata.st_mode) & 0o022 == 0, "WRITABLE_BY_NON_OWNER:" + str(path))
    return raw


def parse_environment(raw: bytes) -> dict[str, str]:
    values: dict[str, str] = {}
    for source in raw.decode("utf-8").splitlines():
        line = source.strip()
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        require(bool(separator) and key and key not in values, "ENV_FORMAT")
        require("%" not in value and not value.startswith("${"), "ENV_PLACEHOLDER:" + key)
        values[key] = value
    return values


def verify_no_private_fields(value: object, path: str = "root") -> None:
    forbidden = {"privatekey", "private_key", "seed", "secret", "bearer", "proofs", "token"}
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = key.replace("-", "_").lower()
            require(normalized not in forbidden, "PRIVATE_FIELD:" + path + "." + key)
            verify_no_private_fields(child, path + "." + key)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            verify_no_private_fields(child, f"{path}[{index}]")


def verify(release_root: Path, bindings_path: Path, environment_path: Path, application_path: Path, expected_owner: int) -> None:
    bindings_raw, bindings_metadata = read_regular(bindings_path, 1_048_576)
    require(bindings_metadata.st_uid == expected_owner, "BINDINGS_OWNER")
    require(stat.S_IMODE(bindings_metadata.st_mode) == 0o640, "BINDINGS_MODE")
    bindings = json.loads(bindings_raw)
    require(bindings["schema"] == "PLEBEIAN_SIDEQUEST_RUNTIME_BINDINGS_V1", "BINDINGS_SCHEMA")
    require(bindings["status"] == "READY_FOR_SCOPED_ACTIVATION", "BINDINGS_NOT_READY")
    require(bindings["valueProfile"] == "FAKE_MONEY_ONLY", "VALUE_PROFILE")
    verify_no_private_fields(bindings)

    site = bindings["siteArtifact"]
    require(site["relativePath"] == "bin/plebeian-auctions-mvp", "SITE_RELATIVE_PATH")
    verify_record(release_root / site["relativePath"], site, "0755", expected_owner)

    bootstrap = bindings["acceptedBootstrapOnly"]
    require(bootstrap == {
        "acceptanceReportPath": "/home/maximoto/Documents/Codex/2026-10-28/task-3/A3-COCO-ENCODING-BOOTSTRAP-ACTUAL-RECEIPT-ACCEPTANCE-20261102.md",
        "acceptanceReportSha256": "734ebc54830e867a3c77441f56d0c3019f08efee5b64a69959ea888110d342ad",
        "ownerVerifiedReceiptSha256": "a9452ede2dc7704036a9d1f9e5b18b53a6f4b0523d5438e50087f3e160599d9d",
        "requests": 7,
        "acceptedResponseBytes": 17479,
        "fundingPerformed": False,
        "persistedWalletState": False,
        "mintStoppedSettled": True,
        "satisfiesPaymentConformance": False,
    }, "BOOTSTRAP_BOUNDARY")

    required = bindings["requiredInputs"]
    require(all(value is not None for value in required.values()), "REQUIRED_INPUT_MISSING")
    for key in (
        "paymentConformanceReceiptSha256", "deploymentAnchorSha256",
        "networkFactsSha256", "browserPinsSha256", "healthPinsSha256",
        "observerReceiptSha256",
    ):
        hex64(required[key], "REQUIRED_SHA256:" + key)
    require(isinstance(required["chainId"], str) and required["chainId"], "CHAIN_ID")
    require(isinstance(required["canonicalGenesisTimeUtc"], str) and required["canonicalGenesisTimeUtc"].endswith("Z"), "GENESIS_TIME")
    require(isinstance(required["activeSatKeysetId"], str) and required["activeSatKeysetId"], "ACTIVE_KEYSET")
    require(required["deploymentAnchorSigningApproved"] is True, "ANCHOR_NOT_APPROVED")
    require(required["serviceActivationApproved"] is True, "ACTIVATION_NOT_APPROVED")
    require(required["testMintAssemblyUrl"] == "http://127.0.0.1:8180/test-mint", "MINT_URL")

    runtime_files = bindings["runtimeFiles"]
    environment_record = runtime_files["environment"]
    application_record = runtime_files["application"]
    require(environment_record["path"] == str(environment_path), "ENVIRONMENT_PATH")
    require(application_record["path"] == str(application_path), "APPLICATION_PATH")
    environment_raw = verify_record(environment_path, environment_record, "0640", expected_owner)
    application_raw = verify_record(application_path, application_record, "0640", expected_owner)

    environment = parse_environment(environment_raw)
    required_environment = {
        "FRIDAY_APPLICATION": str(application_path),
        "FRIDAY_ROLE": "APPLICATION",
        "FRIDAY_SITE_PORT": "8180",
        "FRIDAY_DEPLOYMENT_ANCHOR_SHA256": required["deploymentAnchorSha256"],
        "FRIDAY_NETWORK_FACTS_SHA256": required["networkFactsSha256"],
        "POC_FRIDAY_BROWSER_PINS_SHA256": required["browserPinsSha256"],
        "POC_FRIDAY_HEALTH_PINS_SHA256": required["healthPinsSha256"],
        "FRIDAY_OBSERVER_RECEIPT_SHA256": required["observerReceiptSha256"],
        "FRIDAY_OBSERVER_NODE_ID": required["observerNodeId"],
        "POC_FRIDAY_BROWSER_READY": "true",
        "POC_FRIDAY_R20_CLOSE_TRIGGER": "true",
        "POC_FRIDAY_RECOVERY_ONLY": "false",
    }
    for key, expected in required_environment.items():
        require(environment.get(key) == expected, "ENVIRONMENT_BINDING:" + key)

    application = json.loads(application_raw)
    require(application["schema"] == "PLEBEIAN_FRIDAY_SEPARATED_APPLICATION_V1", "APPLICATION_SCHEMA")
    require(application["role"] == "APPLICATION" and application["participant_id"] == 0, "APPLICATION_ROLE")
    require(application["deployment_id"] == bindings["deploymentId"], "APPLICATION_DEPLOYMENT")
    require(application["application_ipv4"] == "139.162.161.233", "APPLICATION_IPV4")
    require(application["cashu_mint_url"] == "https://139.162.161.233", "APPLICATION_MINT_ORIGIN")
    require(application["site_port"] == 8180, "APPLICATION_SITE_PORT")

    authority = bindings["authority"]
    require(authority == {
        "remoteInstallAuthorized": True,
        "runtimeConfigInstallAuthorized": True,
        "serviceActivationAuthorized": True,
        "dkgMustNotBeRepeated": True,
    }, "AUTHORITY_SCOPE")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--release-root", type=Path, required=True)
    parser.add_argument("--bindings", type=Path, required=True)
    parser.add_argument("--environment", type=Path, required=True)
    parser.add_argument("--application", type=Path, required=True)
    parser.add_argument("--fixture-allow-current-owner", action="store_true")
    args = parser.parse_args()
    expected_owner = 0
    if args.fixture_allow_current_owner:
        release_root = args.release_root.resolve()
        require(release_root != Path("/tmp") and Path("/tmp") in release_root.parents, "FIXTURE_RELEASE_ROOT")
        expected_owner = os.geteuid()
    verify(args.release_root, args.bindings, args.environment, args.application, expected_owner)
    print("SIDEQUEST_RUNTIME=READY")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError, Stop) as error:
        print("SIDEQUEST_RUNTIME=STOPPED:" + str(error))
        raise SystemExit(1)
