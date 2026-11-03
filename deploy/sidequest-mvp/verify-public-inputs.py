#!/usr/bin/env python3
"""Verify accepted public deployment inputs without reading private material."""

import hashlib
import json
from pathlib import Path
import stat


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
    assert config["status"] == "PUBLIC_INPUTS_BOUND_DERIVED_OUTPUTS_AND_ACTION_SCOPE_REQUIRED"
    assert config["valueProfile"] == "FAKE_MONEY_ONLY"
    accepted = config["acceptedPublicInputs"]
    for record in accepted.values():
        require_file(record)

    dkg = json.loads(require_file(accepted["authenticatedDkgResult"]))
    runtime = json.loads(require_file(accepted["separatedRuntimeBinding"]))
    genesis_decision = json.loads(require_file(accepted["genesisContentDecision"]))
    genesis_freeze = json.loads(require_file(accepted["canonicalGenesisInputFreeze"]))
    genesis_preimage = json.loads(require_file(accepted["unsignedGenesisSigningPreimage"]))
    payment_projection = json.loads(require_file(accepted["ownerPaymentProjection"]))
    signed_anchor = json.loads(require_file(accepted["signedDeploymentAnchor"]))
    funding_bootstrap = json.loads(require_file(accepted["signedFundingAbortBootstrap"]))
    authority_receipt = json.loads(require_file(accepted["authorityRenderReceipt"]))
    anchor_reconciliation = json.loads(require_file(accepted["publicAnchorReconciliation"]))
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

    assert signed_anchor["schema"] == "PLEBEIAN_FRIDAY_COMET_DEPLOYMENT_ANCHOR_V1"
    assert signed_anchor["deployment_id"] == config["deploymentId"]
    assert signed_anchor["application_run_id"] == runtime["result"]["manifest"]["applicationRunId"]
    assert signed_anchor["chain_id"] == "plebeian-auctions-mvp-20261102"
    assert signed_anchor["genesis_time"] == "2026-11-02T18:35:21Z"
    assert signed_anchor["expected_manifest_digest"] == threshold["manifestDigest"]
    assert signed_anchor["frost_final_package_sha256"] == accepted["authenticatedDkgResult"]["sha256"]
    assert signed_anchor["funding_abort_bootstrap_sha256"] == accepted["signedFundingAbortBootstrap"]["sha256"]
    assert signed_anchor["separated_bootstrap_digest"] == runtime["bootstrapDigest"]
    assert signed_anchor["separated_runtime_binding_digest"] == runtime["bindingDigest"]
    assert signed_anchor["separated_runtime_binding_sha256"] == accepted["separatedRuntimeBinding"]["sha256"]
    assert signed_anchor["separated_mint_conformance_sha256"] == accepted["ownerPaymentProjection"]["sha256"]
    assert signed_anchor["active_keyset_id"] == "001a10236c313f83"
    assert signed_anchor["application_fips_ula"] == config["application"]["fipsUla"]
    assert signed_anchor["separated_mint_origin"] == config["application"]["mintOrigin"]
    assert signed_anchor["owner_approval_public_key"] == "3210f99b78ecd0150b6a0efcaffc6f3b532f4e5a3d68f977e77a3b8d10febade"
    assert len(signed_anchor["owner_approval_signature"]) == 128
    int(signed_anchor["owner_approval_signature"], 16)
    assert len(signed_anchor["roster"]) == 4
    for slot, (anchor_member, participant) in enumerate(zip(signed_anchor["roster"], dkg["participants"]), 1):
        assert anchor_member == {
            "slot": slot,
            "host_id": participant["hostId"],
            "fips_ula": participant["fipsUla"],
            "signer_identity": participant["signerIdentity"],
        }
    assert funding_bootstrap == {
        "schema": "PLEBEIAN_FRIDAY_FUNDING_ABORT_BOOTSTRAP_V1",
        "activeKeysetId": signed_anchor["active_keyset_id"],
        "committeeKeysetId": dkg["committeeKeysetId"],
        "committeeKeysetVersion": dkg["committeeKeysetVersion"],
        "dkgRunId": dkg["dkgRunId"],
        "publicKeyPackageSha256": dkg["publicKeyPackageSha256"],
        "signerRosterDigest": dkg["signerRosterDigest"],
    }
    assert authority_receipt == {
        "schema": "PLEBEIAN_FRIDAY_COMET_AUTHORITY_RENDERED_V1",
        "deployment_id": signed_anchor["deployment_id"],
        "chain_id": signed_anchor["chain_id"],
        "application_run_id": signed_anchor["application_run_id"],
        "expected_manifest_digest": signed_anchor["expected_manifest_digest"],
        "owner_approval_public_key": signed_anchor["owner_approval_public_key"],
        "frost_final_package_sha256": signed_anchor["frost_final_package_sha256"],
        "funding_abort_bootstrap_sha256": accepted["signedFundingAbortBootstrap"]["sha256"],
        "deployment_anchor_sha256": accepted["signedDeploymentAnchor"]["sha256"],
    }
    assert anchor_reconciliation["schema"] == "PUBLIC_EXISTING_OWNER_ANCHOR_RECONCILIATION_V1"
    assert anchor_reconciliation["status"] == "EXISTING_PUBLIC_SIGNATURE_AND_OUTPUTS_VERIFIED_REQUIRES_INDEPENDENT_REVIEW"
    assert anchor_reconciliation["historicalAttemptStatusUnchanged"] == "STOP_NO_RETRY_PRESERVE_ALL_STATE"
    assert anchor_reconciliation["newSignatureOrRendererRun"] is False
    assert anchor_reconciliation["privateSeedReadOrStat"] is False
    assert anchor_reconciliation["genesisOrRemoteOrActivation"] is False
    assert anchor_reconciliation["oldEvidenceOrOutputsModified"] is False
    assert anchor_reconciliation["process"]["returnCode"] == 0
    assert anchor_reconciliation["process"]["settled"] is True
    assert anchor_reconciliation["publicResult"] == {
        "deploymentAnchorSha256": accepted["signedDeploymentAnchor"]["sha256"],
        "fundingAbortBootstrapSha256": accepted["signedFundingAbortBootstrap"]["sha256"],
        "messageBytes": 2077,
        "messageSha256": "757b4855ed30d05d474636f60ecfa4e8388ef841ba27b39fb83c127e4f0c4d6b",
        "ownerPublicKey": signed_anchor["owner_approval_public_key"],
        "rendererStdoutReceiptChecked": False,
        "semanticReceiptVerified": True,
        "signatures": 1,
    }

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
        "productionReceiptPath": "/home/maximoto/Documents/Codex/2026-10-26/task-3/prototype/wednesday-shell-r20-core/mint-payment-public-receipt-projection-r1/OWNER-SUPPLIED-PUBLIC-PROJECTION-R1.json",
        "productionReceiptSha256": "f671be3673fed9f074cd142640e38bc7c2fb98002881164895477e1f4d9523da",
        "satisfiesProductionReceiptFileHashContract": True,
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
    assert genesis_decision["status"] == "OWNER_CONTENT_FROZEN_UNSIGNED_INDEPENDENT_REVIEW_ACCEPTED"
    assert genesis_decision["ownerApprovalEvidence"] == {
        "messageId": "Sentinel_0229af7bf3308191ad9e9f23f189e586",
        "reportedAtUtcMinute": "2026-11-02T16:18Z",
        "approvedChoicesOnly": True,
    }
    assert genesis_decision["chainId"] == "plebeian-auctions-mvp-20261102"
    assert genesis_decision["canonicalGenesisTimeUtc"] == "2026-11-02T18:35:21Z"
    assert genesis_decision["canonicalGenesisTimePolicy"]["rule"] == "CAPTURE_CURRENT_UTC_ONCE_AT_FINAL_SIGNING_INPUT_FREEZE"
    assert genesis_decision["canonicalGenesisTimePolicy"]["requiredFormat"] == "CANONICAL_RFC3339_NANO_UTC_Z"
    assert genesis_decision["canonicalGenesisTimePolicy"]["freezeRequires"] == [
        "owner-reviewed sanitized payment-conformance projection file and SHA-256 required by the production renderer",
        "accepted active SAT keyset ID",
        "exact accepted DKG and separated runtime bindings",
        "fresh authority output root selected for the scoped signing action",
    ]
    assert genesis_decision["authority"] == {
        "contentSelectionApproved": True,
        "timestampCaptureAuthorizedBeforeFreeze": False,
        "timestampCapturedAtFinalFreeze": True,
        "independentFreezeReviewPending": False,
        "independentFreezeReviewAccepted": True,
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
    assert genesis_freeze["schema"] == "CANONICAL_GENESIS_SIGNING_INPUT_FREEZE_V1"
    assert genesis_freeze["status"] == "UNSIGNED_FROZEN_CONTENT_REQUIRES_REVIEW_NO_EXECUTION_AUTHORITY"
    assert genesis_freeze["chainId"] == "plebeian-auctions-mvp-20261102"
    assert genesis_freeze["genesisTimeUtc"] == "2026-11-02T18:35:21Z"
    assert genesis_freeze["allLanesMustConsumeThisTimestampAndInputSet"] is True
    assert genesis_freeze["inputs"]["mintPublicProjection"]["sha256"] == accepted["ownerPaymentProjection"]["sha256"]
    assert genesis_freeze["legacyGoTestMintUrl"] == "UNRESOLVED_SEPARATE_ASSEMBLY_FIELD_REQUIRES_TEST_MINT_PATH_NOT_AN_ANCHOR_INPUT"
    assert genesis_preimage["schema"] == "GO_DEPLOYMENT_ANCHOR_UNSIGNED_PREIMAGE_V1"
    assert genesis_preimage["bytes"] == 2077
    assert genesis_preimage["sha256"] == "757b4855ed30d05d474636f60ecfa4e8388ef841ba27b39fb83c127e4f0c4d6b"
    assert genesis_preimage["genesisTimeUtc"] == genesis_freeze["genesisTimeUtc"]
    assert genesis_preimage["signatureGenerated"] is False
    assert config["frozenGenesisValue"] == {
        "canonicalGenesisTimeUtc": "2026-11-02T18:35:21Z",
        "canonicalFreezeSha256": "e8639dae8da64d5d2c35721c43c7097af2a4844eaedd0076ad62ad38d4f9c9c2",
        "unsignedSigningMessageBytes": 2077,
        "unsignedSigningMessageSha256": "757b4855ed30d05d474636f60ecfa4e8388ef841ba27b39fb83c127e4f0c4d6b",
        "independentFreezeReviewPending": False,
        "independentFreezeReviewSha256": "4d002c529f058e9beac785cbc689212531447f8a0a92cf055b7e0a0fb1d5352d",
        "signatureGenerated": False,
    }
    assert config["boundPaymentEvidence"] == {
        "paymentConformanceReceiptPath": "/home/maximoto/Documents/Codex/2026-10-26/task-3/prototype/wednesday-shell-r20-core/mint-payment-public-receipt-projection-r1/OWNER-SUPPLIED-PUBLIC-PROJECTION-R1.json",
        "paymentConformanceReceiptSha256": "f671be3673fed9f074cd142640e38bc7c2fb98002881164895477e1f4d9523da",
        "underlyingRawReceiptSha256OwnerVerifiedOnly": "b5bac575046f13e1b030662818fba7ebe89df442cff12a5f8ec3983ac1332add",
        "activeSatKeysetId": "001a10236c313f83",
        "sourceCompatibleTestMintAssemblyCandidate": "http://127.0.0.1:8180/test-mint",
        "selectedTestMintAssemblyUrl": "http://127.0.0.1:8180/test-mint",
        "testMintAssemblyRole": "DISABLED_LEGACY_NOTE_NAMESPACE_NOT_OPERATIONAL_MINT_API",
        "canonicalCashuMintUrl": "https://139.162.161.233",
        "conformanceFipsServerUrl": "http://[fdb2:77a9:c591:3ac6:3513:5bf8:cc3b:5a04]:3438",
        "mintOnlyAcceptancePath": "/home/maximoto/Documents/Codex/2026-10-28/task-3/A3-MINT-PAYMENT-ACTUAL-PUBLIC-PROJECTION-RECONCILIATION-20261102.md",
        "mintOnlyAcceptanceSha256": "9139b1ec862535fbbaad59c19351f81a5987d00aa78618340f63d11700df94da",
        "privateProofTransferRequired": False,
    }
    assert config["boundPaymentEvidence"]["canonicalCashuMintUrl"] == config["application"]["mintOrigin"]
    assert config["boundPaymentEvidence"]["sourceCompatibleTestMintAssemblyCandidate"] == "http://127.0.0.1:8180/test-mint"
    assert config["boundPaymentEvidence"]["selectedTestMintAssemblyUrl"] == config["boundPaymentEvidence"]["sourceCompatibleTestMintAssemblyCandidate"]
    assert config["boundPaymentEvidence"]["sourceCompatibleTestMintAssemblyCandidate"] not in {
        config["boundPaymentEvidence"]["canonicalCashuMintUrl"],
        config["boundPaymentEvidence"]["conformanceFipsServerUrl"],
    }
    assert config["boundPaymentEvidence"]["conformanceFipsServerUrl"] == payment_projection["testMintUrl"]
    assembly_record = load_json(ROOT / "genesis-assembly-actual-r1.json")
    assert assembly_record["schema"] == "PLEBEIAN_SIDEQUEST_GENESIS_ASSEMBLY_ACTUAL_R1"
    assert assembly_record["status"] == "LOCAL_PUBLIC_ASSEMBLY_COMPLETED_NOT_INSTALLED_NOT_ACTIVATED_REQUIRES_PUBLIC_REVIEW"
    output_root = Path(assembly_record["outputRoot"])
    assert output_root.is_dir()
    assert len(assembly_record["outputFiles"]) == 9
    for record in assembly_record["outputFiles"]:
        path = output_root / record["name"]
        metadata = path.stat()
        assert stat.S_ISREG(metadata.st_mode)
        assert metadata.st_size == record["bytes"]
        assert f"{stat.S_IMODE(metadata.st_mode):04o}" == record["mode"]
        assert hashlib.sha256(path.read_bytes()).hexdigest() == record["sha256"]
    assembly_receipt = load_json(output_root / "comet-genesis-bundle.json")
    assert assembly_receipt["bundle_digest"] == assembly_record["receipt"]["bundleDigest"]
    assert assembly_receipt["genesis_file_sha256"] == assembly_record["receipt"]["genesisFileSha256"]
    assert assembly_receipt["validators_hash"] == assembly_record["receipt"]["validatorsHash"]
    assert assembly_receipt["network_facts_sha256"] == assembly_record["receipt"]["networkFactsSha256"]
    assert config["localPublicAssembly"] == {
        "status": "COMPLETED_NOT_INSTALLED_NOT_ACTIVATED_REQUIRES_PUBLIC_REVIEW",
        "recordPath": "deploy/sidequest-mvp/genesis-assembly-actual-r1.json",
        "outputRoot": str(output_root),
        "bundleDigest": assembly_receipt["bundle_digest"],
        "genesisFileSha256": assembly_receipt["genesis_file_sha256"],
        "validatorsHash": assembly_receipt["validators_hash"],
        "networkFactsSha256": assembly_receipt["network_facts_sha256"],
        "acceptedForRemoteInstall": False,
        "remoteMutation": False,
        "privateStateRead": False,
    }
    assert config["pendingActionScope"] == {
        "acceptedAuthorityOutputRoot": "/home/maximoto/Documents/Codex/2026-10-28/task-2/genesis-owner-authority-render-r1/output",
        "deploymentAnchorSigningApprovedAndCompleted": True,
        "historicalControllerStopPreserved": True,
        "rendererRerunOrResignAuthorized": False,
        "releaseInstallAuthorized": False,
        "unitInstallAuthorized": False,
        "configurationInstallAuthorized": False,
        "serviceActivationAuthorized": False,
    }
    assert config["derivedAfterFrozenInputs"] == {
        "deploymentAnchorSha256": accepted["signedDeploymentAnchor"]["sha256"],
        "fundingAbortBootstrapSha256": accepted["signedFundingAbortBootstrap"]["sha256"],
        "authorityRenderReceiptSha256": accepted["authorityRenderReceipt"]["sha256"],
        "networkFactsAndGenesisBundle": {
            "status": "LOCAL_PUBLIC_ASSEMBLY_COMPLETED_REQUIRES_REVIEW",
            "bundleDigest": assembly_receipt["bundle_digest"],
            "genesisFileSha256": assembly_receipt["genesis_file_sha256"],
            "networkFactsSha256": assembly_receipt["network_facts_sha256"],
            "validatorsHash": assembly_receipt["validators_hash"],
        },
        "browserAndHealthPins": None,
        "observerReceiptAndNodeId": None,
    }
    assert config["authority"] == {
        "ownerPrivateKeyRead": False,
        "remoteActions": False,
        "ownerSigningOutputAccepted": True,
        "rendererRerunAuthorized": False,
        "serviceActivationAuthorized": False,
        "dkgMustNotBeRepeated": True,
    }
    print("SIDEQUEST_PUBLIC_INPUTS=PASS")


if __name__ == "__main__":
    main()
