#!/usr/bin/env bash
# Restart market-relay when /healthz stops answering.
#
# A process that is alive but not serving is invisible to Restart=on-failure;
# this is the only check that catches the hung-alive case.
set -u

UNIT="market-relay.service"
ENV_FILE="/etc/market-relay.env"

if [ -r "$ENV_FILE" ]; then
	# shellcheck disable=SC1091
	. "$ENV_FILE"
fi

ADDR="${RELAY_LISTEN_ADDR:-127.0.0.1:3334}"

if /usr/bin/curl -sf -m 3 "http://${ADDR}/healthz" >/dev/null 2>&1; then
	exit 0
fi

/usr/bin/systemctl kill -s SIGKILL "$UNIT" 2>/dev/null || true
/usr/bin/systemctl reset-failed "$UNIT" 2>/dev/null || true
/usr/bin/systemctl start "$UNIT" 2>/dev/null || true
