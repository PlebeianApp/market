#!/usr/bin/python3
"""Unprivileged regression tests for R3 namespace/link attribution."""

from __future__ import annotations

import importlib.util
import json
import os
import pathlib
import stat
import tempfile
import types
import unittest


PATH = pathlib.Path(__file__).with_name("friday-fips-lab-r3.py")
SPEC = importlib.util.spec_from_file_location("plebeian_fips_r3_tested", PATH)
assert SPEC is not None and SPEC.loader is not None
r3 = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(r3)


class R3AttributionTests(unittest.TestCase):
    def setUp(self) -> None:
        r3._preflight_completed = False
        r3._host_fips0_before = None
        r3._host_fips0_after = None
        r3._run_root_identity = None
        r3._marker_identity = None
        r3._created_host_link_identities.clear()
        r3._created_namespace_identities.clear()
        r3._expected_ulas = []
        r3._namespace_fips0_evidence = []

    def test_preexisting_host_fips0_is_tolerated(self) -> None:
        r3.validate_preflight_inventory(set(), {"lo", "eth0", "fips0"}, "")

    def test_actual_temporary_host_conflict_is_rejected(self) -> None:
        for name in ("pff1", "sw4", "br0", "under0"):
            with self.subTest(name=name), self.assertRaises(r3.base.LabRefusal):
                r3.validate_preflight_inventory(set(), {"lo", "fips0", name}, "")

    def test_namespace_conflict_is_rejected(self) -> None:
        with self.assertRaises(r3.base.LabRefusal):
            r3.validate_preflight_inventory({"poc-friday-fips-n3"}, {"fips0"}, "")

    def test_preflight_refusal_does_not_claim_or_delete_unrelated_fips0(self) -> None:
        self.assertEqual(r3.cleanup_owned_r3([], [], None, set()), [])

    def test_only_recorded_or_proven_absent_temporary_names_are_residue(self) -> None:
        self.assertEqual(r3.classify_postflight_host_links(set(), {"lo", "fips0"}), [])
        self.assertEqual(
            r3.classify_postflight_host_links({"pff2"}, {"lo", "fips0", "pff2"}),
            ["recorded lab host links remain: ['pff2']"],
        )

    def test_completed_cleanup_preserves_unchanged_host_fips0(self) -> None:
        original_cleanup = r3.cleanup_without_run_root
        original_links = r3.r2.host_link_names
        original_snapshot = r3.host_fips0_snapshot
        stable = {"present": True, "sha256": "11" * 32, "stable": {"ifindex": 3}}
        try:
            r3._preflight_completed = True
            r3._host_fips0_before = stable
            r3.cleanup_without_run_root = lambda *_args, **_kwargs: []
            r3.r2.host_link_names = lambda: {"lo", "fips0"}
            r3.host_fips0_snapshot = lambda: stable
            self.assertEqual(r3.cleanup_owned_r3([], [], "rules", set()), [])
            self.assertEqual(r3._host_fips0_after, stable)
        finally:
            r3.cleanup_without_run_root = original_cleanup
            r3.r2.host_link_names = original_links
            r3.host_fips0_snapshot = original_snapshot

    def test_completed_cleanup_refuses_changed_host_fips0(self) -> None:
        original_cleanup = r3.cleanup_without_run_root
        original_links = r3.r2.host_link_names
        original_snapshot = r3.host_fips0_snapshot
        try:
            r3._preflight_completed = True
            r3._host_fips0_before = {"present": True, "sha256": "11" * 32, "stable": {}}
            r3.cleanup_without_run_root = lambda *_args, **_kwargs: []
            r3.r2.host_link_names = lambda: {"lo", "fips0"}
            r3.host_fips0_snapshot = lambda: {"present": True, "sha256": "22" * 32, "stable": {}}
            self.assertEqual(
                r3.cleanup_owned_r3([], [], "rules", set()),
                ["preexisting host fips0 stable identity/configuration changed"],
            )
        finally:
            r3.cleanup_without_run_root = original_cleanup
            r3.r2.host_link_names = original_links
            r3.host_fips0_snapshot = original_snapshot

    def test_host_snapshot_ignores_volatile_state_and_counters(self) -> None:
        link = [{
            "ifindex": 3, "ifname": "fips0", "mtu": 1280, "link_type": "none",
            "linkinfo": {"info_kind": "tun", "info_data": {"type": "tun", "persist": False}},
            "num_tx_queues": 1, "num_rx_queues": 1,
            "flags": ["UP"], "operstate": "UNKNOWN", "stats64": {"rx": {"bytes": 1}},
        }]
        addresses = [{"ifname": "fips0", "addr_info": [{
            "family": "inet6", "local": "fd00::1", "prefixlen": 128, "scope": "global",
            "valid_life_time": 10,
        }]}]
        changed = json.loads(json.dumps(link))
        changed[0]["flags"] = ["UP", "LOWER_UP"]
        changed[0]["operstate"] = "UP"
        changed[0]["stats64"]["rx"]["bytes"] = 999
        changed_addresses = json.loads(json.dumps(addresses))
        changed_addresses[0]["addr_info"][0]["valid_life_time"] = 1
        self.assertEqual(
            r3.stable_host_fips0(link, addresses),
            r3.stable_host_fips0(changed, changed_addresses),
        )

    def test_host_snapshot_detects_stable_configuration_change(self) -> None:
        link = [{
            "ifindex": 3, "ifname": "fips0", "mtu": 1280, "link_type": "none",
            "address": "00:00:00:00:00:00", "qdisc": "fq_codel", "group": "default",
            "linkinfo": {"info_kind": "tun", "info_data": {"type": "tun", "persist": False}},
            "flags": ["UP", "LOWER_UP"],
        }]
        addresses = [{"ifname": "fips0", "addr_info": []}]
        changed = json.loads(json.dumps(link))
        changed[0]["mtu"] = 1400
        self.assertNotEqual(
            r3.stable_host_fips0(link, addresses),
            r3.stable_host_fips0(changed, addresses),
        )

    def test_preflight_completed_without_created_root_never_deletes_foreign_root(self) -> None:
        original_root = r3.RUN_ROOT
        original_marker = r3.base.MARKER_PATH
        original_namespaces = r3.base.namespace_names
        with tempfile.TemporaryDirectory(prefix="plebeian-r3-test.") as parent:
            root = pathlib.Path(parent) / "foreign"
            root.mkdir()
            marker = root / ".plebeian-friday-fips-lab-owned"
            marker.write_text(r3.RUN_ID + "\n", encoding="utf-8")
            try:
                r3.RUN_ROOT = root
                r3.base.MARKER_PATH = marker
                r3.base.namespace_names = lambda: set()
                r3._preflight_completed = True
                self.assertEqual(
                    r3.remove_owned_run_root(),
                    ["run root exists without complete recorded identity; refusing automatic deletion"],
                )
                self.assertTrue(root.exists())
            finally:
                r3.RUN_ROOT = original_root
                r3.base.MARKER_PATH = original_marker
                r3.base.namespace_names = original_namespaces

    def test_replaced_marker_identity_is_not_deleted(self) -> None:
        original_root = r3.RUN_ROOT
        original_marker = r3.base.MARKER_PATH
        original_namespaces = r3.base.namespace_names
        with tempfile.TemporaryDirectory(prefix="plebeian-r3-test.") as parent:
            root = pathlib.Path(parent) / "owned"
            root.mkdir()
            marker = root / ".plebeian-friday-fips-lab-owned"
            marker.write_text(r3.RUN_ID + "\n", encoding="utf-8")
            r3._run_root_identity = (root.stat().st_dev, root.stat().st_ino)
            first = marker.stat()
            r3._marker_identity = (first.st_dev, first.st_ino)
            marker.rename(root / ".old-marker")
            marker.write_text(r3.RUN_ID + "\n", encoding="utf-8")
            try:
                r3.RUN_ROOT = root
                r3.base.MARKER_PATH = marker
                r3.base.namespace_names = lambda: set()
                self.assertEqual(
                    r3.remove_owned_run_root(),
                    ["run root marker identity changed; refusing automatic deletion"],
                )
                self.assertTrue(root.exists())
            finally:
                r3.RUN_ROOT = original_root
                r3.base.MARKER_PATH = original_marker
                r3.base.namespace_names = original_namespaces

    def test_only_recorded_root_and_marker_identities_are_removed(self) -> None:
        original_root = r3.RUN_ROOT
        original_marker = r3.base.MARKER_PATH
        original_namespaces = r3.base.namespace_names
        original_guard = r3.run_root_guard_error
        with tempfile.TemporaryDirectory(prefix="plebeian-r3-test.") as parent:
            root = pathlib.Path(parent) / "owned"
            root.mkdir()
            marker = root / ".plebeian-friday-fips-lab-owned"
            marker.write_text(r3.RUN_ID + "\n", encoding="utf-8")
            root_meta = root.stat()
            marker_meta = marker.stat()
            r3._run_root_identity = (root_meta.st_dev, root_meta.st_ino)
            r3._marker_identity = (marker_meta.st_dev, marker_meta.st_ino)
            try:
                r3.RUN_ROOT = root
                r3.base.MARKER_PATH = marker
                r3.base.namespace_names = lambda: set()
                r3.run_root_guard_error = lambda *_args: None
                self.assertEqual(r3.remove_owned_run_root(), [])
                self.assertFalse(root.exists())
            finally:
                r3.RUN_ROOT = original_root
                r3.base.MARKER_PATH = original_marker
                r3.base.namespace_names = original_namespaces
                r3.run_root_guard_error = original_guard

    def test_run_root_guard_requires_root_owned_entry_and_marker(self) -> None:
        root = types.SimpleNamespace(st_uid=0, st_gid=r3.base.GID, st_mode=stat.S_IFDIR | 0o770)
        marker = types.SimpleNamespace(st_uid=0, st_gid=0, st_mode=stat.S_IFREG | 0o600)
        self.assertIsNone(r3.run_root_guard_error(root, marker))
        root.st_uid = r3.base.UID
        self.assertEqual(
            r3.run_root_guard_error(root, marker),
            "run root ownership/mode changed; refusing automatic deletion",
        )

    def test_same_name_different_ifindex_is_never_deleted(self) -> None:
        original_cleanup = r3.cleanup_without_run_root
        original_links = r3.r2.host_link_names
        original_identity = r3.host_link_identity
        original_snapshot = r3.host_fips0_snapshot
        original_run = r3.base.run
        calls: list[list[str]] = []
        try:
            r3._preflight_completed = True
            r3._host_fips0_before = None
            r3._created_host_link_identities["pff1"] = 41
            r3.cleanup_without_run_root = lambda *_args, **_kwargs: []
            r3.r2.host_link_names = lambda: {"lo", "pff1"}
            r3.host_link_identity = lambda _name: 99
            r3.host_fips0_snapshot = lambda: None
            r3.base.run = lambda argv, **_kwargs: calls.append(argv) or types.SimpleNamespace(stdout=b"")
            errors = r3.cleanup_owned_r3([], [], "rules", {"pff1"})
            self.assertIn("recorded host veth pff1 identity changed; refusing deletion", errors)
            self.assertFalse(any("delete" in call for call in calls))
        finally:
            r3.cleanup_without_run_root = original_cleanup
            r3.r2.host_link_names = original_links
            r3.host_link_identity = original_identity
            r3.host_fips0_snapshot = original_snapshot
            r3.base.run = original_run

    def test_same_name_different_namespace_inode_is_never_deleted(self) -> None:
        original_namespaces = r3.base.namespace_names
        original_identity = r3.namespace_identity
        original_run = r3.base.run
        calls: list[list[str]] = []
        namespace = "poc-friday-fips-n1"
        try:
            r3._created_namespace_identities[namespace] = (4, 55)
            r3.base.namespace_names = lambda: {namespace}
            r3.namespace_identity = lambda _name: (4, 99)
            r3.base.run = lambda argv, **_kwargs: calls.append(argv) or types.SimpleNamespace(stdout=b"")
            errors = r3.cleanup_without_run_root([], [namespace], None)
            self.assertIn(f"recorded namespace {namespace} identity changed; refusing deletion", errors)
            self.assertFalse(any(call[:3] == [r3.base.IP, "netns", "delete"] for call in calls))
        finally:
            r3.base.namespace_names = original_namespaces
            r3.namespace_identity = original_identity
            r3.base.run = original_run

    def test_namespace_counter_verifier_still_requires_fips0(self) -> None:
        original_run = r3.base.run
        try:
            r3.base.run = lambda *_args, **_kwargs: types.SimpleNamespace(stdout=json.dumps([
                {"ifname": "under0", "stats64": {"rx": {"bytes": 1}, "tx": {"bytes": 2}}},
                {"ifname": "fips0", "stats64": {"rx": {"bytes": 3}, "tx": {"bytes": 4}}},
            ]).encode())
            self.assertEqual(r3.base.interface_counters(1)["fips0_rx"], 3)
            r3.base.run = lambda *_args, **_kwargs: types.SimpleNamespace(stdout=json.dumps([
                {"ifname": "under0", "stats64": {"rx": {"bytes": 1}, "tx": {"bytes": 2}}},
            ]).encode())
            with self.assertRaises(r3.base.LabRefusal):
                r3.base.interface_counters(1)
        finally:
            r3.base.run = original_run

    def test_namespace_fips0_binds_tun_and_derived_ula(self) -> None:
        original_run = r3.base.run
        responses = [
            [{"ifindex": 9, "ifname": "fips0", "linkinfo": {
                "info_kind": "tun", "info_data": {"type": "tun"},
            }}],
            [{"ifname": "fips0", "addr_info": [{
                "family": "inet6", "local": "fd00::1234", "prefixlen": 128, "scope": "global",
            }]}],
        ]
        try:
            original_identity = r3.namespace_identity
            r3.namespace_identity = lambda _name: (4, 55)
            r3.base.run = lambda *_args, **_kwargs: types.SimpleNamespace(
                stdout=json.dumps(responses.pop(0)).encode(),
            )
            result = r3.validate_namespace_fips0(1, "fd00::1234")
            self.assertEqual(result["kind"], "tun")
            self.assertEqual(result["namespace"], "poc-friday-fips-n1")
            self.assertRegex(result["sha256"], r"^[0-9a-f]{64}$")
        finally:
            r3.namespace_identity = original_identity
            r3.base.run = original_run

    def test_namespace_fips0_rejects_tap(self) -> None:
        original_run = r3.base.run
        responses = [
            [{"ifindex": 9, "ifname": "fips0", "linkinfo": {
                "info_kind": "tun", "info_data": {"type": "tap"},
            }}],
            [{"ifname": "fips0", "addr_info": [{
                "family": "inet6", "local": "fd00::1234", "prefixlen": 128, "scope": "global",
            }]}],
        ]
        try:
            r3.base.run = lambda *_args, **_kwargs: types.SimpleNamespace(
                stdout=json.dumps(responses.pop(0)).encode(),
            )
            with self.assertRaises(r3.base.LabRefusal):
                r3.validate_namespace_fips0(1, "fd00::1234")
        finally:
            r3.base.run = original_run

    def test_namespace_fips0_rejects_extra_or_alternate_global_address(self) -> None:
        original_run = r3.base.run
        cases = (
            [
                {"family": "inet6", "local": "fd00::1234", "prefixlen": 128, "scope": "global"},
                {"family": "inet", "local": "192.0.2.1", "prefixlen": 32, "scope": "global"},
            ],
            [{"family": "inet6", "local": "fd00::9999", "prefixlen": 128, "scope": "global"}],
            [
                {"family": "inet6", "local": "fd00::1234", "prefixlen": 128, "scope": "global"},
                "malformed",
            ],
        )
        try:
            for entries in cases:
                responses = [
                    [{"ifindex": 9, "ifname": "fips0", "linkinfo": {
                        "info_kind": "tun", "info_data": {"type": "tun"},
                    }}],
                    [{"ifname": "fips0", "addr_info": entries}],
                ]
                r3.base.run = lambda *_args, **_kwargs: types.SimpleNamespace(
                    stdout=json.dumps(responses.pop(0)).encode(),
                )
                with self.subTest(entries=entries), self.assertRaises(r3.base.LabRefusal):
                    r3.validate_namespace_fips0(1, "fd00::1234")
        finally:
            r3.base.run = original_run


if __name__ == "__main__":
    unittest.main()
