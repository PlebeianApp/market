#!/usr/bin/env bash

set -euo pipefail

STAGE="${1:?stage is required (staging|production)}"
PAYLOAD_DIR="${2:-/tmp/relay-deploy}"
SERVICE_NAME="market-relay"
REMOTE_BIN="/usr/local/bin/market-relay"
REMOTE_ENV="/etc/market-relay.env"
REMOTE_SERVICE="/etc/systemd/system/${SERVICE_NAME}.service"
REMOTE_DROPIN_DIR="/etc/systemd/system/${SERVICE_NAME}.service.d"
REMOTE_LIMITS="${REMOTE_DROPIN_DIR}/20-limits.conf"
REMOTE_WATCHDOG_BIN="/usr/local/bin/market-relay-watchdog"
REMOTE_WATCHDOG_SERVICE="/etc/systemd/system/market-relay-watchdog.service"
REMOTE_WATCHDOG_TIMER="/etc/systemd/system/market-relay-watchdog.timer"
CONTROL_DIR="/etc/systemd/system.control/${SERVICE_NAME}.service.d"
CONTROL_MEMORY_HIGH="${CONTROL_DIR}/50-MemoryHigh.conf"
CONTROL_MEMORY_MAX="${CONTROL_DIR}/50-MemoryMax.conf"

case "$STAGE" in
	staging|production) ;;
	*)
		echo "Unsupported stage: $STAGE"
		exit 1
		;;
esac

BINARY_SOURCE="${PAYLOAD_DIR}/market-relay"
ENV_SOURCE="${PAYLOAD_DIR}/${STAGE}.env"
SERVICE_SOURCE="${PAYLOAD_DIR}/market-relay.service"
LIMITS_SOURCE="${PAYLOAD_DIR}/20-limits.conf"
WATCHDOG_BIN_SOURCE="${PAYLOAD_DIR}/market-relay-watchdog.sh"
WATCHDOG_SERVICE_SOURCE="${PAYLOAD_DIR}/market-relay-watchdog.service"
WATCHDOG_TIMER_SOURCE="${PAYLOAD_DIR}/market-relay-watchdog.timer"

for path in "$BINARY_SOURCE" "$ENV_SOURCE" "$SERVICE_SOURCE" \
            "$LIMITS_SOURCE" "$WATCHDOG_BIN_SOURCE" \
            "$WATCHDOG_SERVICE_SOURCE" "$WATCHDOG_TIMER_SOURCE"; do
	if [[ ! -f "$path" ]]; then
		echo "Missing deploy artifact: $path"
		exit 1
	fi
done

TMP_PREV_DIR="$(mktemp -d)"
cleanup() {
	rm -rf "$TMP_PREV_DIR"
}
trap cleanup EXIT

backup_if_exists() {
	local source_path="$1"
	local target_path="$2"
	if [[ -f "$source_path" ]]; then
		sudo cp "$source_path" "$target_path"
	fi
}

restore_if_exists() {
	local source_path="$1"
	local target_path="$2"
	if [[ -f "$source_path" ]]; then
		sudo cp "$source_path" "$target_path"
	fi
}

backup_if_exists "$REMOTE_BIN" "$TMP_PREV_DIR/market-relay"
backup_if_exists "$REMOTE_ENV" "$TMP_PREV_DIR/market-relay.env"
backup_if_exists "$REMOTE_SERVICE" "$TMP_PREV_DIR/market-relay.service"
backup_if_exists "$CONTROL_MEMORY_HIGH" "$TMP_PREV_DIR/50-MemoryHigh.conf"
backup_if_exists "$CONTROL_MEMORY_MAX" "$TMP_PREV_DIR/50-MemoryMax.conf"

set -a
source "$ENV_SOURCE"
set +a

sudo install -o root -g root -m 0755 "$BINARY_SOURCE" "$REMOTE_BIN"
sudo install -o root -g root -m 0644 "$ENV_SOURCE" "$REMOTE_ENV"
sudo install -o root -g root -m 0644 "$SERVICE_SOURCE" "$REMOTE_SERVICE"

sudo install -d -m 0755 "$REMOTE_DROPIN_DIR"
sudo install -o root -g root -m 0644 "$LIMITS_SOURCE" "$REMOTE_LIMITS"
sudo install -o root -g root -m 0755 "$WATCHDOG_BIN_SOURCE" "$REMOTE_WATCHDOG_BIN"
sudo install -o root -g root -m 0644 "$WATCHDOG_SERVICE_SOURCE" "$REMOTE_WATCHDOG_SERVICE"
sudo install -o root -g root -m 0644 "$WATCHDOG_TIMER_SOURCE" "$REMOTE_WATCHDOG_TIMER"

for dir in "$RELAY_DATA_DIR" "$RELAY_RAW_DB_DIR"; do
	sudo mkdir -p "$dir"
	sudo chown "$USER:$USER" "$dir"
done

if [[ -e "$RELAY_SEARCH_INDEX_DIR" ]]; then
	sudo chown -R "$USER:$USER" "$RELAY_SEARCH_INDEX_DIR"
fi

for f in "$CONTROL_MEMORY_HIGH" "$CONTROL_MEMORY_MAX"; do
	if [[ -e "$f" ]]; then
		sudo rm -f "$f"
		echo "removed stale control drop-in: $f"
	fi
done

sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl enable --now market-relay-watchdog.timer

restart_and_verify() {
	sudo systemctl restart "$SERVICE_NAME"
	sleep 5
	sudo systemctl is-active "$SERVICE_NAME" >/dev/null
	curl -sf -H 'Accept: application/nostr+json' "http://${RELAY_LISTEN_ADDR}/" >/dev/null
}

if ! restart_and_verify; then
	echo "Relay restart failed, restoring previous version"
	sudo systemctl status "$SERVICE_NAME" --no-pager || true
	sudo journalctl -u "$SERVICE_NAME" -n 100 --no-pager || true
	restore_if_exists "$TMP_PREV_DIR/market-relay" "$REMOTE_BIN"
	restore_if_exists "$TMP_PREV_DIR/market-relay.env" "$REMOTE_ENV"
	restore_if_exists "$TMP_PREV_DIR/market-relay.service" "$REMOTE_SERVICE"
	restore_if_exists "$TMP_PREV_DIR/50-MemoryHigh.conf" "$CONTROL_MEMORY_HIGH"
	restore_if_exists "$TMP_PREV_DIR/50-MemoryMax.conf" "$CONTROL_MEMORY_MAX"
	sudo systemctl daemon-reload
	sudo systemctl restart "$SERVICE_NAME" || true
	exit 1
fi

echo "Relay deployed successfully for ${STAGE}"
