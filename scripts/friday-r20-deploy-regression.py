#!/usr/bin/python3
"""Offline checks for the inert R20 service and acceptance templates."""

from __future__ import annotations

import json
import re
import runpy
import os
import stat
import subprocess
import tempfile
from unittest import mock
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
DEPLOY = ROOT / "deploy/friday"
R20 = DEPLOY / "r20"
RELEASE = "/opt/plebeian-auctions-friday/releases/r20-deploy-v1"


def environment() -> dict[str, str]:
    result: dict[str, str] = {}
    for raw in (R20 / "friday.env.example").read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line and not line.startswith("#"):
            name, value = line.split("=", 1)
            if name in {"FRIDAY_DKG_MANIFEST_DIGEST", "FRIDAY_R20_MANIFEST_BINDING_DIGEST",
                        "FRIDAY_R20_RUNTIME_BINDING_DIGEST", "POC_FRIDAY_BROWSER_PINS_SHA256", "POC_FRIDAY_HEALTH_PINS_SHA256"}:
                value = "00" * 32
            result[name] = "2" if name == "FRIDAY_SLOT" else value
    return result


def application() -> dict[str, object]:
    raw = (R20 / "application.json.example").read_text(encoding="utf-8")
    raw = raw.replace("%FRIDAY_APPLICATION_HOST_SLOT%", "2")
    raw = re.sub(r"%FRIDAY_[A-Z0-9_]+%", "test-only-public-value", raw)
    return json.loads(raw)


def legacy_environment() -> dict[str, str]:
    result: dict[str, str] = {}
    for raw in (DEPLOY / "friday.env.example").read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line and not line.startswith("#"):
            name, value = line.split("=", 1)
            if name == "FRIDAY_DKG_MANIFEST_DIGEST":
                value = "00" * 32
            result[name] = value
    return result


def legacy_application() -> dict[str, object]:
    raw = (DEPLOY / "application.json.example").read_text(encoding="utf-8")
    raw = raw.replace("%FRIDAY_APPLICATION_HOST_SLOT%", "2")
    raw = re.sub(r"%FRIDAY_[A-Z0-9_]+%", "test-only-public-value", raw)
    return json.loads(raw)


