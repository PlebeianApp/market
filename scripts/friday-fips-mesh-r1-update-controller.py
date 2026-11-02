#!/usr/bin/python3
from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("mesh_controller", ROOT / "scripts/friday-fips-mesh-r1-controller.py")
assert spec is not None and spec.loader is not None
controller = importlib.util.module_from_spec(spec)
spec.loader.exec_module(controller)
controller.REMOTE_SCRIPT = ROOT / "scripts/friday-fips-mesh-r1-remote-update.sh"


def main() -> int:
    slot = int(sys.argv[1])
    host = controller.HOSTS[slot]
    stage = f"/tmp/plebeian-friday-fips-mesh-r1-corrected-v{slot}"
    controller.assert_local_packet()
    controller.run_remote(slot, "prepare")
    subprocess.run(
        [
            controller.SCP_BIN, "-q", *controller.SSH_OPTIONS,
            str(ROOT / "deploy/friday/fips-mesh-r1/plebeian-friday-fips-mesh-r1.service"),
            str(ROOT / "deploy/friday/fips-mesh-r1" / host["manifest"]),
            f"root@{host['ip']}:{stage}/",
        ],
        env={"SSH_AUTH_SOCK": controller.SSH_AUTH_SOCK, "PATH": "/usr/bin:/bin"},
        check=True,
    )
    controller.run_remote(slot, "install")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
