#!/usr/bin/env python3
"""Validate public inputs and render, but never execute, the sole assembler argv."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re


class Stop(RuntimeError):
    pass


def require(value: bool, category: str) -> None:
    if not value:
        raise Stop(category)


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def load_source(record: dict) -> tuple[bytes, dict | None]:
    path = Path(record["path"])
    raw = path.read_bytes()
    require(len(raw) == record["bytes"], "SOURCE_BYTES:" + str(path))
    require(digest(raw) == record["sha256"], "SOURCE_SHA256:" + str(path))
    return raw, json.loads(raw) if path.suffix == ".json" else None


def descriptor_shape(value: dict, expected: dict, anchor: dict, anchor_sha256: str) -> None:
    require(set(value) == {
        "schema", "deployment_id", "chain_id", "validator_roster_version", "genesis_time",
        "host_id", "deployment_anchor_sha256", "validator_public_key", "validator",
        "descriptor_digest", "validator_signature",
    }, "DESCRIPTOR_FIELDS")
    require(value.get("schema") == "PLEBEIAN_FRIDAY_COMET_VALIDATOR_PUBLIC_V2", "DESCRIPTOR_SCHEMA")
    require(value.get("deployment_id") == anchor["deployment_id"], "DESCRIPTOR_DEPLOYMENT")
    require(value.get("chain_id") == anchor["chain_id"], "DESCRIPTOR_CHAIN")
    require(value.get("genesis_time") == anchor["genesis_time"], "DESCRIPTOR_TIME")
    require(value.get("validator_roster_version") == "genesis-v1", "DESCRIPTOR_ROSTER_VERSION")
    require(value.get("host_id") == expected["hostId"], "DESCRIPTOR_HOST")
    require(value.get("deployment_anchor_sha256") == anchor_sha256, "DESCRIPTOR_ANCHOR")
    validator = value.get("validator", {})
    require(set(validator) == {
        "slot", "moniker", "node_id", "validator_address", "p2p_listen", "p2p_external", "rpc_listen",
    }, "DESCRIPTOR_VALIDATOR_FIELDS")
    require(validator.get("slot") == expected["slot"], "DESCRIPTOR_SLOT")
    require(validator.get("moniker") == f"plebeian-friday-validator-{expected['slot']}", "DESCRIPTOR_MONIKER")
    require(validator.get("p2p_external") == expected["p2pExternal"], "DESCRIPTOR_P2P_EXTERNAL")
    require(validator.get("p2p_listen") == expected["p2pExternal"], "DESCRIPTOR_P2P_LISTEN")
    require(validator.get("rpc_listen") == "tcp://127.0.0.1:27657", "DESCRIPTOR_RPC")
    require(bool(re.fullmatch(r"[0-9a-f]{40}", validator.get("node_id", ""))), "DESCRIPTOR_NODE_ID")
    require(bool(re.fullmatch(r"[0-9A-F]{40}", validator.get("validator_address", ""))), "DESCRIPTOR_VALIDATOR_ADDRESS")
    require(bool(re.fullmatch(r"[0-9a-f]{64}", value.get("validator_public_key", ""))), "DESCRIPTOR_PUBLIC_KEY")
    require(bool(re.fullmatch(r"[0-9a-f]{64}", value.get("descriptor_digest", ""))), "DESCRIPTOR_DIGEST")
    require(bool(re.fullmatch(r"[0-9a-f]{128}", value.get("validator_signature", ""))), "DESCRIPTOR_SIGNATURE_SHAPE")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--bundle-root", type=Path)
    args = parser.parse_args()
    plan = json.loads(args.plan.read_text(encoding="utf-8"))
    require(plan["schema"] == "PLEBEIAN_SIDEQUEST_GENESIS_ASSEMBLY_PREPARATION_V1", "PLAN_SCHEMA")
    require(plan["status"] == "PREPARATION_ONLY_NOT_EXECUTED", "PLAN_STATUS")
    require(plan["purpose"] == "PUBLIC_INPUT_VALIDATION_AND_SOLE_ASSEMBLER_INVOCATION_RENDERING_ONLY", "PLAN_PURPOSE")
    require(plan["boundaries"] == {
        "generatesValidatorKeys": False,
        "readsPrivateValidatorState": False,
        "readsOwnerPrivateKey": False,
        "executesAssembler": False,
        "remoteMutation": False,
        "serviceMutation": False,
        "dkgRepeated": False,
        "historicalControllerStopPreserved": True,
        "rerenderOrResign": False,
    }, "PLAN_BOUNDARIES")
    require(plan["descriptorContract"] == {
        "schema": "PLEBEIAN_FRIDAY_COMET_VALIDATOR_PUBLIC_V2",
        "signingDomain": "PLEBEIAN_FRIDAY_COMET_VALIDATOR_DESCRIPTOR_V2",
        "rosterVersion": "genesis-v1",
        "initializerImplementation": "internal/poc/friday_comet_init.go:InitFridayCometValidator",
        "initializerCommand": "dist/sidequest/plebeian-auctions-mvp init-friday-comet-validator",
        "initializerArgvTemplate": [
            "dist/sidequest/plebeian-auctions-mvp", "init-friday-comet-validator",
            "--home", "%FRESH_VALIDATOR_HOME%",
            "--deployment-anchor", "%ACCEPTED_DEPLOYMENT_ANCHOR_PATH_ON_HOST%",
            "--owner-approval-public-key", "3210f99b78ecd0150b6a0efcaffc6f3b532f4e5a3d68f977e77a3b8d10febade",
            "--slot", "%SLOT%",
        ],
        "initializerRequiresFreshAbsoluteHome": True,
        "publicExportRelativePath": "validator-public.json",
        "publicExportMode": "0644",
        "authoritativeCollectedArtifact": "%FRESH_VALIDATOR_HOME%/validator-public.json",
        "privateFilesNeverExport": [
            "validator-{slot}/config/node_key.json",
            "validator-{slot}/config/priv_validator_key.json",
            "validator-{slot}/data/priv_validator_state.json",
        ],
        "consumerImplementation": "internal/poc/friday_comet_init.go:publicDescriptors",
        "consumerStrictUnknownFieldRejection": True,
        "consumerCryptographicValidation": "SOLE_GO_ASSEMBLER_ONLY",
        "collectionState": "FOUR_ACCEPTED_PUBLIC_DESCRIPTORS_COLLECTED",
        "remoteCredentialStateClaim": "PUBLIC_OUTPUTS_ACCEPTED_PRIVATE_STATE_NOT_READ_OR_RECONCILED",
        "collectedLocalState": "COLLECTED_PUBLIC_ONLY",
        "collectedRemoteState": "PUBLIC_DESCRIPTOR_PRESENT_PRIVATE_STATE_NOT_READ",
    }, "DESCRIPTOR_CONTRACT")

    sources: dict[str, dict | None] = {}
    for name, record in plan["acceptedPublicInputs"].items():
        _, sources[name] = load_source(record)
    anchor = sources["deploymentAnchor"]
    dkg = sources["authenticatedDkgResult"]
    funding = sources["fundingAbortBootstrap"]
    runtime = sources["separatedRuntimeBinding"]
    reconciliation = sources["publicAnchorReconciliation"]
    descriptor_final = sources["validatorDescriptorFinal"]
    descriptor_handoff = sources["validatorDescriptorHandoff"]
    require(all(value is not None for value in (anchor, dkg, funding, runtime, reconciliation, descriptor_final, descriptor_handoff)), "PUBLIC_JSON_SOURCE")
    assembly = plan["assemblyInputs"]
    anchor_sha256 = plan["acceptedPublicInputs"]["deploymentAnchor"]["sha256"]
    require(dkg == runtime["result"], "DKG_RUNTIME_BINDING")
    require(anchor["frost_final_package_sha256"] == plan["acceptedPublicInputs"]["authenticatedDkgResult"]["sha256"], "ANCHOR_DKG")
    require(anchor["funding_abort_bootstrap_sha256"] == plan["acceptedPublicInputs"]["fundingAbortBootstrap"]["sha256"], "ANCHOR_FUNDING_BOOTSTRAP")
    require(anchor["separated_runtime_binding_sha256"] == plan["acceptedPublicInputs"]["separatedRuntimeBinding"]["sha256"], "ANCHOR_RUNTIME")
    require(anchor["chain_id"] == assembly["chainId"] and anchor["genesis_time"] == assembly["genesisTimeUtc"], "ASSEMBLY_CHAIN_TIME")
    require(anchor["owner_approval_public_key"] == assembly["ownerApprovalPublicKey"], "ASSEMBLY_OWNER")
    require(anchor["separated_mint_origin"] == assembly["cashuMintUrl"], "ASSEMBLY_CASHU_MINT")
    require(assembly["testMintUrl"] == "http://127.0.0.1:8180/test-mint", "ASSEMBLY_TEST_MINT")
    require(assembly["fakeFundingMaxPerRequest"] == 10000 and assembly["fakeFundingMaxResultingBalance"] == 50000, "ASSEMBLY_FUNDING_POLICY")
    require(funding["activeKeysetId"] == anchor["active_keyset_id"], "FUNDING_KEYSET")
    require(funding["dkgRunId"] == dkg["dkgRunId"] and funding["signerRosterDigest"] == dkg["signerRosterDigest"], "FUNDING_DKG")
    require(reconciliation["historicalAttemptStatusUnchanged"] == "STOP_NO_RETRY_PRESERVE_ALL_STATE", "RECONCILIATION_STOP")
    require(reconciliation["newSignatureOrRendererRun"] is False and reconciliation["privateSeedReadOrStat"] is False, "RECONCILIATION_PRIVATE_SCOPE")
    require(reconciliation["genesisOrRemoteOrActivation"] is False, "RECONCILIATION_EXECUTION_SCOPE")
    require(reconciliation["publicResult"]["deploymentAnchorSha256"] == anchor_sha256, "RECONCILIATION_ANCHOR")
    require(descriptor_final == {
        "actionSha256": "85a092c341832ea7185f5ed261767fb71b7d23c27a5f170836e17d376d09cd0f",
        "anchorSha256": anchor_sha256,
        "genesisAssembled": False,
        "ownershipHandoffPerformed": False,
        "privateContentsExported": False,
        "retry": False,
        "roles": ["V1", "V2", "V3", "V4"],
        "schema": "COMET_INIT_FINAL_V1",
        "servicesStarted": False,
        "status": "FOUR_COMET_PUBLIC_DESCRIPTORS_VERIFIED_REQUIRES_INDEPENDENT_REVIEW",
    }, "DESCRIPTOR_FINAL")
    require(plan["acceptedPublicInputs"]["validatorDescriptorReview"]["sha256"] == "8cfa01ca5a75fab9b4c267620cf50db4ab4e2db256caa87d56d2202e350c5b48", "DESCRIPTOR_REVIEW")
    require(descriptor_handoff["schema"] == "COMET_R2_PUBLIC_DESCRIPTOR_SINGLE_ASSEMBLER_HANDOFF_V1", "DESCRIPTOR_HANDOFF_SCHEMA")
    require(descriptor_handoff["remoteOrPrivateActionExecuted"] is False, "DESCRIPTOR_HANDOFF_SCOPE")
    require(descriptor_handoff["frozenContent"] == {
        "cashuMintIdentity": assembly["cashuMintUrl"],
        "chainId": assembly["chainId"],
        "exactSigningMessageBytes": 2077,
        "exactSigningMessageSha256": "757b4855ed30d05d474636f60ecfa4e8388ef841ba27b39fb83c127e4f0c4d6b",
        "fakeFundingAdvisoryMaxResultingBalance": assembly["fakeFundingMaxResultingBalance"],
        "fakeFundingMaxPerRequest": assembly["fakeFundingMaxPerRequest"],
        "genesisTimeUtc": assembly["genesisTimeUtc"],
        "legacyGoIdentityNamespaceTestMintUrl": assembly["testMintUrl"],
        "mintFipsTransportOrigin": "http://[fdb2:77a9:c591:3ac6:3513:5bf8:cc3b:5a04]:3438",
        "ownerPublicKey": assembly["ownerApprovalPublicKey"],
    }, "DESCRIPTOR_HANDOFF_FROZEN_CONTENT")
    handoff_descriptors = descriptor_handoff["validatorDescriptors"]
    require(len(handoff_descriptors) == len(plan["validatorDescriptors"]) == 4, "DESCRIPTOR_HANDOFF_COUNT")
    for planned, handed in zip(plan["validatorDescriptors"], handoff_descriptors):
        require((planned["slot"], planned["path"], planned["bytes"], planned["sha256"]) ==
                (handed["slot"], handed["path"], handed["bytes"], handed["sha256"]), "DESCRIPTOR_HANDOFF_RECORD")

    assembler = plan["soleAssembler"]
    repo = Path(__file__).resolve().parents[2]
    binary = repo / assembler["command"]
    binary_raw = binary.read_bytes()
    require(len(binary_raw) == assembler["bytes"] and digest(binary_raw) == assembler["sha256"], "SOLE_ASSEMBLER_BINARY")
    require(assembler["implementation"] == "internal/poc/friday_comet_init.go:AssembleFridayCometGenesis", "SOLE_ASSEMBLER_IMPLEMENTATION")
    require(assembler["subcommand"] == "assemble-friday-comet" and assembler["executionPerformed"] is False, "SOLE_ASSEMBLER_SCOPE")

    missing: list[str] = []
    descriptor_paths: list[str] = []
    require(len(plan["validatorDescriptors"]) == len(anchor["roster"]) == 4, "DESCRIPTOR_COUNT")
    for expected, roster in zip(plan["validatorDescriptors"], anchor["roster"]):
        require((expected["slot"], expected["hostId"], expected["fipsUla"]) == (roster["slot"], roster["host_id"], roster["fips_ula"]), "DESCRIPTOR_ROSTER")
        if expected["path"] is None or expected["bytes"] is None or expected["sha256"] is None:
            require(expected["localCollectionState"] == "NOT_COLLECTED" and expected["remoteGenerationState"] == "NOT_RECONCILED_NO_CLAIM", "DESCRIPTOR_COLLECTION_STATE")
            missing.append(f"validatorDescriptors[{expected['slot']}] public descriptor not collected locally; remote state not reconciled")
            continue
        require(expected["localCollectionState"] == "COLLECTED_PUBLIC_ONLY" and expected["remoteGenerationState"] == "PUBLIC_DESCRIPTOR_PRESENT_PRIVATE_STATE_NOT_READ", "DESCRIPTOR_COLLECTION_STATE")
        _, descriptor = load_source(expected)
        require(descriptor is not None, "DESCRIPTOR_JSON")
        descriptor_shape(descriptor, expected, anchor, anchor_sha256)
        descriptor_paths.append(expected["path"])

    bundle = args.bundle_root if args.bundle_root is not None else (Path(assembly["bundleRoot"]) if assembly["bundleRoot"] else None)
    if bundle is None:
        missing.append("fresh absolute bundle root")
    else:
        require(bundle.is_absolute() and bundle != Path("/"), "BUNDLE_ROOT")
        require(not bundle.exists() and not bundle.is_symlink(), "BUNDLE_ROOT_EXISTS")

    argv = None
    if not missing:
        argv = [str(binary), assembler["subcommand"], "--bundle", str(bundle)]
        for path in descriptor_paths:
            argv.extend(["--validator-public", path])
        argv.extend([
            "--deployment-anchor", plan["acceptedPublicInputs"]["deploymentAnchor"]["path"],
            "--frost-final-public", plan["acceptedPublicInputs"]["authenticatedDkgResult"]["path"],
            "--funding-abort-bootstrap", plan["acceptedPublicInputs"]["fundingAbortBootstrap"]["path"],
            "--owner-approval-public-key", assembly["ownerApprovalPublicKey"],
            "--test-mint-url", assembly["testMintUrl"],
            "--cashu-mint-url", assembly["cashuMintUrl"],
            "--separated-runtime-binding", plan["acceptedPublicInputs"]["separatedRuntimeBinding"]["path"],
            "--fake-funding-max-per-request", str(assembly["fakeFundingMaxPerRequest"]),
            "--fake-funding-max-resulting-balance", str(assembly["fakeFundingMaxResultingBalance"]),
        ])
    result = {
        "schema": "PLEBEIAN_SIDEQUEST_GENESIS_ASSEMBLY_PREPARATION_RESULT_V1",
        "status": "READY_FOR_SOLE_ASSEMBLER_VALIDATION_NOT_EXECUTED" if argv else "BLOCKED_MISSING_PUBLIC_ASSEMBLY_INPUTS",
        "acceptedAnchorSha256": anchor_sha256,
        "historicalControllerStopPreserved": True,
        "missing": missing,
        "argv": argv,
        "assemblerExecuted": False,
        "privateExecution": False,
        "remoteMutation": False,
        "descriptorCryptographicValidation": "DEFERRED_TO_SOLE_GO_ASSEMBLER" if argv else "NOT_APPLICABLE_UNTIL_DESCRIPTORS_EXIST",
    }
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError, Stop) as error:
        print(json.dumps({"status": "STOPPED", "category": str(error)}, sort_keys=True, separators=(",", ":")))
        raise SystemExit(1)
