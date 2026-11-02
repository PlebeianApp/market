#!/usr/bin/python3
"""Prove the mesh controller passes literal source/argv to a fake SSH binary."""

from __future__ import annotations

import importlib.util
import json
import os
import stat
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
CONTROLLER = ROOT / "scripts/friday-fips-mesh-r1-controller.py"


def load_controller():
    spec = importlib.util.spec_from_file_location("friday_fips_mesh_controller", CONTROLLER)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> int:
    controller = load_controller()
    sentinel = "LOCAL_EXPANSION_SENTINEL_DO_NOT_FORWARD"
    with tempfile.TemporaryDirectory(prefix="friday-fips-mesh-command-") as td:
        root = Path(td)
        capture = root / "capture.json"
        fake_ssh = root / "fake-ssh.py"
        fake_ssh.write_text(
            "#!/usr/bin/python3\n"
            "import json, sys\n"
            f"p = {str(capture)!r}\n"
            "data = {'argv': sys.argv[1:], 'stdin': sys.stdin.read()}\n"
            "open(p, 'w', encoding='utf-8').write(json.dumps(data))\n",
            encoding="utf-8",
        )
        fake_ssh.chmod(stat.S_IRUSR | stat.S_IWUSR | stat.S_IXUSR)
        controller.SSH_BIN = str(fake_ssh)
        os.environ["FRIDAY_FAKE_LOCAL_SENTINEL"] = sentinel
        controller.run_remote(1, "install")
        value = json.loads(capture.read_text(encoding="utf-8"))

    expected_source = controller.REMOTE_SCRIPT.read_text(encoding="utf-8")
    assert value["stdin"] == expected_source
    assert "$(/usr/bin/sha256sum" in value["stdin"]
    assert "$(/usr/bin/stat" in value["stdin"]
    assert sentinel not in value["stdin"]
    assert sentinel not in "\n".join(value["argv"])
    assert "/usr/bin/env" not in value["stdin"]
    assert "env" not in value["argv"]
    assert value["argv"][-11:] == [
        "root@172.105.64.142",
        "/bin/bash", "-s", "--", "install", "1",
        "v1-fips.yaml", "v1-fips-mesh-r1.sha256", "yes", "91863", "",
    ]
    assert value["argv"][-2] == "91863"
    assert value["argv"][-1] == ""
    print("Friday FIPS mesh command construction: PASS (literal stdin, positional argv, no environment output)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
