#!/usr/bin/env python3
"""Exercise genuine public-input preparation without keys or assembly execution."""

from __future__ import annotations

import json
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
            self.assertEqual(result["missing"], [f"validatorDescriptors[{slot}] public descriptor" for slot in range(1, 5)])
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


if __name__ == "__main__":
    unittest.main()
