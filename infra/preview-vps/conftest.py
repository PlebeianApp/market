"""Ensure the preview_manager module is importable when running pytest.

preview_manager.py lives in this directory (infra/preview-vps). Adding the
directory to sys.path lets `import preview_manager` work regardless of pytest
import mode or from which directory pytest is invoked.
"""

import os
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))
