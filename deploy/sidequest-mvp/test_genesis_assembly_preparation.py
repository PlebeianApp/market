#!/usr/bin/env python3
"""Exercise genuine public-only assembly preparation and deterministic output."""

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
    def test_genuine_inputs_render_exact_sole_assembler_argv(self) -> None:
        with tempfile.TemporaryDirectory(prefix="sidequest-genesis-prep-", dir="/tmp") as temporary:
            bundle = Path(temporary) / "uncreated-bundle"
            completed = subprocess.run([
                "python3", "-I", "-S", "-B", str(PREPARE), "--plan", str(PLAN),
                "--bundle-root", str(bundle),
            ], check=False, capture_output=True, text=True)
            self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
            result = json.loads(completed.stdout)
            self.assertEqual(result["acceptedAnchorSha256"], "777e3df52fc4abcff952d27dc7399af99554cba2c4082211f909f5d8c9ecf1eb")
            self.assertEqual(result["status"], "READY_FOR_SOLE_ASSEMBLER_VALIDATION_NOT_EXECUTED")
            self.assertEqual(result["missing"], [])
            self.assertIsNotNone(result["argv"])
            self.assertEqual(result["argv"].count("--validator-public"), 4)
            self.assertFalse(result["assemblerExecuted"])
            self.assertFalse(result["privateExecution"])
            self.assertFalse(result["remoteMutation"])
            self.assertFalse(bundle.exists())

            version = subprocess.run([str(BINARY), "version"], check=False, capture_output=True, text=True)
            self.assertEqual(version.returncode, 0, version.stdout + version.stderr)
            self.assertEqual(json.loads(version.stdout)["value_profile"], "FAKE_MONEY_ONLY")

            assembled = subprocess.run(result["argv"], check=False, capture_output=True, text=True)
            self.assertEqual(assembled.returncode, 0, assembled.stdout + assembled.stderr)
            receipt = json.loads(assembled.stdout)
            self.assertEqual(receipt["bundle_digest"], "830b87e49bf4ef0ee66664b9b757344a8c9ae8a582473fe28351e8571a7180cf")
            self.assertEqual(receipt["genesis_file_sha256"], "8574fadb77fafea9c56fff7cff32af0205be7b2e05d12f1ab1fcf4a1a8f3a4ea")
            self.assertEqual(receipt["network_facts_sha256"], "0dd62cc5270f9e007851ed5c892a7386e2cdf620f8b7e1958fe84019ebe594a5")
            self.assertEqual({path.name for path in bundle.iterdir()}, {
                "genesis.json", "network.json", "network-facts.json", "validator-roster.json",
                "deployment-anchor.json", "frost-final-public.json", "funding-abort-bootstrap.json",
                "separated-runtime-binding.json", "comet-genesis-bundle.json",
            })

            facts = subprocess.run([
                str(BINARY), "network-facts", "--home", str(bundle),
            ], check=False, capture_output=True, text=True)
            self.assertEqual(facts.returncode, 0, facts.stdout + facts.stderr)
            self.assertEqual(json.loads(facts.stdout)["validators_hash"], receipt["validators_hash"])

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

    def test_descriptor_substitution_stops_at_accepted_handoff(self) -> None:
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
            self.assertNotEqual(prepared.returncode, 0)
            result = json.loads(prepared.stdout)
            self.assertEqual(result["category"], "DESCRIPTOR_HANDOFF_RECORD")
            self.assertFalse(bundle.exists())


if __name__ == "__main__":
    unittest.main()
