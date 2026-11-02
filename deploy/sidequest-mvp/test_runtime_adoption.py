#!/usr/bin/env python3
"""Compose all five role releases and both inert/ready public configs locally."""

from __future__ import annotations

import importlib.util
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
PLAN = HERE / "runtime-adoption-plan.json"
DECISIONS = HERE / "owner-decisions.template.json"
RENDERER = HERE / "render-runtime-config.py"
ROLE_GUARD = HERE / "verify-sidequest-role-target.py"
BASE_GUARD = ROOT / "deploy/friday/separated/verify-friday-separated-target.py"
RUNTIME_GUARD = ROOT / "deploy/friday/verify-friday-runtime-target.py"


def parse_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if not separator or key in values:
            raise AssertionError("invalid environment fixture")
        values[key] = value
    return values


def file_digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            value.update(block)
    return value.hexdigest()


def load_guard():
    spec = importlib.util.spec_from_file_location("sidequest_base_guard", BASE_GUARD)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    module.PATHS = {
        **module.PATHS,
        "FRIDAY_TERMINAL_EXECUTOR_BIN": "/opt/plebeian-auctions-friday/releases/sidequest-mvp-r4/bin/plebeian-friday-terminal-executor",
    }
    module.verify_values.__globals__["PATHS"] = module.PATHS
    return module


