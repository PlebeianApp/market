#!/usr/bin/env python3
"""Exercise genuine public-input preparation without keys or assembly execution."""

from __future__ import annotations

import json
import hashlib
from pathlib import Path
import subprocess
import tempfile
import unittest


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
PLAN = HERE / "genesis-assembly-plan.json"
PREPARE = HERE / "prepare-genesis-assembly.py"
BINARY = ROOT / "dist/sidequest/plebeian-auctions-mvp"


class GenesisAssemblyPreparation(unittest.TestCase):
    def test_genuine_inputs_stop_before_private_descriptor_ceremony(self) -> None:
        with tempfile.TemporaryDirectory(prefix="sidequest-genesis-prep-", dir="/tmp") as temporary:
            bundle = Path(temporary) / "uncreated-bundle"
            completed = subprocess.run([
                "python3", "-I", "-S", "-B", str(PREPARE), "--plan", str(PLAN),
                "--bundle-root", str(bundle),
            ], check=False, capture_output=True, text=True)
            self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
            result = json.loads(completed.stdout)
            self.assertEqual(result["acceptedAnchorSha256"], "777e3df52fc4abcff952d27dc7399af99554cba2c4082211f909f5d8c9ecf1eb")
            self.assertEqual(result["status"], "BLOCKED_MISSING_PUBLIC_ASSEMBLY_INPUTS")
            self.assertEqual(result["missing"], [
                f"validatorDescriptors[{slot}] public descriptor not collected locally; remote state not reconciled"
                for slot in range(1, 5)
            ])
            self.assertIsNone(result["argv"])
            self.assertFalse(result["assemblerExecuted"])
            self.assertFalse(result["privateExecution"])
            self.assertFalse(result["remoteMutation"])
            self.assertFalse(bundle.exists())

            version = subprocess.run([str(BINARY), "version"], check=False, capture_output=True, text=True)
            self.assertEqual(version.returncode, 0, version.stdout + version.stderr)
            self.assertEqual(json.loads(version.stdout)["value_profile"], "FAKE_MONEY_ONLY")

            refused = subprocess.run([
                str(BINARY), "assemble-friday-comet", "--bundle", str(bundle),
            ], check=False, capture_output=True, text=True)
            self.assertNotEqual(refused.returncode, 0)
            self.assertIn("requires --bundle, four --validator-public paths", refused.stderr)
            self.assertFalse(bundle.exists())

    def test_public_source_drift_stops(self) -> None:
        plan = json.loads(PLAN.read_text(encoding="utf-8"))
        plan["acceptedPublicInputs"]["deploymentAnchor"]["sha256"] = "0" * 64
        with tempfile.TemporaryDirectory(prefix="sidequest-genesis-drift-", dir="/tmp") as temporary:
            plan_path = Path(temporary) / "plan.json"
            plan_path.write_text(json.dumps(plan), encoding="utf-8")
            stopped = subprocess.run([
                "python3", "-I", "-S", "-B", str(PREPARE), "--plan", str(plan_path),
            ], check=False, capture_output=True, text=True)
            self.assertNotEqual(stopped.returncode, 0)
            result = json.loads(stopped.stdout)
            self.assertTrue(result["category"].startswith("SOURCE_SHA256:"))

    def test_public_shape_reaches_only_the_go_cryptographic_gate(self) -> None:
        plan = json.loads(PLAN.read_text(encoding="utf-8"))
        anchor_sha256 = plan["acceptedPublicInputs"]["deploymentAnchor"]["sha256"]
        with tempfile.TemporaryDirectory(prefix="sidequest-genesis-public-", dir="/tmp") as temporary:
            base = Path(temporary)
            for record in plan["validatorDescriptors"]:
                slot = record["slot"]
                descriptor = {
                    "schema": "PLEBEIAN_FRIDAY_COMET_VALIDATOR_PUBLIC_V2",
                    "deployment_id": "friday-demo-20261030-separated-v1",
                    "chain_id": "plebeian-auctions-mvp-20261102",
                    "validator_roster_version": "genesis-v1",
                    "genesis_time": "2026-11-02T18:35:21Z",
                    "host_id": record["hostId"],
                    "deployment_anchor_sha256": anchor_sha256,
                    "validator_public_key": f"{slot:064x}",
                    "validator": {
                        "slot": slot,
                        "moniker": f"plebeian-friday-validator-{slot}",
                        "node_id": f"{slot:040x}",
                        "validator_address": f"{slot:040X}",
                        "p2p_listen": record["p2pExternal"],
                        "p2p_external": record["p2pExternal"],
                        "rpc_listen": "tcp://127.0.0.1:27657",
                    },
                    "descriptor_digest": f"{slot + 4:064x}",
                    "validator_signature": f"{slot + 8:0128x}",
                }
                raw = (json.dumps(descriptor, separators=(",", ":")) + "\n").encode()
                path = base / f"validator-{slot}-public.json"
                path.write_bytes(raw)
                record.update({
                    "path": str(path), "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(),
                    "localCollectionState": "COLLECTED_PUBLIC_ONLY",
                    "remoteGenerationState": "PUBLIC_DESCRIPTOR_PRESENT_PRIVATE_STATE_NOT_READ",
                })
            plan_path = base / "plan.json"
            plan_path.write_text(json.dumps(plan), encoding="utf-8")
            bundle = base / "uncreated-bundle"
            prepared = subprocess.run([
                "python3", "-I", "-S", "-B", str(PREPARE), "--plan", str(plan_path),
                "--bundle-root", str(bundle),
            ], check=False, capture_output=True, text=True)
            self.assertEqual(prepared.returncode, 0, prepared.stdout + prepared.stderr)
            result = json.loads(prepared.stdout)
            self.assertEqual(result["status"], "READY_FOR_SOLE_ASSEMBLER_VALIDATION_NOT_EXECUTED")
            self.assertEqual(result["missing"], [])
            self.assertEqual(result["descriptorCryptographicValidation"], "DEFERRED_TO_SOLE_GO_ASSEMBLER")
            self.assertFalse(result["assemblerExecuted"])
            self.assertFalse(bundle.exists())

            refused = subprocess.run(result["argv"], check=False, capture_output=True, text=True)
            self.assertNotEqual(refused.returncode, 0)
            self.assertFalse(bundle.exists())


if __name__ == "__main__":
    unittest.main()
