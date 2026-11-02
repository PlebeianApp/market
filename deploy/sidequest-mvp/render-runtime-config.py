#!/usr/bin/env python3
"""Render inert or fully bound five-role public runtime configuration."""

from __future__ import annotations

import argparse
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import re


CONFIG = Path("/etc/plebeian-auctions-friday")
STATE = Path("/var/lib/plebeian-auctions-friday")
ANCHOR = Path("/var/lib/plebeian-auctions-friday-anchor-separated")
RELEASE = Path("/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4")
PREDECESSOR = Path("/opt/plebeian-auctions-friday/releases/separated-deploy-v1")


class Stop(RuntimeError):
    pass


def require(value: bool, category: str) -> None:
    if not value:
        raise Stop(category)


def canonical(value: object) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n").encode()


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def hex_value(value: object, size: int) -> bool:
    return isinstance(value, str) and bool(re.fullmatch(f"[0-9a-f]{{{size}}}", value))


def require_source(record: dict) -> dict:
    path = Path(record["path"])
    raw = path.read_bytes()
    require(len(raw) == record["bytes"] and digest(raw) == record["sha256"], "SOURCE_DRIFT:" + str(path))
    return json.loads(raw) if path.suffix == ".json" else {"rawSha256": digest(raw)}


def valid_genesis_time(value: object) -> bool:
    if not isinstance(value, str):
        return False
    matched = re.fullmatch(r"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z", value)
    if matched is None or (matched.group(2) is not None and matched.group(2).endswith("0")):
        return False
    try:
        parsed = datetime.strptime(matched.group(1), "%Y-%m-%dT%H:%M:%S")
    except ValueError:
        return False
    return parsed.year > 1


def readiness(decisions: dict, payment_projection: dict) -> tuple[bool, list[str]]:
    selected = decisions["selectedOwnerContent"]
    deferred = decisions["deferredFreezeValue"]
    payment = decisions["acceptedPaymentEvidence"]
    derived = decisions["derivedRuntimeOutputs"]
    authority = decisions["authority"]
    missing: list[str] = []
    chain = selected["chainId"]
    if chain != "plebeian-auctions-mvp-20261102":
        missing.append("selectedOwnerContent.chainId")
    if selected["canonicalGenesisTimePolicy"] != "CAPTURE_CURRENT_UTC_ONCE_AT_FINAL_SIGNING_INPUT_FREEZE":
        missing.append("selectedOwnerContent.canonicalGenesisTimePolicy")
    if not valid_genesis_time(deferred["canonicalGenesisTimeUtc"]):
        missing.append("deferredFreezeValue.canonicalGenesisTimeUtc")
    if not payment["acceptedForGenesis"]:
        missing.append("acceptedPaymentEvidence.acceptedForGenesis")
    if not payment["rawReceiptIndependentlyHashed"]:
        missing.append("acceptedPaymentEvidence.rawReceiptIndependentlyHashed")
    if not isinstance(payment["genesisAcceptancePath"], str) or not payment["genesisAcceptancePath"].startswith("/"):
        missing.append("acceptedPaymentEvidence.genesisAcceptancePath")
    if not hex_value(payment["genesisAcceptanceSha256"], 64):
        missing.append("acceptedPaymentEvidence.genesisAcceptanceSha256")
    if not isinstance(payment["paymentConformanceReceiptPath"], str) or not payment["paymentConformanceReceiptPath"].startswith("/"):
        missing.append("acceptedPaymentEvidence.paymentConformanceReceiptPath")
    if payment["paymentConformanceReceiptSha256"] != payment_projection["receiptSha256"]:
        missing.append("acceptedPaymentEvidence.paymentConformanceReceiptSha256")
    if payment["activeSatKeysetId"] != payment_projection["activeSatKeysetId"]:
        missing.append("acceptedPaymentEvidence.activeSatKeysetId")
    if payment["reviewedTestMintTransportUrl"] != "https://139.162.161.233/test-mint":
        missing.append("acceptedPaymentEvidence.reviewedTestMintTransportUrl")
    for key in ("deploymentAnchorSha256", "networkFactsSha256", "browserPinsSha256", "healthPinsSha256", "observerReceiptSha256"):
        if not hex_value(derived[key], 64):
            missing.append("derivedRuntimeOutputs." + key)
    if not hex_value(derived["observerNodeId"], 40):
        missing.append("derivedRuntimeOutputs.observerNodeId")
    for key in ("deploymentAnchorSigningApproved", "releaseInstallAuthorized", "unitInstallAuthorized", "configurationInstallAuthorized", "serviceActivationAuthorized"):
        if authority[key] is not True:
            missing.append("authority." + key)
    return not missing, missing


