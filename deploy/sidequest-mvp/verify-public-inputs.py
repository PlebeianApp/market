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
    genesis_decision = json.loads(require_file(accepted["genesisContentDecision"]))
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

    assert config["acceptedBootstrapOnly"] == {
        "ownerVerifiedReceiptSha256": "a9452ede2dc7704036a9d1f9e5b18b53a6f4b0523d5438e50087f3e160599d9d",
        "requests": 7,
        "acceptedResponseBytes": 17479,
        "fundingPerformed": False,
        "persistedWalletState": False,
        "mintStoppedSettled": True,
        "satisfiesPaymentConformance": False,
    }

    assert genesis_decision["schema"] == "PLEBEIAN_SIDEQUEST_GENESIS_CONTENT_DECISION_V1"
    assert genesis_decision["status"] == "OWNER_CONTENT_SELECTION_APPROVED_TIMESTAMP_DEFERRED"
    assert genesis_decision["ownerApprovalEvidence"] == {
        "messageId": "Sentinel_0229af7bf3308191ad9e9f23f189e586",
        "reportedAtUtcMinute": "2026-11-02T16:18Z",
        "approvedChoicesOnly": True,
    }
    assert genesis_decision["chainId"] == "plebeian-auctions-mvp-20261102"
    assert genesis_decision["canonicalGenesisTimeUtc"] is None
    assert genesis_decision["canonicalGenesisTimePolicy"]["rule"] == "CAPTURE_CURRENT_UTC_ONCE_AT_FINAL_SIGNING_INPUT_FREEZE"
    assert genesis_decision["canonicalGenesisTimePolicy"]["requiredFormat"] == "CANONICAL_RFC3339_NANO_UTC_Z"
    assert genesis_decision["authority"] == {
        "contentSelectionApproved": True,
        "timestampCaptureAuthorizedBeforeFreeze": False,
        "deploymentAnchorSigningApproved": False,
        "releaseInstallAuthorized": False,
        "unitInstallAuthorized": False,
        "configurationInstallAuthorized": False,
        "serviceActivationAuthorized": False,
        "dkgMustNotBeRepeated": True,
    }
    assert config["selectedOwnerContent"] == {
        "chainId": "plebeian-auctions-mvp-20261102",
        "canonicalGenesisTimePolicy": "CAPTURE_CURRENT_UTC_ONCE_AT_FINAL_SIGNING_INPUT_FREEZE",
    }
    assert config["deferredFreezeValue"] == {
        "canonicalGenesisTimeUtc": None,
    }
    assert config["pendingAcceptedPaymentEvidence"] == {
        "paymentConformanceReceiptPath": None,
        "paymentConformanceReceiptSha256": None,
        "activeSatKeysetId": None,
        "reviewedTestMintTransportUrl": None,
    }
    assert config["pendingActionScope"] == {
        "freshAuthorityOutputRoot": None,
        "deploymentAnchorSigningApproved": False,
        "releaseInstallAuthorized": False,
        "unitInstallAuthorized": False,
        "configurationInstallAuthorized": False,
        "serviceActivationAuthorized": False,
    }
    assert set(config["derivedAfterOwnerContentAndPayment"]) == {
        "deploymentAnchorAndFundingAbortBootstrap", "networkFactsAndGenesisBundle",
        "browserAndHealthPins", "observerReceiptAndNodeId",
    }
    assert all(value is None for value in config["derivedAfterOwnerContentAndPayment"].values())
    assert config["authority"] == {
        "ownerPrivateKeyRead": False,
        "remoteActions": False,
        "serviceActivationAuthorized": False,
        "dkgMustNotBeRepeated": True,
    }
    print("SIDEQUEST_PUBLIC_INPUTS=PASS")


if __name__ == "__main__":
    main()
