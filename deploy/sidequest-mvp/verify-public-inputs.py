#!/usr/bin/env python3
"""Verify accepted public deployment inputs without reading private material."""

import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
CONFIG_PATH = ROOT / "deployment-inputs.json"


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def require_file(record: dict) -> bytes:
    path = Path(record["path"])
    raw = path.read_bytes()
    assert len(raw) == record["bytes"], f"byte count changed: {path}"
    actual = hashlib.sha256(raw).hexdigest()
    assert actual == record["sha256"], f"SHA-256 changed: {path}"
    return raw


def main() -> None:
    config = load_json(CONFIG_PATH)
    assert config["schema"] == "PLEBEIAN_SIDEQUEST_MVP_DEPLOYMENT_INPUTS_V1"
    assert config["valueProfile"] == "FAKE_MONEY_ONLY"
    accepted = config["acceptedPublicInputs"]
    for record in accepted.values():
        require_file(record)

    dkg = json.loads(require_file(accepted["authenticatedDkgResult"]))
    runtime = json.loads(require_file(accepted["separatedRuntimeBinding"]))
    threshold = config["threshold"]
    assert dkg == runtime["result"], "runtime does not embed the accepted DKG result"
    assert runtime["bindingDigest"] == accepted["separatedRuntimeBinding"]["semanticDigest"]
    assert runtime["valueProfile"] == "FAKE_MONEY_ONLY"
    assert runtime["manifestDigest"] == threshold["manifestDigest"]
    assert dkg["committeePublicKey"] == threshold["committeePublicKey"]
    assert dkg["signerRosterDigest"] == threshold["signerRosterDigest"]
    assert dkg["publicKeyPackageSha256"] == threshold["publicKeyPackageSha256"]
    assert len(dkg["participants"]) == threshold["participants"] == 4
    assert len({row["participantId"] for row in dkg["participants"]}) == 4
    assert threshold["minimumSigners"] == 3

    missing = config["missingOwnerAndMintInputs"]
    allowed_nulls = {
        "chainId", "canonicalGenesisTimeUtc", "mintConformanceReceiptPath",
        "mintConformanceReceiptSha256", "activeSatKeysetId",
        "reviewedTestMintTransportUrl", "freshAuthorityOutputRoot",
    }
    assert {key for key, value in missing.items() if value is None} == allowed_nulls
    assert missing["deploymentAnchorSigningApproved"] is False
    assert config["authority"] == {
        "ownerPrivateKeyRead": False,
        "remoteActions": False,
        "serviceActivationAuthorized": False,
        "dkgMustNotBeRepeated": True,
    }
    print("SIDEQUEST_PUBLIC_INPUTS=PASS")


if __name__ == "__main__":
    main()