class RuntimeAdoptionFixture(unittest.TestCase):
    def test_all_role_artifacts_and_configuration_rendering(self) -> None:
        plan = json.loads(PLAN.read_text(encoding="utf-8"))
        guard = load_guard()
        for artifact in plan["artifacts"].values():
            path = ROOT / artifact["sourcePath"]
            self.assertEqual((path.stat().st_size, file_digest(path)), (artifact["bytes"], artifact["sha256"]))
        for artifact in plan["releaseSupportArtifacts"]:
            path = ROOT / artifact["sourcePath"]
            self.assertEqual((path.stat().st_size, file_digest(path)), (artifact["bytes"], artifact["sha256"]))
        for role in plan["roles"]:
            for unit in role["successorUnits"]:
                path = ROOT / unit["sourcePath"]
                self.assertEqual((path.stat().st_size, file_digest(path)), (unit["bytes"], unit["sha256"]))
        with tempfile.TemporaryDirectory(prefix="sidequest-adoption-", dir="/tmp") as temporary:
            base = Path(temporary)
            releases = base / "releases"
            for role in plan["roles"]:
                role_root = releases / role["role"] / "sidequest-mvp-r4"
                bin_root = role_root / "bin"
                bin_root.mkdir(parents=True, mode=0o755)
                for artifact_name in role["artifacts"]:
                    artifact = plan["artifacts"][artifact_name]
                    destination = role_root / artifact["destination"]
                    shutil.copyfile(ROOT / artifact["sourcePath"], destination)
                    destination.chmod(int(artifact["mode"], 8))
                shutil.copyfile(ROLE_GUARD, bin_root / "verify-friday-separated-target.py")
                shutil.copyfile(BASE_GUARD, bin_root / "verify-friday-separated-base.py")
                shutil.copyfile(RUNTIME_GUARD, bin_root / "verify-friday-runtime-target.py")
                for path in bin_root.iterdir():
                    path.chmod(0o755)

                services = [value["service"] for value in role["successorUnits"]]
                for service in services:
                    completed = subprocess.run([
                        "python3", "-I", "-S", "-B", str(bin_root / "verify-friday-separated-target.py"),
                        "--environment", "/fixture/friday.env", "--application", "/fixture/application.json",
                        "--service", service, "--fixture-release-root", str(role_root),
                    ], check=False, capture_output=True, text=True)
                    self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
                    self.assertEqual(completed.stdout.strip(), "SIDEQUEST_ROLE_TARGET=PASS")

            inert_root = base / "inert"
            inert = subprocess.run([
                "python3", "-I", "-S", "-B", str(RENDERER), "--plan", str(PLAN),
                "--decisions", str(DECISIONS), "--output-root", str(inert_root),
            ], check=False, capture_output=True, text=True)
            self.assertEqual(inert.returncode, 0, inert.stdout + inert.stderr)
            inert_result = json.loads(inert.stdout)
            self.assertFalse(inert_result["ready"])
            self.assertEqual(inert_result["status"], "INERT_MISSING_INPUTS_NOT_INSTALLABLE")
            self.assertNotIn("selectedOwnerContent.chainId", inert_result["missing"])
            self.assertNotIn("frozenGenesisValue.canonicalGenesisTimeUtc", inert_result["missing"])
            self.assertFalse(any(value.startswith("acceptedPaymentEvidence.") for value in inert_result["missing"]))
            self.assertNotIn("acceptedExistingInputs.ownerApprovalPublicKey", inert_result["missing"])
            self.assertNotIn("derivedRuntimeOutputs.deploymentAnchorSha256", inert_result["missing"])
            self.assertEqual(parse_env(inert_root / "APP/friday.env")["POC_FRIDAY_BROWSER_READY"], "false")
            with self.assertRaises(ValueError):
                guard.verify_values(parse_env(inert_root / "APP/friday.env"), json.loads((inert_root / "APP/application.json").read_text()), "plebeian-friday-site.service")

            replay = subprocess.run([
                "python3", "-I", "-S", "-B", str(RENDERER), "--plan", str(PLAN),
                "--decisions", str(DECISIONS), "--output-root", str(inert_root),
            ], check=False, capture_output=True, text=True)
            self.assertNotEqual(replay.returncode, 0)
            self.assertIn("OUTPUT_ROOT_EXISTS", replay.stdout)

            decisions = json.loads(DECISIONS.read_text(encoding="utf-8"))
            pin = "1" * 64
            decisions["status"] = "FIXTURE_COMPLETE_NOT_AUTHORIZED"
            decisions["selectedOwnerContent"] = {
                "chainId": "plebeian-auctions-mvp-20261102",
                "canonicalGenesisTimePolicy": "CAPTURE_CURRENT_UTC_ONCE_AT_FINAL_SIGNING_INPUT_FREEZE",
            }
            decisions["derivedRuntimeOutputs"] = {
                "deploymentAnchorSha256": plan["acceptedExistingInputs"]["signedDeploymentAnchorSha256"],
                "networkFactsSha256": pin,
                "browserPinsSha256": pin,
                "healthPinsSha256": pin,
                "observerReceiptSha256": pin,
                "observerNodeId": "2" * 40,
            }
            decisions["authority"] = {key: True for key in decisions["authority"]}
            ready_decisions = base / "fixture-decisions.json"
            ready_decisions.write_text(json.dumps(decisions, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
            ready_root = base / "ready"
            ready = subprocess.run([
                "python3", "-I", "-S", "-B", str(RENDERER), "--plan", str(PLAN),
                "--decisions", str(ready_decisions), "--output-root", str(ready_root),
            ], check=False, capture_output=True, text=True)
            self.assertEqual(ready.returncode, 0, ready.stdout + ready.stderr)
            ready_result = json.loads(ready.stdout)
            self.assertTrue(ready_result["ready"])
            self.assertEqual(ready_result["missing"], [])
            self.assertEqual(json.loads((ready_root / "APP/sidequest-runtime-bindings.json").read_text())["status"], "READY_FOR_SCOPED_ACTIVATION")

            app_services = ("site", "authority", "coordinator")
            for role in plan["roles"]:
                env = parse_env(ready_root / role["role"] / "friday.env")
                app = json.loads((ready_root / role["role"] / "application.json").read_text())
                services = app_services if role["role"] == "APP" else ("signer",)
                for service in services:
                    self.assertEqual(guard.verify_values(env, app, f"plebeian-friday-{service}.service"), service)
            self.assertEqual(parse_env(ready_root / "APP/friday.env")["POC_FRIDAY_BROWSER_READY"], "true")
            for role in ("V1", "V2", "V3", "V4"):
                self.assertEqual(parse_env(ready_root / role / "friday.env")["POC_FRIDAY_BROWSER_READY"], "false")


if __name__ == "__main__":
    unittest.main()