class FridayR20DeployRegression(unittest.TestCase):
    def test_r20_manifest_and_environment_are_exact_and_disjoint(self) -> None:
        guard = runpy.run_path(str(DEPLOY / "verify-friday-runtime-target.py"))
        guard["verify_environment_values"](environment())
        guard["verify_application_values"](application())
        guard["verify_environment_application_pairing"](environment(), application())
        self.assertEqual(application()["schema"], "PLEBEIAN_FRIDAY_LIVE_APPLICATION_V3")
        self.assertEqual(application()["dkg_root"], "/var/lib/plebeian-auctions-friday/frost-v2/keyset-v2")
        self.assertNotIn("plebeian-auctions-poc", json.dumps(application()))

    def test_health_pin_is_independent_and_required_in_r20_environment(self) -> None:
        guard = runpy.run_path(str(DEPLOY / "verify-friday-runtime-target.py"))
        values = environment()
        self.assertEqual(values["POC_FRIDAY_HEALTH_PINS_SHA256"], "00" * 32)
        for invalid in ("", "not-a-digest", "A" * 64):
            changed = dict(values, POC_FRIDAY_HEALTH_PINS_SHA256=invalid)
            with self.assertRaises(ValueError):
                guard["verify_environment_values"](changed)
        del values["POC_FRIDAY_HEALTH_PINS_SHA256"]
        with self.assertRaises(ValueError):
            guard["verify_environment_values"](values)

    def test_runtime_guard_rejects_both_mixed_generation_directions(self) -> None:
        guard = runpy.run_path(str(DEPLOY / "verify-friday-runtime-target.py"))
        pair = guard["verify_environment_application_pairing"]
        pair(legacy_environment(), legacy_application())
        pair(environment(), application())
        with self.assertRaisesRegex(ValueError, "generations differ"):
            pair(environment(), legacy_application())
        with self.assertRaisesRegex(ValueError, "generations differ"):
            pair(legacy_environment(), application())

    def test_runtime_guard_pairs_every_service_with_its_exact_generation(self) -> None:
        guard = runpy.run_path(str(DEPLOY / "verify-friday-runtime-target.py"))
        pair = guard["verify_environment_application_pairing"]
        required_paths = guard["_required_service_paths"]
        for service in guard["ALLOWED_SERVICES"]:
            for values, manifest, expected_root in (
                (legacy_environment(), legacy_application(), "/var/lib/plebeian-auctions-friday/network"),
                (environment(), application(), "/var/lib/plebeian-auctions-friday/network-r20"),
            ):
                with self.subTest(service=service, schema=manifest["schema"]):
                    pair(values, manifest)
                    paths = {path for path, _ in required_paths(values, manifest, service)}
                    if service in {
                        "plebeian-friday-validator.service",
                        "plebeian-friday-signer.service",
                        "plebeian-friday-site.service",
                    }:
                        self.assertIn(expected_root, paths)
                    if service == "plebeian-friday-signer.service" and manifest["schema"].endswith("V3"):
                        for name in ("FRIDAY_R20_PROFILE", "FRIDAY_R20_PREDECESSOR_MANIFEST",
                                     "FRIDAY_R20_MANIFEST", "FRIDAY_R20_MANIFEST_DIGEST",
                                     "FRIDAY_R20_BOUND_MANIFEST"):
                            self.assertIn(values[name], paths)

    def test_r20_refuses_v1_paths_and_changed_identity(self) -> None:
        guard = runpy.run_path(str(DEPLOY / "verify-friday-runtime-target.py"))
        changed = application()
        changed["dkg_root"] = "/var/lib/plebeian-auctions-friday/frost/keyset-v1"
        with self.assertRaisesRegex(ValueError, "exact Friday target"):
            guard["verify_application_values"](changed)
        changed = application()
        changed["deployment_id"] = "friday-demo-20261023-r14"
        with self.assertRaisesRegex(ValueError, "identity is not exact"):
            guard["verify_application_values"](changed)

    def test_r20_units_are_inert_and_bind_fresh_paths(self) -> None:
        signer = (R20 / "plebeian-friday-signer.service").read_text(encoding="utf-8")
        coordinator = (R20 / "plebeian-friday-coordinator.service").read_text(encoding="utf-8")
        authority = (R20 / "plebeian-friday-authority.service").read_text(encoding="utf-8")
        for required in ("--r20-profile", "--r20-predecessor-manifest", "--r20-bound-manifest",
                         "--expected-r20-manifest-binding-digest", "--expected-r20-runtime-binding-digest"):
            self.assertIn(required, signer)
        self.assertIn("coordinator-v2", coordinator + authority)
        self.assertIn("anchor-r20", coordinator + authority)
        units = [path.read_text(encoding="utf-8") for path in sorted(R20.glob("*.service"))]
        self.assertEqual(len(units), 7)
        for text in units:
            self.assertIn("NoNewPrivileges=yes", text)
            self.assertNotIn("/opt/plebeian-auctions-poc", text)
            self.assertNotIn("WantedBy=", text)
            self.assertIn(f"{RELEASE}/bin/verify-friday-runtime-target.py", text)
        for text in units:
            if "cashu.mint" not in text:
                self.assertRegex(text, re.escape(RELEASE) + r"/bin/(?:fips|plebeian-)")
        validator = (R20 / "plebeian-friday-validator.service").read_text(encoding="utf-8")
        self.assertIn("ReadWritePaths=/var/lib/plebeian-auctions-friday/network-r20", validator)
        self.assertNotIn("ReadWritePaths=/var/lib/plebeian-auctions-friday\n", validator)
        mint = (R20 / "plebeian-friday-mint.service").read_text(encoding="utf-8")
        self.assertIn("UMask=0077", mint)

    def test_r20_release_paths_are_fixed_and_never_current(self) -> None:
        values = environment()
        self.assertEqual(values["FRIDAY_PARTICIPANT_BIN"],
                         f"{RELEASE}/bin/coco-demo-frost-participant-3of4")
        self.assertEqual(values["FRIDAY_TERMINAL_EXECUTOR_BIN"],
                         f"{RELEASE}/bin/plebeian-friday-terminal-executor")
        guard = runpy.run_path(str(DEPLOY / "verify-friday-runtime-target.py"))
        for service in guard["ALLOWED_SERVICES"]:
            paths = {path for path, _ in guard["_required_service_paths"](
                values, application(), service)}
            executable = guard["R20_SERVICE_EXECUTABLES"][service]
            self.assertIn(executable, paths)
            if service != "plebeian-friday-mint.service":
                self.assertTrue(executable.startswith(f"{RELEASE}/bin/"))
        all_text = "\n".join(path.read_text(encoding="utf-8") for path in R20.iterdir()
                             if path.is_file())
        self.assertNotIn("/current/", all_text)

    def test_active_r20_typescript_paths_match_the_staging_layout(self) -> None:
        source = ROOT / "cashu-wrapper/ts"
        contract = (source / "demo-friday-r20-path-contract.ts").read_text(encoding="utf-8")
        for basename in (
            "plebeian-friday-r20-permission-seal", "coco-demo-frost-participant-3of4",
            "coco-demo-frost-public-inspect", "plebeian-friday-comet-probe",
            "plebeian-friday-terminal-executor", "plebeian-friday-r20-acceptance-operator",
        ):
            self.assertIn(basename, contract)
        self.assertIn(RELEASE, contract)
        active = "\n".join((source / name).read_text(encoding="utf-8") for name in (
            "demo-friday-r20-r18-permission-seal-cli.ts", "demo-friday-r20-host-stage.ts",
            "demo-friday-authority-cli.ts", "demo-friday-r20-courier-cli.ts",
            "demo-friday-r20-browser-acceptance-composition.ts",
        ))
        self.assertNotIn("r20-r7-abort-integrationfix", active)
        self.assertNotIn("2026-10-20/task-2", active)
        self.assertIn("PLEBEIAN_FRIDAY_LIVE_APPLICATION_V2", active)
        self.assertIn("PLEBEIAN_FRIDAY_LIVE_APPLICATION_V3", active)

    def test_signer_dropin_is_literal_and_exact_for_each_slot(self) -> None:
        guard = runpy.run_path(str(DEPLOY / "verify-friday-runtime-target.py"))
        app = application()
        renderer = R20 / "render-friday-signer-state-dropin.py"
        for slot in ("1", "2", "3", "4"):
            with self.subTest(slot=slot):
                expected = guard["render_r20_signer_state_dropin"](app, slot)
                result = subprocess.run(["python3", "-I", "-S", "-B", str(renderer), "--slot", slot],
                                        input=json.dumps(app), text=True, capture_output=True, timeout=10)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout, expected)
                roots = expected.splitlines()[-1].removeprefix("ReadWritePaths=").split()
                self.assertEqual(roots, [app["dkg_root"], f"/var/lib/plebeian-auctions-friday/r20/node-{slot}"])
                self.assertEqual(expected.count("ReadWritePaths="), 2)
                self.assertNotIn("${", expected)
                values = environment(); values["FRIDAY_SLOT"] = slot
                paths = guard["_required_service_paths"](values, app, "plebeian-friday-signer.service")
                self.assertIn((roots[1], "directory"), paths)
                for bad in [expected.replace(roots[1], "/var/lib"),
                            expected.replace(roots[1], "/var/lib/plebeian-auctions-friday/r20"),
                            expected.replace(roots[1], f"/var/lib/plebeian-auctions-friday/r20/node-{int(slot) % 4 + 1}"),
                            expected.replace(roots[1], "/var/lib/plebeian-auctions-friday/frost/node-1"),
                            expected.replace(roots[1], "${FRIDAY_SLOT}"),
                            expected.replace(roots[1], "-" + roots[1]), expected + "ReadWritePaths=/var/lib\n"]:
                    with self.assertRaisesRegex(ValueError, "differs"):
                        guard["verify_r20_signer_dropin_text"](bad, app, slot)
        for bad_slot in ("0", "5", "01", 1, True, None):
            with self.assertRaises(ValueError): guard["render_r20_signer_state_dropin"](app, bad_slot)
        for changed in [legacy_application(), {**app, "comet_rpc_port": 26657},
                        {**app, "dkg_root": "/var/lib/plebeian-auctions-poc/frost"}]:
            with self.assertRaises(ValueError): guard["render_r20_signer_state_dropin"](changed, "1")

    def test_signer_renderer_is_bounded_and_duplicate_keys_fail(self) -> None:
        renderer = R20 / "render-friday-signer-state-dropin.py"
        for raw in ["{" + '"schema":"x",' + json.dumps(application())[1:], "x" * 65537, "null"]:
            result = subprocess.run(["python3", "-I", "-S", "-B", str(renderer), "--slot", "1"],
                                    input=raw, text=True, capture_output=True, timeout=10)
            self.assertNotEqual(result.returncode, 0); self.assertEqual(result.stdout, "")

    def test_signer_state_guard_checks_mode_owner_missing_and_symlinks(self) -> None:
        guard = runpy.run_path(str(DEPLOY / "verify-friday-runtime-target.py"))
        verify = guard["_verify_r20_signer_state"]
        scope = verify.__globals__
        app = application(); values = environment(); values["FRIDAY_SLOT"] = "2"
        # Public metadata fixture only: no system paths are written, and no
        # root ownership or kernel mount namespace is claimed by these tests.
        node = Path(guard["r20_signer_node_root"](app, "2")); dropin = guard["R20_SIGNER_DROPIN"]
        def metadata(mode: int, uid: int) -> os.stat_result:
            return os.stat_result((mode, 0, 0, 1, uid, 0, 0, 0, 0, 0))
        node_stat = metadata(stat.S_IFDIR | 0o700, os.geteuid())
        file_stat = metadata(stat.S_IFREG | 0o644, 0)
        def chain(path: Path, _label: str):
            if path == node:
                return [(guard["STATE_ROOT"], metadata(stat.S_IFDIR | 0o755, 0)), (node, node_stat)]
            return [(Path("/etc/systemd/system"), metadata(stat.S_IFDIR | 0o755, 0)), (dropin, file_stat)]
        def leaf(path: Path): return node_stat if path == node else file_stat
        text = guard["render_r20_signer_state_dropin"](app, "2")
        with mock.patch.dict(scope, {"_path_metadata": chain, "_service_uid": lambda: os.geteuid()}), \
             mock.patch.object(Path, "lstat", leaf), mock.patch.object(Path, "read_text", return_value=text):
            verify(values, app)
            for mode, uid in [(0o755, os.geteuid()), (0o700, os.geteuid()+1)]:
                node_stat = metadata(stat.S_IFDIR | mode, uid)
                with self.assertRaises(ValueError): verify(values, app)
            node_stat = metadata(stat.S_IFDIR | 0o700, os.geteuid())
            for mode, uid in [(0o600, 0), (0o644, os.geteuid()+1)]:
                file_stat = metadata(stat.S_IFREG | mode, uid)
                with self.assertRaises(ValueError): verify(values, app)
            file_stat = metadata(stat.S_IFREG | 0o644, 0)
            with mock.patch.object(Path, "read_text", side_effect=FileNotFoundError("missing drop-in")):
                with self.assertRaises(OSError): verify(values, app)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); real = root / "real"; real.mkdir(); link = root / "link"; link.symlink_to(real)
            with self.assertRaisesRegex(ValueError, "symlink"):
                guard["_managed_path"](link, "test-only path", root, {os.geteuid()}, "directory")
            with self.assertRaisesRegex(ValueError, "absent"):
                guard["_managed_path"](root / "absent", "test-only absent path", root, {os.geteuid()}, "directory")

    def test_nginx_modes_are_complete_mutually_exclusive_templates(self) -> None:
        server = (R20 / "nginx-server.conf.example").read_text(encoding="utf-8")
        normal = (R20 / "nginx-normal.conf.example").read_text(encoding="utf-8")
        recovery = (R20 / "nginx-recovery.conf.example").read_text(encoding="utf-8")
        self.assertIn("include /etc/nginx/plebeian-friday-r20-active.conf;", server)
        self.assertNotIn("include /etc/nginx/sites-enabled", server)
        for mode in (normal, recovery):
            self.assertIn("/api/friday/", mode)
            self.assertIn("location / {", mode)
            self.assertIn("/v1/", mode)
        self.assertIn("location ^~ /v1/", normal)
        self.assertNotIn("location ^~ /v1/", recovery)
        self.assertIn("location /v1/ { return 403; }", recovery)
        readme = (R20 / "README.md").read_text(encoding="utf-8")
        self.assertIn("sites-enabled/plebeian-friday-r20.conf` absent", readme)
        self.assertIn("atomically renamed", readme)

    def test_public_activation_is_fail_closed(self) -> None:
        values = environment()
        self.assertEqual(values["POC_FRIDAY_BROWSER_READY"], "false")
        self.assertEqual(values["POC_FRIDAY_RECOVERY_ONLY"], "false")
        self.assertEqual(values["POC_FRIDAY_R20_CLOSE_TRIGGER"], "false")
        self.assertEqual(values["POC_FRIDAY_BROWSER_PINS_SHA256"], "00" * 32)
        self.assertEqual(values["FRIDAY_R20_PROFILE"],
                         "/var/lib/plebeian-auctions-friday/frost-v2/r20-inputs/fresh-profile.json")
        self.assertEqual(values["FRIDAY_R20_PREDECESSOR_MANIFEST"],
                         "/var/lib/plebeian-auctions-friday/frost-v2/r20-inputs/predecessor-manifest.json")
        self.assertEqual(values["FRIDAY_R20_MANIFEST"],
                         "/var/lib/plebeian-auctions-friday/frost-v2/keyset-v2/manifest.json")
        self.assertEqual(values["FRIDAY_R20_MANIFEST_DIGEST"],
                         "/var/lib/plebeian-auctions-friday/frost-v2/keyset-v2/owner-approved-manifest-digest.txt")
        self.assertEqual(values["FRIDAY_R20_BOUND_MANIFEST"],
                         "/var/lib/plebeian-auctions-friday/frost-v2/r20-inputs/bound-manifest.json")

    def test_browser_release_pins_are_an_independent_rendered_artifact(self) -> None:
        template = json.loads((R20 / "browser-r20-pins.json.example").read_text(encoding="utf-8"))
        self.assertEqual(template["schema"], "PLEBEIAN_FRIDAY_R20_BROWSER_RELEASE_PINS_V1")
        self.assertEqual(template["deployment_id"], "friday-demo-20261023-r20")
        self.assertEqual(template["committee_keyset_id"], "friday-demo-frost-keyset-v2")
        self.assertEqual(template["committee_keyset_version"], "2")
        self.assertEqual(template["dkg_run_id"], "friday-demo-20261023-r20-dkg2")
        self.assertEqual(template["cashu_mint_url"], "https://172.105.95.57")
        for name in ("auth_network_id", "chain_id", "genesis_sha256", "committee_public_key",
                     "public_key_package_sha256", "signer_roster_digest", "fake_funding_policy_digest"):
            self.assertRegex(template[name], r"^%FRIDAY_[A-Z0-9_]+%$")


if __name__ == "__main__":
    unittest.main()
