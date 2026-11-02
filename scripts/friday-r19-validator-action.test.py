#!/usr/bin/python3

import hashlib
import importlib.util
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest import mock

SOURCE = Path(__file__).with_name("friday-r19-validator-action.py")
SPEC = importlib.util.spec_from_file_location("friday_r19_validator_action", SOURCE)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class Completed:
    returncode = 0
    stdout = b"DKG_INPUT_VALIDATION_OK\n"
    stderr = b""


class ActionTest(unittest.TestCase):
    def test_create_once_promotion_and_outcome(self):
        with tempfile.TemporaryDirectory(prefix="friday-r19-action-") as temporary:
            root = Path(temporary)
            root.chmod(0o755)
            releases = root / "releases"
            operator = root / "operator"
            releases.mkdir(mode=0o755)
            operator.mkdir(mode=0o700)
            config = root / "config.json"
            transport = root / "transport.json"
            config.write_text("{}\n")
            transport.write_text("{}\n")
            config.chmod(0o600)
            transport.chmod(0o600)
            profile = MODULE.Profile(releases, releases / "final", releases / ".staging",
                                     operator, operator / "action", config, transport,
                                     MODULE.pwd.getpwuid(os.getuid()).pw_name, os.getuid(), os.getgid(),
                                     Path("/usr/bin/timeout").stat().st_uid,
                                     Path("/usr/bin/timeout").stat().st_gid, os.getuid(), os.getgid())
            MODULE.prepare(profile)
            artifact = profile.staging_dir / MODULE.ARTIFACT_NAME
            payload = b"#!/bin/sh\nexit 0\n"
            artifact.write_bytes(payload)
            artifact.chmod(0o755)
            digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
            MODULE.promote(profile, digest, artifact.stat().st_size)
            self.assertFalse(profile.staging_dir.exists())
            self.assertTrue((profile.final_dir / MODULE.ARTIFACT_NAME).is_file())
            self.assertEqual(stat.S_IMODE(profile.final_dir.stat().st_mode), 0o755)
            # Limited unprivileged boundary gate: execute the promoted artifact
            # through its final parent rather than invoking the mocked runner.
            executed = subprocess.run([profile.final_dir / MODULE.ARTIFACT_NAME], check=False,
                                      stdin=subprocess.DEVNULL, capture_output=True)
            self.assertEqual(executed.returncode, 0)
            with self.assertRaises(RuntimeError):
                MODULE.prepare(profile)
            captured = []
            def runner(argv, **kwargs):
                captured.append(argv)
                return Completed()
            result = MODULE.invoke(profile, runner=runner,
                                   expected_sha256=digest, expected_size=len(payload),
                                   access_runner=subprocess.run, access_use_setpriv=False)
            self.assertTrue(result["success"])
            self.assertEqual(captured[0][:8], [
                "/usr/bin/prlimit", "--core=0:0", "--", "/usr/bin/timeout",
                "--signal=TERM", "--kill-after=5s", "30s", "/usr/bin/unshare",
            ])
            self.assertIn("--net", captured[0])
            self.assertIn("--no-new-privs", captured[0])
            self.assertIn("--bounding-set=-all", captured[0])
            evidence = json.loads((profile.operation_root / "outcome.json").read_text())
            self.assertTrue(evidence["inputsUnchanged"])
            with self.assertRaises(RuntimeError):
                MODULE.invoke(profile, runner=lambda *args, **kwargs: Completed(),
                              expected_sha256=digest, expected_size=len(payload),
                              access_runner=subprocess.run, access_use_setpriv=False)
            self.assertEqual(stat.S_IMODE((profile.operation_root / "outcome.json").stat().st_mode), 0o600)

    def test_composite_persists_and_rechecks_current_baseline(self):
        with tempfile.TemporaryDirectory(prefix="friday-r19-composite-") as temporary:
            root = Path(temporary)
            root.chmod(0o755)
            releases = root / "releases"
            operator = root / "operator"
            releases.mkdir(mode=0o755)
            operator.mkdir(mode=0o700)
            config = root / "config.json"
            transport = root / "transport.json"
            config.write_text("{}\n"); config.chmod(0o600)
            transport.write_text("{}\n"); transport.chmod(0o600)
            profile = MODULE.Profile(releases, releases / "final", releases / ".staging",
                                     operator, operator / "action", config, transport,
                                     MODULE.pwd.getpwuid(os.getuid()).pw_name, os.getuid(), os.getgid(),
                                     Path("/usr/bin/timeout").stat().st_uid,
                                     Path("/usr/bin/timeout").stat().st_gid, os.getuid(), os.getgid())
            MODULE.prepare(profile)
            artifact = profile.staging_dir / MODULE.ARTIFACT_NAME
            payload = b"#!/bin/sh\nexit 0\n"
            artifact.write_bytes(payload); artifact.chmod(0o755)
            digest = hashlib.sha256(payload).hexdigest()
            original_collect = MODULE.collect_r18_evidence
            baseline = {"phase": "r18-evidence-collection", "observation": "CURRENT_STATE_NOT_HISTORICAL_PROOF"}
            calls = []
            def collect(_profile):
                calls.append(True)
                return dict(baseline)
            MODULE.collect_r18_evidence = collect
            try:
                result = MODULE.composite(
                    profile, MODULE.R18, runner=lambda *args, **kwargs: Completed(),
                    access_runner=subprocess.run, expected_sha256=digest, expected_size=len(payload),
                    access_use_setpriv=False,
                )
            finally:
                MODULE.collect_r18_evidence = original_collect
            self.assertEqual(len(calls), 2)
            self.assertEqual(result["phase"], "composite-complete")
            self.assertEqual(json.loads((profile.operation_root / "r18-current-baseline.json").read_text()), baseline)

    def test_composite_refuses_changed_baseline_before_validator(self):
        with tempfile.TemporaryDirectory(prefix="friday-r19-composite-change-") as temporary:
            root = Path(temporary)
            root.chmod(0o755)
            releases = root / "releases"; releases.mkdir(mode=0o755)
            operator = root / "operator"; operator.mkdir(mode=0o700)
            config = root / "config.json"; config.write_text("{}\n"); config.chmod(0o600)
            transport = root / "transport.json"; transport.write_text("{}\n"); transport.chmod(0o600)
            profile = MODULE.Profile(releases, releases / "final", releases / ".staging",
                                     operator, operator / "action", config, transport,
                                     MODULE.pwd.getpwuid(os.getuid()).pw_name, os.getuid(), os.getgid(),
                                     Path("/usr/bin/timeout").stat().st_uid,
                                     Path("/usr/bin/timeout").stat().st_gid, os.getuid(), os.getgid())
            MODULE.prepare(profile)
            artifact = profile.staging_dir / MODULE.ARTIFACT_NAME
            payload = b"#!/bin/sh\nexit 0\n"; artifact.write_bytes(payload); artifact.chmod(0o755)
            digest = hashlib.sha256(payload).hexdigest()
            original_collect = MODULE.collect_r18_evidence
            observations = iter([{"value": 1}, {"value": 2}])
            MODULE.collect_r18_evidence = lambda _profile: next(observations)
            validator_called = []
            try:
                with self.assertRaises(RuntimeError):
                    MODULE.composite(profile, MODULE.R18,
                                     runner=lambda *args, **kwargs: validator_called.append(True),
                                     access_runner=subprocess.run, expected_sha256=digest,
                                     expected_size=len(payload), access_use_setpriv=False)
            finally:
                MODULE.collect_r18_evidence = original_collect
            self.assertEqual(validator_called, [])
            outcome = json.loads((profile.operation_root / "outcome.json").read_text())
            self.assertEqual(outcome["failureCategory"], "current_baseline_changed")
            self.assertFalse(outcome["validatorInvoked"])

    def test_preserved_r18_metadata_preflight(self):
        with tempfile.TemporaryDirectory(prefix="friday-r19-r18-preflight-") as temporary:
            root = Path(temporary)
            exchange = root / "exchange"
            state = root / "state"
            proc_root = root / "proc"
            lock = exchange / "participant-1.host.lock"
            exchange.mkdir(mode=0o700)
            state.mkdir(mode=0o700)
            proc_root.mkdir(mode=0o755)
            boot_path = proc_root / "sys/kernel/random"
            boot_path.mkdir(parents=True)
            (boot_path / "boot_id").write_text("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee\n")
            lock.mkdir(mode=0o700)
            config = root / "participant.config.json"
            transport = root / "transport-secrets.json"
            host_executable = root / "plebeian-friday-dkg-host"
            participant_executable = root / "coco-demo-frost-participant"
            config.write_text("{}\n")
            transport.write_text("{}\n")
            host_executable.write_text("host\n")
            participant_executable.write_text("participant\n")
            config.chmod(0o600)
            transport.chmod(0o600)
            profile = MODULE.PreservedRunProfile(
                exchange=exchange, journal=exchange / "participant-1.host-journal.jsonl",
                lock=lock, state=state, round1_output=exchange / "participant-1.round1.json",
                config=config, transport=transport,
                service_uid=os.getuid(), service_gid=os.getgid(), dead_pid=999999999,
                dead_boot_id="15a02667-f822-4d53-88bf-6cc7a518dda5", dead_start_ticks="74886913",
                proc_root=proc_root,
                host_executable=host_executable, participant_executable=participant_executable,
            )
            owner = {
                "schema": "PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_HOST_LOCK_V2", "pid": profile.dead_pid,
                "bootId": profile.dead_boot_id, "processStartTicks": profile.dead_start_ticks,
                "manifestDigest": MODULE.R18_MANIFEST_DIGEST, "participantId": 1,
            }
            (lock / "owner.json").write_text(json.dumps(owner) + "\n")
            (lock / "owner.json").chmod(0o600)
            records = [
                {"schema": "PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_HOST_JOURNAL_V1",
                 "manifestDigest": MODULE.R18_MANIFEST_DIGEST, "participantId": 1,
                 "stage": "enroll", "status": "started", "evidenceDigest": None},
                {"schema": "PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_HOST_JOURNAL_V1",
                 "manifestDigest": MODULE.R18_MANIFEST_DIGEST, "participantId": 1,
                 "stage": "enroll", "status": "completed", "evidenceDigest": "1" * 64},
                {"schema": "PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_HOST_JOURNAL_V1",
                 "manifestDigest": MODULE.R18_MANIFEST_DIGEST, "participantId": 1,
                 "stage": "confirm-transport", "status": "started", "evidenceDigest": None},
                {"schema": "PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_HOST_JOURNAL_V1",
                 "manifestDigest": MODULE.R18_MANIFEST_DIGEST, "participantId": 1,
                 "stage": "confirm-transport", "status": "completed", "evidenceDigest": "2" * 64},
                {"schema": "PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_HOST_JOURNAL_V1",
                 "manifestDigest": MODULE.R18_MANIFEST_DIGEST, "participantId": 1,
                 "stage": "persist-transport", "status": "started", "evidenceDigest": None},
                {"schema": "PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_HOST_JOURNAL_V1",
                 "manifestDigest": MODULE.R18_MANIFEST_DIGEST, "participantId": 1,
                 "stage": "persist-transport", "status": "completed", "evidenceDigest": "a" * 64},
                {"schema": "PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_HOST_JOURNAL_V1",
                 "manifestDigest": MODULE.R18_MANIFEST_DIGEST, "participantId": 1,
                 "stage": "round1", "status": "started", "evidenceDigest": None},
                {"schema": "PLEBEIAN_FRIDAY_PER_VALIDATOR_DKG_HOST_JOURNAL_V1",
                 "manifestDigest": MODULE.R18_MANIFEST_DIGEST, "participantId": 1,
                 "stage": "round1", "status": "indeterminate", "evidenceDigest": None},
            ]
            profile.journal.write_text("".join(json.dumps(record) + "\n" for record in records))
            profile.journal.chmod(0o600)
            collected = MODULE.collect_r18_evidence(profile)
            self.assertTrue(collected["processesAbsent"])
            self.assertEqual(collected["currentBootId"], "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee")
            self.assertEqual(collected["observation"], "CURRENT_STATE_NOT_HISTORICAL_PROOF")
            self.assertEqual(collected["config"]["nlink"], 1)
            self.assertEqual(collected["transport"]["mode"], 0o600)
            denied_pid = proc_root / "27182"
            denied_pid.mkdir()
            with mock.patch.object(MODULE.os, "readlink", side_effect=PermissionError):
                with self.assertRaises(RuntimeError):
                    MODULE.assert_no_dkg_processes(profile)
            denied_pid.rmdir()
            profile = replace(profile, journal_sha256=collected["journal"]["sha256"],
                              journal_size=collected["journal"]["size"],
                              journal_nlink=collected["journal"]["nlink"])
            self.assertTrue(MODULE.preflight_r18(profile)["preserved"])
            pid = proc_root / "31415"
            pid.mkdir()
            alias = root / "participant-hardlink"
            os.link(profile.participant_executable, alias)
            os.symlink(alias, pid / "exe")
            with self.assertRaises(RuntimeError):
                MODULE.preflight_r18(profile)
            (pid / "exe").unlink()
            pid.rmdir()
            profile.journal.write_text(profile.journal.read_text().replace("a" * 64, "b" * 64))
            with self.assertRaises(RuntimeError):
                MODULE.preflight_r18(profile)
            profile.journal.write_text("".join(json.dumps(record) + "\n" for record in records))
            profile.round1_output.write_text("appeared")
            with self.assertRaises(RuntimeError):
                MODULE.preflight_r18(profile)


if __name__ == "__main__":
    unittest.main()