def validate_payment_projection(payment: dict, plan: dict, bootstrap: dict) -> None:
    require(payment["schema"] == "PLEBEIAN_FRIDAY_R4_MINT_CONFORMANCE_PUBLIC_PROJECTION_R1_V1", "PAYMENT_PROJECTION_SCHEMA")
    require(payment["status"] == "OWNER_READ_ONLY_PUBLIC_RECEIPT_PROJECTION_NOT_GENESIS_ACCEPTANCE", "PAYMENT_PROJECTION_STATUS")
    require(payment["appFipsUla"] == bootstrap["application"]["fipsUla"], "PAYMENT_PROJECTION_FIPS_ULA")
    expected_mint_url = f"http://[{bootstrap['application']['fipsUla']}]:3438"
    require(payment["testMintUrl"] == expected_mint_url == plan["acceptedExistingInputs"]["projectedExactFipsMintUrl"], "PAYMENT_PROJECTION_MINT_URL")
    keyset_id = payment["activeSatKeysetId"]
    require(keyset_id == plan["acceptedExistingInputs"]["projectedActiveSatKeysetId"], "PAYMENT_PROJECTION_KEYSET")
    require(digest(keyset_id.encode("ascii")) == payment["activeSatKeysetIdSha256"], "PAYMENT_PROJECTION_KEYSET_DIGEST")
    require(payment["activeSatKeysetIdSha256"] == plan["acceptedExistingInputs"]["bootstrapActiveKeysetDigest"], "PAYMENT_BOOTSTRAP_KEYSET_DIGEST")
    require(payment["receiptSha256"] == plan["acceptedExistingInputs"]["projectedPaymentReceiptSha256Claim"], "PAYMENT_PROJECTION_RECEIPT_CLAIM")
    require(plan["acceptedExistingInputs"]["paymentProjectionGenesisAccepted"] is False, "PAYMENT_PROJECTION_PREACCEPTED")
    require(payment["inputFeePpk"] == 0, "PAYMENT_PROJECTION_FEES")
    require(payment["transport"] == {
        "policy": "EXACT_FIPS_ORIGIN_NO_REDIRECT_BOUNDED_ALL_CLIENTS",
        "requests": 46,
        "responseBytes": 59893,
    }, "PAYMENT_PROJECTION_TRANSPORT")
    require(payment["operationKinds"] == [
        "losing_lock", "losing_refund", "seller_payout", "seller_receive",
        "winning_lock", "winning_redeem",
    ] and payment["operationCount"] == 6, "PAYMENT_PROJECTION_OPERATIONS")
    amounts = payment["amounts"]
    require(amounts["loser_after_refund"] == amounts["faucet_each"] == plan["acceptedExistingInputs"]["fundingMaxPerRequest"], "PAYMENT_PROJECTION_REFUND")
    require(amounts["winner_after_close"] + amounts["seller_after_payout"] == amounts["faucet_each"], "PAYMENT_PROJECTION_CONSERVATION")
    require(amounts["winning_bid"] == amounts["seller_after_payout"] == amounts["faucet_each"] - amounts["winner_after_close"], "PAYMENT_PROJECTION_SETTLEMENT")
    require(amounts["losing_bid"] < amounts["winning_bid"], "PAYMENT_PROJECTION_BIDS")
    require(payment["mechanics"] == {
        "committeeShortcut": "one shared application-level key; NOT FROST or threshold custody",
        "committeeThreshold": False,
        "recoverySupported": False,
        "retryPermitted": False,
        "walletRepository": "DISPOSABLE_MEMORY_ONLY_NOT_RECOVERABLE",
    }, "PAYMENT_PROJECTION_MECHANICS")


