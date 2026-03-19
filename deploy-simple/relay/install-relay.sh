#!/usr/bin/env bash

set -euo pipefail

STAGE="${1:?stage is required (staging|production)}"
PAYLOAD_DIR="${2:-/tmp/relay-deploy}"
SERVICE_NAME="market-relay"
REMOTE_BIN="/usr/local/bin/market-relay"
REMOTE_ENV="/etc/market-relay.env"
REMOTE_SERVICE="/etc/systemd/system/${SERVICE_NAME}.service"

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

for path in "$BINARY_SOURCE" "$ENV_SOURCE" "$SERVICE_SOURCE"; do
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

set -a
source "$ENV_SOURCE"
set +a

sudo install -o root -g root -m 0755 "$BINARY_SOURCE" "$REMOTE_BIN"
sudo install -o root -g root -m 0644 "$ENV_SOURCE" "$REMOTE_ENV"
sudo install -o root -g root -m 0644 "$SERVICE_SOURCE" "$REMOTE_SERVICE"

for dir in "$RELAY_DATA_DIR" "$RELAY_RAW_DB_DIR"; do
	sudo mkdir -p "$dir"
	sudo chown "$USER:$USER" "$dir"
done

if [[ -e "$RELAY_SEARCH_INDEX_DIR" ]]; then
	sudo chown -R "$USER:$USER" "$RELAY_SEARCH_INDEX_DIR"
fi

sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"

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
	sudo systemctl daemon-reload
	sudo systemctl restart "$SERVICE_NAME" || true
	exit 1
fi

echo "Relay deployed successfully for ${STAGE}"
