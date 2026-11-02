#!/usr/bin/env python3
"""Execute the composed successor install and runtime gate in /tmp."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
import unittest


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
MANIFEST = HERE / "successor-install-manifest.json"
INSTALLER = HERE / "install-successor-release.py"
VERIFIER = HERE / "verify-successor-runtime.py"
TEMPLATE = HERE / "runtime-bindings.template.json"
OLD_RELEASE = Path("/home/maximoto/Documents/Codex/2026-10-30/task-4/site-mvp-inactive-app-install-r6-outcome-r1")
OLD_DERIVED = Path("/home/maximoto/Documents/Codex/2026-10-30/task-4/site-mvp-inactive-app-install-r1/deploy-derived")
OLD_BINARY = Path("/home/maximoto/Documents/Codex/2026-10-28/task-2/site-mvp-delivery-r1/plebeian-auctions-mvp")


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def write(path: Path, raw: bytes, mode: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw)
    path.chmod(mode)


def file_record(path: Path) -> dict:
    raw = path.read_bytes()
    return {"path": str(path), "bytes": len(raw), "sha256": digest(raw)}


class SuccessorReleaseFixture(unittest.TestCase):
    def test_composed_install_runtime_gate_and_replay_stop(self) -> None:
        manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory(prefix="sidequest-successor-", dir="/tmp") as temporary:
            fixture = Path(temporary) / "root"
            release_parent = fixture / "opt/plebeian-auctions-friday/releases"
            predecessor = release_parent / "separated-site-browser-r2/bin"
            unit_parent = fixture / "etc/systemd/system"
            receipt_parent = fixture / "var/lib/plebeian-auctions-friday/placement-receipts"
            release_parent.mkdir(parents=True, mode=0o755)
            predecessor.mkdir(parents=True, mode=0o755)
            unit_parent.mkdir(parents=True, mode=0o755)
            receipt_parent.mkdir(parents=True, mode=0o700)
            release_parent.chmod(0o755)
            unit_parent.chmod(0o755)
            receipt_parent.chmod(0o700)

            predecessor_sources = {
                "plebeian-auctions-mvp": OLD_BINARY,
                "verify-friday-separated-target.py": OLD_DERIVED / "verify-friday-separated-target.py",
                "verify-friday-runtime-target.py": OLD_DERIVED / "verify-friday-runtime-target.py",
            }
            for name, source in predecessor_sources.items():
                shutil.copyfile(source, predecessor / name)
                (predecessor / name).chmod(0o755)
            shutil.copyfile(OLD_DERIVED / "plebeian-friday-site.service", unit_parent / "plebeian-friday-site.service")
            (unit_parent / "plebeian-friday-site.service").chmod(0o644)

            command_log = Path(temporary) / "systemctl.log"
            fake_systemctl = Path(temporary) / "systemctl"
            fake_systemctl.write_text(
                "#!/bin/sh\n"
                f"printf '%s\\n' \"$*\" >> '{command_log}'\n"
                "if [ \"$1\" = show ]; then\n"
                "  if [ \"$2\" = plebeian-friday-fips.service ]; then\n"
                "    printf 'LoadState=loaded\\nActiveState=active\\nSubState=running\\nUnitFileState=static\\n'\n"
                "  else\n"
                "    printf 'LoadState=loaded\\nActiveState=inactive\\nSubState=dead\\nUnitFileState=static\\n'\n"
                "  fi\n"
                "  exit 0\n"
                "fi\n"
                "if [ \"$1\" = list-jobs ] || [ \"$1\" = daemon-reload ]; then exit 0; fi\n"
                "exit 64\n",
                encoding="utf-8",
            )
            fake_systemctl.chmod(0o755)
            fake_analyze = Path(temporary) / "systemd-analyze"
            fake_analyze.write_text("#!/bin/sh\n[ \"$1\" = verify ]\n", encoding="utf-8")
            fake_analyze.chmod(0o755)

            command = [
                "python3", "-I", "-S", "-B", str(INSTALLER),
                "--manifest", str(MANIFEST), "--source-root", str(ROOT),
                "--fixture-root", str(fixture),
                "--fixture-systemctl", str(fake_systemctl),
                "--fixture-systemd-analyze", str(fake_analyze),
            ]
            completed = subprocess.run(command, check=False, capture_output=True, text=True)
            self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
            result = json.loads(completed.stdout)
            self.assertEqual(result["status"], "PASS_INSTALLED_INACTIVE_NOT_ACTIVATED")
            self.assertFalse(result["serviceStartPerformed"])
            self.assertFalse(result["activationPerformed"])

            final_root = release_parent / "sidequest-mvp-r4"
            installed_binary = final_root / "bin/plebeian-auctions-mvp"
            self.assertEqual(digest(installed_binary.read_bytes()), manifest["artifacts"][0]["sha256"])
            self.assertEqual(stat.S_IMODE(installed_binary.stat().st_mode), 0o755)
            retained = unit_parent / ".plebeian-friday-site.pre-sidequest-mvp-r4.service"
            self.assertEqual(digest(retained.read_bytes()), manifest["expectedPredecessorUnit"]["sha256"])
            self.assertEqual(digest((unit_parent / "plebeian-friday-site.service").read_bytes()), manifest["unit"]["sha256"])
            receipt = receipt_parent / "sidequest-mvp-r4-inactive-install.json"
            self.assertTrue(receipt.is_file())
            before_replay = digest(receipt.read_bytes())

            for service in (
                "plebeian-friday-site.service",
                "plebeian-friday-authority.service",
                "plebeian-friday-coordinator.service",
            ):
                role_check = subprocess.run([
                    "python3", "-I", "-S", "-B", str(final_root / "bin/verify-friday-separated-target.py"),
                    "--environment", "/fixture/friday.env", "--application", "/fixture/application.json",
                    "--service", service, "--fixture-release-root", str(final_root),
                ], check=False, capture_output=True, text=True)
                self.assertEqual(role_check.returncode, 0, role_check.stdout + role_check.stderr)
                self.assertEqual(role_check.stdout.strip(), "SIDEQUEST_ROLE_TARGET=PASS")

            calls = command_log.read_text(encoding="utf-8")
            self.assertIn("daemon-reload", calls)
            self.assertNotIn(" start ", " " + calls + " ")
            self.assertNotIn(" enable ", " " + calls + " ")
            self.assertNotIn(" restart ", " " + calls + " ")
            self.assertNotIn(" stop ", " " + calls + " ")

            application_path = fixture / "etc/plebeian-auctions-friday/application.json"
            environment_path = fixture / "etc/plebeian-auctions-friday/friday.env"
            bindings_path = fixture / "etc/plebeian-auctions-friday/sidequest-runtime-bindings.json"
            application = {
                "schema": "PLEBEIAN_FRIDAY_SEPARATED_APPLICATION_V1",
                "role": "APPLICATION",
                "participant_id": 0,
                "deployment_id": "friday-demo-20261030-separated-v1",
                "application_ipv4": "139.162.161.233",
                "cashu_mint_url": "https://139.162.161.233",
                "site_port": 8180,
            }
            write(application_path, (json.dumps(application, sort_keys=True, separators=(",", ":")) + "\n").encode(), 0o640)
            pin = "1" * 64
            environment = "\n".join([
                f"FRIDAY_APPLICATION={application_path}",
                "FRIDAY_ROLE=APPLICATION",
                "FRIDAY_SITE_PORT=8180",
                f"FRIDAY_DEPLOYMENT_ANCHOR_SHA256={pin}",
                f"FRIDAY_NETWORK_FACTS_SHA256={pin}",
                f"POC_FRIDAY_BROWSER_PINS_SHA256={pin}",
                f"POC_FRIDAY_HEALTH_PINS_SHA256={pin}",
                f"FRIDAY_OBSERVER_RECEIPT_SHA256={pin}",
                "FRIDAY_OBSERVER_NODE_ID=0123456789abcdef0123456789abcdef01234567",
                "POC_FRIDAY_BROWSER_READY=true",
                "POC_FRIDAY_R20_CLOSE_TRIGGER=true",
                "POC_FRIDAY_RECOVERY_ONLY=false",
                "FRIDAY_NETWORK_ROOT=/var/lib/plebeian-auctions-friday/network-separated",
            ]) + "\n"
            write(environment_path, environment.encode(), 0o640)

            bindings = json.loads(TEMPLATE.read_text(encoding="utf-8"))
            bindings["status"] = "READY_FOR_SCOPED_ACTIVATION"
            bindings["runtimeFiles"] = {
                "environment": file_record(environment_path),
                "application": file_record(application_path),
            }
            bindings["requiredInputs"] = {
                "chainId": "sidequest-fixture-chain",
                "canonicalGenesisTimeUtc": "2026-11-03T00:00:00Z",
                "paymentConformanceReceiptPath": "/public/payment-receipt.json",
                "paymentConformanceReceiptSha256": pin,
                "activeSatKeysetId": "fixture-keyset",
                "testMintAssemblyUrl": "http://127.0.0.1:8180/test-mint",
                "deploymentAnchorSha256": pin,
                "networkFactsSha256": pin,
                "browserPinsSha256": pin,
                "healthPinsSha256": pin,
                "observerReceiptSha256": pin,
                "observerNodeId": "0123456789abcdef0123456789abcdef01234567",
                "deploymentAnchorSigningApproved": True,
                "serviceActivationApproved": True,
            }
            bindings["authority"] = {
                "remoteInstallAuthorized": True,
                "runtimeConfigInstallAuthorized": True,
                "serviceActivationAuthorized": True,
                "dkgMustNotBeRepeated": True,
            }
            write(bindings_path, (json.dumps(bindings, sort_keys=True, separators=(",", ":")) + "\n").encode(), 0o640)

            runtime_command = [
                "python3", "-I", "-S", "-B", str(final_root / "bin/verify-sidequest-runtime.py"),
                "--release-root", str(final_root), "--bindings", str(bindings_path),
                "--environment", str(environment_path), "--application", str(application_path),
                "--fixture-allow-current-owner",
            ]
            runtime = subprocess.run(runtime_command, check=False, capture_output=True, text=True)
            self.assertEqual(runtime.returncode, 0, runtime.stdout + runtime.stderr)
            self.assertEqual(runtime.stdout.strip(), "SIDEQUEST_RUNTIME=READY")

            blocked_bindings = fixture / "etc/plebeian-auctions-friday/blocked-runtime-bindings.json"
            write(blocked_bindings, TEMPLATE.read_bytes(), 0o640)
            blocked = subprocess.run([
                "python3", "-I", "-S", "-B", str(VERIFIER),
                "--release-root", str(final_root), "--bindings", str(blocked_bindings),
                "--environment", str(environment_path), "--application", str(application_path),
                "--fixture-allow-current-owner",
            ], check=False, capture_output=True, text=True)
            self.assertNotEqual(blocked.returncode, 0)
            self.assertIn("BINDINGS_NOT_READY", blocked.stdout)

            replay = subprocess.run(command, check=False, capture_output=True, text=True)
            self.assertNotEqual(replay.returncode, 0)
            self.assertIn("CONTROL_SLOT_OCCUPIED:finalRoot", replay.stdout)
            self.assertEqual(digest(receipt.read_bytes()), before_replay)


if __name__ == "__main__":
    unittest.main()
