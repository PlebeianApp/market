#!/usr/bin/python3
"""Static, unprivileged checks for the inert Friday blue/green templates."""

from __future__ import annotations

import json
import os
import re
import runpy
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
DEPLOY = ROOT / "deploy/friday"
WEDNESDAY_PORTS = {26656, 26657, 3338, 3339, 8080}
FRIDAY_PORTS = {27656, 27657, 3438, 39101, 8180}


class FridayBlueGreenRegression(unittest.TestCase):
    def test_candidate_paths_and_ports_are_disjoint(self) -> None:
        readme = (DEPLOY / "README.md").read_text(encoding="utf-8")
        environment = (DEPLOY / "friday.env.example").read_text(encoding="utf-8")
        self.assertIn("/var/lib/plebeian-auctions-friday", readme)
        self.assertIn("/opt/plebeian-auctions-friday", readme)
        self.assertTrue(WEDNESDAY_PORTS.isdisjoint(FRIDAY_PORTS))
        for port in FRIDAY_PORTS:
            self.assertRegex(environment + readme, rf"\b{port}\b")

    def test_transport_is_udp_32121_and_not_stale_tcp_8443(self) -> None:
        fips = (DEPLOY / "fips.yaml.example").read_text(encoding="utf-8")
        rollout = (ROOT / "FIPS-LIVE-ROLLOUT-MANIFEST.md").read_text(encoding="utf-8")
        self.assertIn("transports:\n  udp:", fips)
        self.assertEqual(fips.count(":32121"), 4)
        self.assertIn("UDP 32121", rollout)
        self.assertNotIn("TCP 8443", rollout)

    def test_units_are_inert_templates_without_wednesday_paths(self) -> None:
        units = sorted(DEPLOY.glob("*.service"))
        self.assertEqual(
            {unit.name for unit in units},
            {
                "plebeian-friday-authority.service",
                "plebeian-friday-coordinator.service",
                "plebeian-friday-fips.service",
                "plebeian-friday-mint.service",
                "plebeian-friday-signer.service",
                "plebeian-friday-site.service",
                "plebeian-friday-validator.service",
            },
        )
        for unit in units:
            text = unit.read_text(encoding="utf-8")
            self.assertNotIn("/var/lib/plebeian-auctions-poc", text)
            self.assertNotIn("/opt/plebeian-auctions-poc", text)
            self.assertNotIn("/etc/plebeian-auctions-poc", text)
            self.assertIn("NoNewPrivileges=yes", text)
            self.assertIn("Slice=plebeian-friday.slice", text)
            self.assertIn("verify-friday-runtime-target.py", text)
            self.assertIn(f"--service {unit.name}", text)
        fips = (DEPLOY / "plebeian-friday-fips.service").read_text(encoding="utf-8")
        assert "--log-file" not in fips
        assert "RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX AF_NETLINK" in fips
        assert "ReadWritePaths=/var/lib/plebeian-auctions-friday/fips" in fips
        signer = (DEPLOY / "plebeian-friday-signer.service").read_text(encoding="utf-8")
        self.assertIn("CapabilityBoundingSet=CAP_NET_ADMIN", fips)
        self.assertIn("Restart=no", signer)
        for unit in units:
            if unit.name != "plebeian-friday-fips.service":
                self.assertNotRegex(unit.read_text(encoding="utf-8"), r"CapabilityBoundingSet=.*NET_ADMIN")

    def test_runtime_target_guard_refuses_wednesday_paths_and_units(self) -> None:
        namespace = runpy.run_path(str(DEPLOY / "verify-friday-runtime-target.py"))
        verify_environment = namespace["verify_environment_values"]
        verify_application = namespace["verify_application_values"]
        allowed_services = namespace["ALLOWED_SERVICES"]

        environment = {}
        for raw in (DEPLOY / "friday.env.example").read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if line and not line.startswith("#"):
                name, value = line.split("=", 1)
                if name == "FRIDAY_DKG_MANIFEST_DIGEST":
                    value = "00" * 32
                environment[name] = value
        verify_environment(environment)
        bad_environment = dict(environment)
        bad_environment["FRIDAY_NETWORK_ROOT"] = "/var/lib/plebeian-auctions-poc/network"
        with self.assertRaisesRegex(ValueError, "Wednesday path"):
            verify_environment(bad_environment)

        application_raw = (DEPLOY / "application.json.example").read_text(encoding="utf-8")
        application_raw = application_raw.replace("%FRIDAY_APPLICATION_HOST_SLOT%", "2")
        application_raw = re.sub(r"%FRIDAY_[A-Z0-9_]+%", "test-only-public-value", application_raw)
        application = json.loads(application_raw)
        verify_application(application)
        bad_application = dict(application)
        bad_application["network_root"] = "/var/lib/plebeian-auctions-poc"
        with self.assertRaisesRegex(ValueError, "Wednesday path"):
            verify_application(bad_application)

        self.assertNotIn("plebeian-poc-validator@1.service", allowed_services)

    def test_runtime_target_guard_rejects_parent_symlinks_and_service_owned_config(self) -> None:
        namespace = runpy.run_path(str(DEPLOY / "verify-friday-runtime-target.py"))
        managed_path = namespace["_managed_path"]
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            real = root / "real"
            config = real / "config"
            config.mkdir(parents=True)
            environment = config / "friday.env"
            environment.write_text("FRIDAY_TEST=public\n", encoding="utf-8")
            environment.chmod(0o644)

            alias = root / "alias"
            alias.symlink_to(real, target_is_directory=True)
            with self.assertRaisesRegex(ValueError, "symlink component"):
                managed_path(
                    alias / "config/friday.env",
                    "Friday test config",
                    alias / "config",
                    {os.getuid()},
                    "file",
                )

            # The current test user stands in for the service account. Config
            # is required to be owned by the distinct approved root UID.
            with self.assertRaisesRegex(ValueError, "unapproved owner"):
                managed_path(
                    environment,
                    "Friday service-owned config",
                    config,
                    {os.getuid() + 1},
                    "file",
                )

    def test_runtime_target_guard_allows_service_owned_state_but_not_writable_state(self) -> None:
        namespace = runpy.run_path(str(DEPLOY / "verify-friday-runtime-target.py"))
        managed_path = namespace["_managed_path"]
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary) / "state"
            state.mkdir(mode=0o700)
            database = state / "operations.sqlite3"
            database.write_bytes(b"test-only")
            database.chmod(0o600)
            managed_path(database, "Friday service state", state, {os.getuid()}, "file")
            database.chmod(0o620)
            with self.assertRaisesRegex(ValueError, "group/world writable"):
                managed_path(database, "Friday writable state", state, {os.getuid()}, "file")

    def test_runtime_target_guard_uses_per_host_service_stages(self) -> None:
        namespace = runpy.run_path(str(DEPLOY / "verify-friday-runtime-target.py"))
        required_paths = namespace["_required_service_paths"]
        environment = {}
        for raw in (DEPLOY / "friday.env.example").read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if line and not line.startswith("#"):
                name, value = line.split("=", 1)
                if name == "FRIDAY_DKG_MANIFEST_DIGEST":
                    value = "00" * 32
                environment[name] = value
        application_raw = (DEPLOY / "application.json.example").read_text(encoding="utf-8")
        application_raw = application_raw.replace("%FRIDAY_APPLICATION_HOST_SLOT%", "2")
        application_raw = re.sub(r"%FRIDAY_[A-Z0-9_]+%", "test-only-public-value", application_raw)
        application = json.loads(application_raw)

        matrix = {
            service: {path for path, _ in required_paths(environment, application, service)}
            for service in namespace["ALLOWED_SERVICES"]
        }
        dkg_result = environment["FRIDAY_DKG_RESULT"]
        network_facts = environment["FRIDAY_NETWORK_FACTS"]
        coordinator_db = environment["FRIDAY_COORDINATOR_DB"]
        anchor_db = environment["FRIDAY_COORDINATOR_ANCHOR_DB"]

        # Every host may start its already-staged transport without a DKG,
        # Comet, or V2 application database having been initialized yet.
        fips = matrix["plebeian-friday-fips.service"]
        self.assertIn(environment["FRIDAY_FIPS_IDENTITY_KEY"], fips)
        self.assertNotIn(dkg_result, fips)
        self.assertNotIn(network_facts, fips)
        self.assertNotIn(coordinator_db, fips)
        self.assertNotIn(anchor_db, fips)

        validator = matrix["plebeian-friday-validator.service"]
        self.assertIn(environment["FRIDAY_NETWORK_ROOT"], validator)
        self.assertNotIn(dkg_result, validator)
        self.assertNotIn(coordinator_db, validator)

        signer = matrix["plebeian-friday-signer.service"]
        self.assertIn(dkg_result, signer)
        self.assertIn(network_facts, signer)
        self.assertNotIn(coordinator_db, signer)
        self.assertNotIn(anchor_db, signer)

        for service in ("plebeian-friday-coordinator.service", "plebeian-friday-authority.service"):
            self.assertIn(coordinator_db, matrix[service])
            self.assertIn(anchor_db, matrix[service])
        for service in ("plebeian-friday-fips.service", "plebeian-friday-validator.service",
                        "plebeian-friday-signer.service", "plebeian-friday-site.service"):
            self.assertNotIn(coordinator_db, matrix[service])
            self.assertNotIn(anchor_db, matrix[service])

    def test_fips_requires_preprovisioned_config_adjacent_identity(self) -> None:
        environment = (DEPLOY / "friday.env.example").read_text(encoding="utf-8")
        unit = (DEPLOY / "plebeian-friday-fips.service").read_text(encoding="utf-8")
        self.assertIn("FRIDAY_FIPS_CONFIG=/var/lib/plebeian-auctions-friday/fips/identity/fips.yaml", environment)
        self.assertIn("FRIDAY_FIPS_IDENTITY_KEY=/var/lib/plebeian-auctions-friday/fips/identity/fips.key", environment)
        self.assertIn("verify-friday-fips-identity.py", unit)
        self.assertNotIn("fipsctl keygen", unit)

    def test_fips_identity_preflight_refuses_absent_key_and_accepts_exact_existing_key(self) -> None:
        verifier = DEPLOY / "verify-friday-fips-identity.py"
        with tempfile.TemporaryDirectory() as temporary:
            identity = Path(temporary) / "identity"
            identity.mkdir(mode=0o700)
            config = identity / "fips.yaml"
            key = identity / "fips.key"
            config.write_text("node:\n  identity:\n    persistent: true\n", encoding="utf-8")
            config.chmod(0o600)
            absent = subprocess.run(
                ["python3", "-I", "-S", "-B", str(verifier), "--config", str(config), "--key", str(key)],
                check=False, capture_output=True, text=True,
            )
            self.assertNotEqual(absent.returncode, 0)
            self.assertIn("private key is absent", absent.stderr)
            key.write_text("test-only-placeholder\n", encoding="utf-8")
            key.chmod(0o600)
            accepted = subprocess.run(
                ["python3", "-I", "-S", "-B", str(verifier), "--config", str(config), "--key", str(key)],
                check=False, capture_output=True, text=True,
            )
            self.assertEqual(accepted.returncode, 0, accepted.stderr)
            self.assertEqual(accepted.stdout, "")

    def test_live_coordinator_identity_is_fixed_to_v2_local_state(self) -> None:
        application = (DEPLOY / "application.json.example").read_text(encoding="utf-8")
        expected = '"coordinator_rpc_identity_path": "/var/lib/plebeian-auctions-friday/coordinator/coordinator-rpc-identity.key"'
        self.assertIn(expected, application)
        self.assertNotIn("node-1/coordinator-rpc-identity.key", application)
        for name in ("plebeian-friday-authority.service", "plebeian-friday-coordinator.service"):
            self.assertIn("ConditionPathExists=/var/lib/plebeian-auctions-friday/coordinator/coordinator-rpc-identity.key",
                          (DEPLOY / name).read_text(encoding="utf-8"))

    def test_aggregate_resource_boundary_covers_every_friday_unit(self) -> None:
        slice_text = (DEPLOY / "plebeian-friday.slice").read_text(encoding="utf-8")
        nginx = (DEPLOY / "nginx-plebeian-friday-resource.conf").read_text(encoding="utf-8")
        self.assertIn("MemoryHigh=2G", slice_text)
        self.assertIn("MemoryMax=2304M", slice_text)
        self.assertIn("TasksMax=1024", slice_text)
        self.assertIn("Slice=plebeian-friday.slice", nginx)
        expected_caps = {
            "plebeian-friday-fips.service": "160M", "plebeian-friday-validator.service": "384M",
            "plebeian-friday-signer.service": "320M", "plebeian-friday-mint.service": "384M",
            "plebeian-friday-coordinator.service": "384M", "plebeian-friday-authority.service": "448M",
            "plebeian-friday-site.service": "160M",
        }
        self.assertEqual(sum(int(value[:-1]) for value in expected_caps.values()) + 128, 2368)
        for name, cap in expected_caps.items():
            self.assertIn(f"MemoryMax={cap}", (DEPLOY / name).read_text(encoding="utf-8"))

    def test_no_unresolved_token_is_an_ip_or_secret(self) -> None:
        fips = (DEPLOY / "fips.yaml.example").read_text(encoding="utf-8")
        environment = (DEPLOY / "friday.env.example").read_text(encoding="utf-8")
        tokens = re.findall(r"%FRIDAY_[A-Z0-9_]+%", fips + environment)
        self.assertGreaterEqual(len(tokens), 10)
        self.assertNotRegex(fips + environment, r"(?:nsec1|[0-9a-f]{64})")

    def test_recovery_only_mint_proxy_denies_new_issuance(self) -> None:
        recovery = (DEPLOY / "nginx-friday-mint-recovery-only.conf.example").read_text(encoding="utf-8")
        # Existing-operation recovery needs these exact public Cashu methods.
        for route in ("info", "keys", "keysets", "swap", "checkstate", "restore"):
            self.assertRegex(recovery, rf"\b{route}\b")
        # An existing quote may be inspected, but the collection/create route
        # and mint execution route must fall through to the explicit denial.
        self.assertIn("mint/quote/bolt11/", recovery)
        self.assertIn("location /v1/", recovery)
        self.assertIn("return 403", recovery)
        self.assertNotRegex(recovery, r"location\s+[=~*^]*\s*/v1/mint/bolt11")
        self.assertNotRegex(recovery, r"location\s+[=~*^]*\s*/v1/mint/quote/bolt11\s*\{")


if __name__ == "__main__":
    unittest.main()