def application(bootstrap: dict, role: str, participant_id: int) -> dict:
    app = bootstrap["application"]
    validators = bootstrap["validators"]
    return {
        "schema": "PLEBEIAN_FRIDAY_SEPARATED_APPLICATION_V1",
        "role": role,
        "participant_id": participant_id,
        "deployment_id": bootstrap["deploymentId"],
        "run_id": bootstrap["applicationRunId"],
        "application_host_id": app["hostId"],
        "application_ipv4": app["underlayIpv4"],
        "application_fips_ula": app["fipsUla"],
        "fips_ulas": [value["fipsUla"] for value in validators],
        "comet_p2p_port": 27656,
        "comet_rpc_port": 27657,
        "signer_rpc_port": 39101,
        "mint_port": 3438,
        "cashu_mint_url": app["mintOrigin"],
        "site_port": 8180,
        "network_root": str(STATE / "network-separated"),
        "dkg_root": str(STATE / "frost-v3/keyset-v3"),
        "coordinator_root": str(STATE / "coordinator-v3/runtime"),
        "coordinator_rpc_identity_path": str(STATE / "coordinator-v3/runtime/coordinator-rpc-identity.key"),
    }


def environment(app: dict, runtime: dict, prerequisites: dict, decisions: dict, ready: bool, host: dict) -> bytes:
    derived = decisions["derivedRuntimeOutputs"]
    unresolved = "%UNRENDERED%"
    values = {
        "FRIDAY_APPLICATION": str(CONFIG / "application.json"),
        "FRIDAY_NETWORK_ROOT": str(STATE / "network-separated"),
        "FRIDAY_NETWORK_FACTS": str(STATE / "network-separated/network-facts.json"),
        "FRIDAY_DKG_RESULT": str(STATE / "separated-inputs/runtime-binding.json"),
        "FRIDAY_PARTICIPANT_BIN": str(PREDECESSOR / "bin/coco-demo-frost-participant-3of4"),
        "FRIDAY_TERMINAL_EXECUTOR_BIN": str(RELEASE / "bin/plebeian-friday-terminal-executor"),
        "FRIDAY_COORDINATOR_DB": str(STATE / "coordinator-v3/runtime/operations.sqlite3"),
        "FRIDAY_COORDINATOR_ANCHOR_DB": str(ANCHOR / "coordinator.sqlite3"),
        "FRIDAY_FUNDING_ABORT_ANCHOR_DB": str(ANCHOR / "funding-abort.sqlite3"),
        "FRIDAY_FIPS_CONFIG": str(STATE / "fips/identity/fips.yaml"),
        "FRIDAY_FIPS_IDENTITY_KEY": str(STATE / "fips/identity/fips.key"),
        "FRIDAY_P2P_PORT": "27656",
        "FRIDAY_RPC_PORT": "27657",
        "FRIDAY_SIGNER_PORT": "39101",
        "FRIDAY_MINT_PORT": "3438",
        "FRIDAY_SITE_PORT": "8180",
        "FRIDAY_ROLE": app["role"],
        "FRIDAY_FIPS_UNDERLAY_IPV4": host["underlayIpv4"],
        "FRIDAY_FIPS_ULA": host["fipsUla"],
        "FRIDAY_DEPLOYMENT_ANCHOR_SHA256": derived["deploymentAnchorSha256"] if ready else unresolved,
        "FRIDAY_DKG_MANIFEST_DIGEST": runtime["manifestDigest"],
        "FRIDAY_NETWORK_FACTS_SHA256": derived["networkFactsSha256"] if ready else unresolved,
        "FRIDAY_OWNER_APPROVAL_PUBLIC_KEY": prerequisites["ownerPublicKey"],
        "FRIDAY_SEPARATED_BOOTSTRAP_DIGEST": runtime["bootstrapDigest"],
        "FRIDAY_SEPARATED_RUNTIME_DIGEST": runtime["bindingDigest"],
        "POC_FRIDAY_BROWSER_PINS_SHA256": derived["browserPinsSha256"] if ready else unresolved,
        "POC_FRIDAY_HEALTH_PINS_SHA256": derived["healthPinsSha256"] if ready else unresolved,
        "POC_FRIDAY_BROWSER_READY": "true" if ready and app["role"] == "APPLICATION" else "false",
        "POC_FRIDAY_R20_CLOSE_TRIGGER": "true" if ready and app["role"] == "APPLICATION" else "false",
        "POC_FRIDAY_RECOVERY_ONLY": "false",
    }
    if app["role"] == "APPLICATION":
        values["FRIDAY_OBSERVER_RECEIPT_SHA256"] = derived["observerReceiptSha256"] if ready else unresolved
        values["FRIDAY_OBSERVER_NODE_ID"] = derived["observerNodeId"] if ready else unresolved
    else:
        values["FRIDAY_SLOT"] = str(app["participant_id"])
    return "".join(f"{key}={value}\n" for key, value in sorted(values.items())).encode()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--decisions", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    args = parser.parse_args()
    require(not args.output_root.exists() and not args.output_root.is_symlink(), "OUTPUT_ROOT_EXISTS")
    plan = json.loads(args.plan.read_text(encoding="utf-8"))
    decisions = json.loads(args.decisions.read_text(encoding="utf-8"))
    require(plan["schema"] == "PLEBEIAN_SIDEQUEST_RUNTIME_ADOPTION_PLAN_V1", "PLAN_SCHEMA")
    require(plan["status"] == "DRAFT_NOT_AUTHORIZED_NOT_INSTALLED_NOT_ACTIVATED", "PLAN_STATUS")
    require(decisions["schema"] == "PLEBEIAN_SIDEQUEST_OWNER_DECISIONS_V1", "DECISIONS_SCHEMA")
    sources = {key: require_source(value) for key, value in plan["acceptedPublicSources"].items()}
    bootstrap = sources["signedBootstrap"]
    runtime = sources["runtimeBinding"]
    prerequisites = sources["prerequisites"]
    genesis_decision = sources["genesisContentDecision"]
    payment_projection = sources["paymentProjection"]
    payment_reconciliation = sources["paymentReconciliation"]
    require(runtime["deploymentId"] == bootstrap["deploymentId"], "DEPLOYMENT_BINDING")
    runtime_participants = runtime["result"]["manifest"]["participants"]
    require(len(runtime_participants) == len(bootstrap["validators"]) == 4, "BOOTSTRAP_RUNTIME_ROSTER")
    for expected, actual in zip(bootstrap["validators"], runtime_participants):
        for key in ("participantId", "hostId", "underlayIpv4", "fipsUla", "fipsNpub", "dkgIdentity", "signerIdentity"):
            require(expected[key] == actual[key], "BOOTSTRAP_RUNTIME_ROSTER:" + key)
    require(prerequisites["manifestDigest"] == runtime["manifestDigest"], "PREREQUISITE_MANIFEST")
    require(runtime["bindingDigest"] == plan["acceptedExistingInputs"]["runtimeBindingDigest"], "RUNTIME_DIGEST")
    require(prerequisites["ownerPublicKey"] == plan["acceptedExistingInputs"]["ownerApprovalPublicKey"], "OWNER_PUBLIC_KEY")
    require(genesis_decision["schema"] == "PLEBEIAN_SIDEQUEST_GENESIS_CONTENT_DECISION_V1", "GENESIS_DECISION_SCHEMA")
    require(genesis_decision["chainId"] == plan["acceptedExistingInputs"]["selectedChainId"], "GENESIS_DECISION_CHAIN")
    require(genesis_decision["canonicalGenesisTimeUtc"] is None, "GENESIS_DECISION_TIMESTAMP_PRESET")
    require(genesis_decision["canonicalGenesisTimePolicy"]["rule"] == plan["acceptedExistingInputs"]["canonicalGenesisTimePolicy"], "GENESIS_DECISION_TIME_POLICY")
    require(genesis_decision["authority"] == {
        "contentSelectionApproved": True,
        "timestampCaptureAuthorizedBeforeFreeze": False,
        "deploymentAnchorSigningApproved": False,
        "releaseInstallAuthorized": False,
        "unitInstallAuthorized": False,
        "configurationInstallAuthorized": False,
        "serviceActivationAuthorized": False,
        "dkgMustNotBeRepeated": True,
    }, "GENESIS_DECISION_AUTHORITY")
    require(decisions["selectedOwnerContent"] == {
        "chainId": genesis_decision["chainId"],
        "canonicalGenesisTimePolicy": genesis_decision["canonicalGenesisTimePolicy"]["rule"],
    }, "DECISIONS_GENESIS_CONTENT")
    validate_payment_projection(payment_projection, plan, bootstrap)
    require(payment_reconciliation["rawSha256"] == plan["acceptedExistingInputs"]["mintOnlyProjectionAcceptanceSha256"], "PAYMENT_RECONCILIATION_DIGEST")
    require(plan["acceptedExistingInputs"]["mintOnlyProjectionAccepted"] is True, "PAYMENT_MINT_ONLY_NOT_ACCEPTED")
    require(plan["acceptedExistingInputs"]["rawReceiptIndependentlyHashed"] is False, "PAYMENT_RAW_RECEIPT_HASH_OVERCLAIM")
    require(decisions["acceptedPaymentEvidence"]["mintOnlyAcceptancePath"] == plan["acceptedPublicSources"]["paymentReconciliation"]["path"], "PAYMENT_MINT_ONLY_ACCEPTANCE_PATH")
    require(decisions["acceptedPaymentEvidence"]["mintOnlyAcceptanceSha256"] == payment_reconciliation["rawSha256"], "PAYMENT_MINT_ONLY_ACCEPTANCE_DIGEST")
    ready, missing = readiness(decisions, payment_projection)

    args.output_root.mkdir(mode=0o755)
    outputs: dict[str, dict] = {}
    validator_by_id = {value["participantId"]: value for value in bootstrap["validators"]}
    for planned in plan["roles"]:
        role_name = planned["role"]
        participant_id = 0 if role_name == "APP" else planned["participantId"]
        role = "APPLICATION" if role_name == "APP" else "VALIDATOR_SIGNER"
        host = bootstrap["application"] if role_name == "APP" else validator_by_id[participant_id]
        app_value = application(bootstrap, role, participant_id)
        app_raw = canonical(app_value)
        env_raw = environment(app_value, runtime, prerequisites, decisions, ready, host)
        role_root = args.output_root / role_name
        role_root.mkdir(mode=0o755)
        app_path = role_root / "application.json"
        env_path = role_root / "friday.env"
        app_path.write_bytes(app_raw)
        env_path.write_bytes(env_raw)
        app_path.chmod(0o640)
        env_path.chmod(0o640)
        outputs[role_name] = {
            "application": {"bytes": len(app_raw), "sha256": digest(app_raw)},
            "environment": {"bytes": len(env_raw), "sha256": digest(env_raw)},
        }

    app_output = outputs["APP"]
    template = json.loads((args.plan.parent / "runtime-bindings.template.json").read_text(encoding="utf-8"))
    template["status"] = "READY_FOR_SCOPED_ACTIVATION" if ready else "BLOCKED_PENDING_OWNER_AND_PAYMENT_INPUTS"
    template["runtimeFiles"] = {
        "environment": {"path": str(CONFIG / "friday.env"), **app_output["environment"]},
        "application": {"path": str(CONFIG / "application.json"), **app_output["application"]},
    }
    payment = decisions["acceptedPaymentEvidence"]
    derived = decisions["derivedRuntimeOutputs"]
    template["requiredInputs"] = {
        "chainId": decisions["selectedOwnerContent"]["chainId"],
        "canonicalGenesisTimeUtc": decisions["deferredFreezeValue"]["canonicalGenesisTimeUtc"],
        "paymentConformanceReceiptPath": payment["paymentConformanceReceiptPath"],
        "paymentConformanceReceiptSha256": payment["paymentConformanceReceiptSha256"],
        "activeSatKeysetId": payment["activeSatKeysetId"],
        "reviewedTestMintTransportUrl": payment["reviewedTestMintTransportUrl"],
        **derived,
        "deploymentAnchorSigningApproved": decisions["authority"]["deploymentAnchorSigningApproved"],
        "serviceActivationApproved": decisions["authority"]["serviceActivationAuthorized"],
    }
    template["authority"] = {
        "remoteInstallAuthorized": decisions["authority"]["releaseInstallAuthorized"] and decisions["authority"]["unitInstallAuthorized"],
        "runtimeConfigInstallAuthorized": decisions["authority"]["configurationInstallAuthorized"],
        "serviceActivationAuthorized": decisions["authority"]["serviceActivationAuthorized"],
        "dkgMustNotBeRepeated": True,
    }
    bindings_raw = canonical(template)
    bindings_path = args.output_root / "APP/sidequest-runtime-bindings.json"
    bindings_path.write_bytes(bindings_raw)
    bindings_path.chmod(0o640)
    outputs["APP"]["runtimeBindings"] = {"bytes": len(bindings_raw), "sha256": digest(bindings_raw)}

    result = {
        "schema": "PLEBEIAN_SIDEQUEST_RUNTIME_CONFIG_RENDER_RESULT_V1",
        "status": "READY_FIXTURE_NOT_INSTALLED" if ready else "INERT_MISSING_INPUTS_NOT_INSTALLABLE",
        "ready": ready,
        "missing": missing,
        "roles": outputs,
        "remoteMutation": False,
        "dkgRepeated": False,
    }
    result_raw = canonical(result)
    (args.output_root / "RENDER-RESULT.json").write_bytes(result_raw)
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError, Stop) as error:
        print(json.dumps({"status": "STOPPED", "category": str(error)}, sort_keys=True, separators=(",", ":")))
        raise SystemExit(1)
