from __future__ import annotations

import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("friday-fips-dkg-diagnostic-r1.py")
SPEC = importlib.util.spec_from_file_location("friday_fips_dkg_diagnostic_r1", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class DkgDiagnosticPacketTests(unittest.TestCase):
    def test_phase_journal_accepts_only_fixed_sanitized_records(self) -> None:
        with tempfile.TemporaryDirectory(prefix="plebeian-dkg-phase-test-") as directory:
            path = Path(directory) / "dkg-phase.jsonl"
            path.write_text(
                json.dumps({
                    "schema": "PLEBEIAN_FRIDAY_FIPS_DKG_PHASE_V1",
                    "stage": "dkg_round1", "status": "begin", "unix_ms": 1,
                }) + "\n",
                encoding="utf-8",
            )
            os.chmod(path, 0o600)
            self.assertEqual(MODULE.validate_phase_journal(path)[0]["stage"], "dkg_round1")

            path.write_text(
                json.dumps({
                    "schema": "PLEBEIAN_FRIDAY_FIPS_DKG_PHASE_V1",
                    "stage": "dkg_round1", "status": "failed", "unix_ms": 2,
                    "error": "must never be retained",
                }) + "\n",
                encoding="utf-8",
            )
            with self.assertRaises(MODULE.DiagnosticRefusal):
                MODULE.validate_phase_journal(path)

    def test_child_boundary_is_exactly_unprivileged_and_non_networked(self) -> None:
        argv = MODULE.diagnostic_argv()
        self.assertEqual(argv[0:2], ["/usr/bin/env", "-i"])
        self.assertIn("--clear-groups", argv)
        self.assertIn("--bounding-set=-all", argv)
        self.assertIn("--no-new-privs", argv)
        self.assertIn("--core=0:0", argv)
        self.assertIn("--nproc=128:128", argv)
        self.assertIn("--phase-journal", argv)
        self.assertIn('cwd="/home/maximoto"', SCRIPT.read_text(encoding="utf-8"))
        rendered = " ".join(argv)
        for forbidden in ("/usr/bin/ip", "/usr/sbin/nft", "/usr/bin/fips", "netns", "--listen"):
            self.assertNotIn(forbidden, rendered)

    def test_packet_has_no_dynamic_error_or_protocol_fields(self) -> None:
        source = SCRIPT.read_text(encoding="utf-8")
        self.assertNotIn("stderr.read_text", source)
        self.assertNotIn("stdout.read_text", source)
        self.assertIn('"secretsProofsConfigPayloadsOrRawOutputIncluded": False', source)
        self.assertIn('"networkExecutionBoundary": "static_allowlisted_dkg_path_not_kernel_observed"', source)

    def test_success_requires_complete_ordered_phase_sequence(self) -> None:
        records = [{
            "schema": "PLEBEIAN_FRIDAY_FIPS_DKG_PHASE_V1", "stage": "cli_start",
            "status": "ok", "unix_ms": 1,
        }]
        for stage in MODULE.SUCCESS_PHASES[1:-1]:
            records.extend(({
                "schema": "PLEBEIAN_FRIDAY_FIPS_DKG_PHASE_V1", "stage": stage,
                "status": status, "unix_ms": len(records) + 1,
            } for status in ("begin", "ok")))
        records.append({
            "schema": "PLEBEIAN_FRIDAY_FIPS_DKG_PHASE_V1", "stage": "cli_complete",
            "status": "ok", "unix_ms": len(records) + 1,
        })
        MODULE.validate_success_phase_order(records)
        with self.assertRaises(MODULE.DiagnosticRefusal):
            MODULE.validate_success_phase_order(records[:-1])

    def test_reaped_leader_never_causes_numeric_group_signal(self) -> None:
        class ReapedChild:
            pid = 424242

        with patch.object(MODULE, "exact_child_is_live", return_value=False), \
                patch.object(MODULE, "wait_group_absent", return_value=True), \
                patch.object(MODULE.os, "killpg") as kill_group:
            self.assertTrue(MODULE.stop_owned_group(ReapedChild(), 99, 0.01))
            kill_group.assert_not_called()

    def test_controller_reserves_evidence_before_child_and_handles_sigterm(self) -> None:
        source = SCRIPT.read_text(encoding="utf-8")
        self.assertLess(source.index("reserve_evidence()"), source.index("subprocess.Popen("))
        self.assertIn("signal.signal(signal.SIGTERM, interrupt_handler)", source)
        main_source = source[source.index("def main()") :]
        self.assertLess(
            main_source.index("signal.pthread_sigmask(signal.SIG_BLOCK"),
            main_source.index("reserve_evidence()"),
        )
        self.assertLess(
            main_source.index("signal.signal(signal.SIGTERM, interrupt_handler)"),
            main_source.index("reserve_evidence()"),
        )
        self.assertIn("owned process group absence was not proved; run root preserved", source)
        self.assertIn("os.path.lexists(EVIDENCE_PENDING)", source)


if __name__ == "__main__":
    unittest.main()
