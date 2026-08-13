#!/usr/bin/env bash
# Start a local Cashu mint for Plebeian Market e2e tests.
#
# Uses the Cashu (nutshell) FakeWallet backend which auto-settles
# Lightning invoices instantly — no external Lightning node needed.
#
# The mint listens on http://127.0.0.1:3338 by default.
# Override with CASHU_MINT_PORT and CASHU_MINT_HOST env vars.
set -euo pipefail

MINT_DIR="${CASHU_MINT_DIR:-/tmp/cashu-mint-e2e}"
MINT_PORT="${CASHU_MINT_PORT:-3338}"
MINT_HOST="${CASHU_MINT_HOST:-127.0.0.1}"

# Find a Python interpreter that has cashu installed
CASHU_PYTHON=""
for candidate in python3 /opt/miniconda/bin/python3.13 /usr/bin/python3; do
    if command -v "$candidate" &>/dev/null && "$candidate" -c "import cashu" 2>/dev/null; then
        CASHU_PYTHON="$candidate"
        break
    fi
done

if [ -z "$CASHU_PYTHON" ]; then
    echo "ERROR: cashu is not installed in any Python interpreter." >&2
    echo "Install with: pip install cashu" >&2
    exit 1
fi

mkdir -p "$MINT_DIR"

# Write the mint configuration
cat > "$MINT_DIR/.env" << EOF
MINT_LISTEN_HOST=$MINT_HOST
MINT_LISTEN_PORT=$MINT_PORT
MINT_HOST=localhost
MINT_PORT=$MINT_PORT
MINT_DATABASE=data/mint
MINT_PRIVATE_KEY=0000000000000000000000000000000000000000000000000000000000000001
MINT_BACKEND_BOLT11_SAT=FakeWallet
MINT_INFO_NAME=Plebeian Test Mint
MINT_INFO_DESCRIPTION=Local test mint for e2e tests
MINT_RATE_LIMIT=False
MINT_INPUT_FEE_PPK=0
FAKEWALLET_DELAY_INCOMING_PAYMENT=0
FAKEWALLET_DELAY_OUTGOING_PAYMENT=0
EOF

cd "$MINT_DIR"
exec "$CASHU_PYTHON" -m cashu.mint --port "$MINT_PORT" --host "$MINT_HOST"
