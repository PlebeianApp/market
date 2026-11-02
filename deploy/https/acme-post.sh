#!/usr/bin/env bash
set -euo pipefail

# On initial issuance this starts the prepared proxy. On renewal it restores it.
# nginx.service runs its own ExecStartPre configuration check outside the ACME
# service's deliberately read-only filesystem sandbox.
systemctl start nginx.service
