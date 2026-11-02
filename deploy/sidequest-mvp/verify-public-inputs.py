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
    payment_projection = json.loads(require_file(accepted["ownerPaymentProjection"]))
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

    assert payment_projection["schema"] == "PLEBEIAN_FRIDAY_R4_MINT_CONFORMANCE_PUBLIC_PROJECTION_R1_V1"
    assert payment_projection["status"] == "OWNER_READ_ONLY_PUBLIC_RECEIPT_PROJECTION_NOT_GENESIS_ACCEPTANCE"
    assert payment_projection["appFipsUla"] == config["application"]["fipsUla"]
    assert payment_projection["testMintUrl"] == "http://[fdb2:77a9:c591:3ac6:3513:5bf8:cc3b:5a04]:3438"
    keyset_id = payment_projection["activeSatKeysetId"]
    keyset_digest = hashlib.sha256(keyset_id.encode("ascii")).hexdigest()
    assert keyset_id == "001a10236c313f83"
    assert keyset_digest == payment_projection["activeSatKeysetIdSha256"]
    assert keyset_digest == "331120d5ce836011fbbbca90ebed8cc0c8da4cd40d2f58db448653d2b882badd"
    assert payment_projection["inputFeePpk"] == 0
    assert payment_projection["serverVersion"] == "Nutshell/0.19.2"
    assert payment_projection["nuts"] == [4, 5, 7, 8, 9, 10, 11, 12, 14, 17, 20]
    assert payment_projection["excluded"] == [
        "operation identifiers", "tokens", "proofs", "wallet seeds or keys",
        "authentication state", "private database contents",
    ]
    for key in ("actionSha256", "denominationKeyDigest", "inertMintSelectionReceiptSha256", "receiptSha256"):
        assert len(payment_projection[key]) == 64
        int(payment_projection[key], 16)
    assert payment_projection["transport"] == {
        "policy": "EXACT_FIPS_ORIGIN_NO_REDIRECT_BOUNDED_ALL_CLIENTS",
        "requests": 46,
        "responseBytes": 59893,
    }
    assert payment_projection["operationCount"] == len(payment_projection["operationKinds"]) == 6
    assert payment_projection["operationKinds"] == [
        "losing_lock", "losing_refund", "seller_payout", "seller_receive",
        "winning_lock", "winning_redeem",
    ]
    amounts = payment_projection["amounts"]
    assert amounts["loser_after_refund"] == amounts["faucet_each"] == config["fundingPolicy"]["maxPerRequest"]
    assert amounts["winner_after_close"] + amounts["seller_after_payout"] == amounts["faucet_each"]
    assert amounts["winning_bid"] == amounts["seller_after_payout"]
    assert amounts["faucet_each"] - amounts["winner_after_close"] == amounts["winning_bid"]
    assert amounts["losing_bid"] < amounts["winning_bid"]
    assert payment_projection["mechanics"] == {
        "committeeShortcut": "one shared application-level key; NOT FROST or threshold custody",
        "committeeThreshold": False,
        "recoverySupported": False,
        "retryPermitted": False,
        "walletRepository": "DISPOSABLE_MEMORY_ONLY_NOT_RECOVERABLE",
    }
    assert payment_projection["startedAt"] < payment_projection["completedAt"]

    assert config["acceptedBootstrapOnly"] == {
        "ownerVerifiedReceiptSha256": "a9452ede2dc7704036a9d1f9e5b18b53a6f4b0523d5438e50087f3e160599d9d",
        "requests": 7,
        "acceptedResponseBytes": 17479,
        "fundingPerformed": False,
        "persistedWalletState": False,
        "mintStoppedSettled": True,
        "satisfiesPaymentConformance": False,
    }
    assert config["ownerSuppliedPaymentProjection"] == {
        "sourceMessageId": "Sentinel_4df77bca677481918cff4772b0a9138e",
        "reportedAtUtcMinute": "2026-11-02T18:30Z",
        "status": "OWNER_READ_ONLY_PUBLIC_RECEIPT_PROJECTION_NOT_GENESIS_ACCEPTANCE",
        "receiptSha256Claim": "b5bac575046f13e1b030662818fba7ebe89df442cff12a5f8ec3983ac1332add",
        "mintOnlyAcceptancePath": "/home/maximoto/Documents/Codex/2026-10-28/task-3/A3-MINT-PAYMENT-ACTUAL-PUBLIC-PROJECTION-RECONCILIATION-20261102.md",
        "mintOnlyAcceptanceSha256": "9139b1ec862535fbbaad59c19351f81a5987d00aa78618340f63d11700df94da",
        "acceptedAsActualMintOnlyEvidence": True,
        "rawReceiptPath": None,
        "rawReceiptIndependentlyHashed": False,
        "independentlyAcceptedForGenesis": False,
        "activeSatKeysetId": "001a10236c313f83",
        "activeSatKeysetIdSha256": "331120d5ce836011fbbbca90ebed8cc0c8da4cd40d2f58db448653d2b882badd",
        "exactFipsMintUrl": "http://[fdb2:77a9:c591:3ac6:3513:5bf8:cc3b:5a04]:3438",
        "reviewedPublicTestMintTransportUrl": None,
        "committeeThreshold": False,
        "recoverySupported": False,
        "retryPermitted": False,
        "walletRepository": "DISPOSABLE_MEMORY_ONLY_NOT_RECOVERABLE",
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
        "paymentConformanceReceiptSha256": "b5bac575046f13e1b030662818fba7ebe89df442cff12a5f8ec3983ac1332add",
        "activeSatKeysetId": "001a10236c313f83",
        "reviewedTestMintTransportUrl": None,
        "mintOnlyAcceptancePath": "/home/maximoto/Documents/Codex/2026-10-28/task-3/A3-MINT-PAYMENT-ACTUAL-PUBLIC-PROJECTION-RECONCILIATION-20261102.md",
        "mintOnlyAcceptanceSha256": "9139b1ec862535fbbaad59c19351f81a5987d00aa78618340f63d11700df94da",
        "rawReceiptIndependentlyHashed": False,
        "genesisAcceptancePath": None,
        "genesisAcceptanceSha256": None,
        "acceptedForGenesis": False,
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
