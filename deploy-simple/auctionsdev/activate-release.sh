#!/usr/bin/env bash
set -euo pipefail

RELEASE_DIR="${1:?release directory is required}"
EXPECTED_MARKET_SHA="${2:?expected Market SHA is required}"
EXPECTED_CORE_SHA256="${3:?expected Core SHA-256 is required}"
EXPECTED_INDEXEDDB_SHA256="${4:?expected IndexedDB SHA-256 is required}"
EXPECTED_FRESH_TEST_SHA256="${5:?expected FRESH_AUCTIONSDEV_TEST SHA-256 is required}"
EXPECTED_SMOKE_RESULT_SHA256="${6:?expected COCO_AUCTIONSDEV_SMOKE_RESULT SHA-256 is required}"
EXPECTED_CORE_GIT_SHA="${7:?expected Core Git SHA is required}"
EXPECTED_MARKET_TREE="${8:?expected Market tree is required}"
APP_DIR='/home/deployer/market-auctionsdev'
CANDIDATE_CADDY="$RELEASE_DIR/deploy-simple/caddyfiles/Caddyfile.staging"
ECOSYSTEM="$RELEASE_DIR/deploy-simple/auctionsdev/ecosystem.config.cjs"
RUNTIME_ENV="$RELEASE_DIR/.env.runtime"
FAKE_MINT_NAME='market-coco-fake-mint-auctionsdev'
APP_NAME='market-auctionsdev'
CVM_NAME='market-contextvm-auctionsdev'
BUN_VERSION='1.4.2'
FAKE_MINT_VERSION='0.17.0-rc.0'
SWITCHED=0
CADDY_CHANGED=0
CADDY_BACKUP=''
FRESH_VERIFY_LOG=''
FRESH_VERIFY_RESULT=''

case "$RELEASE_DIR" in
	/home/deployer/releases/market-auctionsdev-*) ;;
	*) echo "Unsafe release directory: $RELEASE_DIR" >&2; exit 1 ;;
esac

load_runtime_env() {
	local env_file="$1"
	test -s "$env_file"
	set -a
	# Generated with Bash's %q escaping and never logged.
	# shellcheck disable=SC1090
	source "$env_file"
	set +a
}

start_release() {
	local root="$1"
	local config="$root/deploy-simple/auctionsdev/ecosystem.config.cjs"
	local pm2_bin
	load_runtime_env "$root/.env.runtime"
	pm2_bin="$(command -v pm2)"

	"$pm2_bin" delete "$FAKE_MINT_NAME" 2>/dev/null || true
	env -i HOME="$HOME" USER="${USER:-deployer}" PATH="$PATH" PM2_HOME="${PM2_HOME:-$HOME/.pm2}" \
		CASHU_MINT_DIR="$CASHU_MINT_DIR" CASHU_MINT_HOST="$CASHU_MINT_HOST" \
		CASHU_MINT_PORT="$CASHU_MINT_PORT" CASHU_MINT_PUBLIC_URL="$CASHU_MINT_PUBLIC_URL" \
		CDK_MINTD_MNEMONIC="$CDK_MINTD_MNEMONIC" \
		"$pm2_bin" start "$config" --only "$FAKE_MINT_NAME"

	"$pm2_bin" delete "$APP_NAME" 2>/dev/null || true
	env -i HOME="$HOME" USER="${USER:-deployer}" PATH="$PATH" PM2_HOME="${PM2_HOME:-$HOME/.pm2}" \
		APP_STAGE="$APP_STAGE" NODE_ENV="$NODE_ENV" PORT="$PORT" APP_RELAY_URL="$APP_RELAY_URL" \
		APP_PRIVATE_KEY="$APP_PRIVATE_KEY" CVM_SERVER_KEY="$CVM_SERVER_KEY" NIP46_RELAY_URL="$NIP46_RELAY_URL" \
		APP_DEPLOYMENT_ENVIRONMENT="$APP_DEPLOYMENT_ENVIRONMENT" APP_MARKET_GIT_SHA="$APP_MARKET_GIT_SHA" \
		APP_MARKET_GIT_TREE="$APP_MARKET_GIT_TREE" \
		APP_COCO_PACKAGE_IDENTITY="$APP_COCO_PACKAGE_IDENTITY" APP_COCO_CORE_SHA256="$APP_COCO_CORE_SHA256" \
		APP_COCO_CORE_GIT_SHA="$APP_COCO_CORE_GIT_SHA" APP_COCO_CORE_ARCHIVE_SHA256="$APP_COCO_CORE_ARCHIVE_SHA256" \
		APP_COCO_INDEXEDDB_ARCHIVE_SHA256="$APP_COCO_INDEXEDDB_ARCHIVE_SHA256" \
		APP_COCO_INDEXEDDB_SHA256="$APP_COCO_INDEXEDDB_SHA256" APP_CASHU_TS_VERSION="$APP_CASHU_TS_VERSION" \
		APP_CASHU_TS_SHA256="$APP_CASHU_TS_SHA256" APP_FAKE_MINT_VERSION="$APP_FAKE_MINT_VERSION" \
		APP_BUN_VERSION="$APP_BUN_VERSION" APP_MONETARY_MODE="$APP_MONETARY_MODE" \
		APP_MINT_MODE="$APP_MINT_MODE" APP_REAL_FUNDS_ENABLED="$APP_REAL_FUNDS_ENABLED" \
		APP_FRESH_AUCTIONSDEV_TEST_SHA256="$APP_FRESH_AUCTIONSDEV_TEST_SHA256" \
		APP_FRESH_AUCTIONSDEV_TEST_VERDICT="$APP_FRESH_AUCTIONSDEV_TEST_VERDICT" \
		APP_FRESH_NAMESPACE_COMMITMENT="$APP_FRESH_NAMESPACE_COMMITMENT" \
		APP_FRESH_REPORT_COMMITMENT="$APP_FRESH_REPORT_COMMITMENT" \
		APP_FRESH_ENVELOPE_COMMITMENT="$APP_FRESH_ENVELOPE_COMMITMENT" \
		APP_FRESH_EVIDENCE_ENVIRONMENT="$APP_FRESH_EVIDENCE_ENVIRONMENT" \
		APP_COCO_AUCTIONSDEV_SMOKE_SHA256="$APP_COCO_AUCTIONSDEV_SMOKE_SHA256" \
		APP_COCO_AUCTIONSDEV_SMOKE_STATUS="$APP_COCO_AUCTIONSDEV_SMOKE_STATUS" \
		APP_COCO_AUCTIONSDEV_SMOKE_ENVELOPE_COMMITMENT="$APP_COCO_AUCTIONSDEV_SMOKE_ENVELOPE_COMMITMENT" \
		APP_COCO_AUCTIONSDEV_SMOKE_SCHEMA_VERSION="$APP_COCO_AUCTIONSDEV_SMOKE_SCHEMA_VERSION" \
		APP_COCO_AUCTIONSDEV_SMOKE_COLD_START="$APP_COCO_AUCTIONSDEV_SMOKE_COLD_START" \
		APP_COCO_AUCTIONSDEV_SMOKE_CHECKS_PASSED="$APP_COCO_AUCTIONSDEV_SMOKE_CHECKS_PASSED" \
		"$pm2_bin" start "$config" --only "$APP_NAME"

	"$pm2_bin" delete "$CVM_NAME" 2>/dev/null || true
	env -i HOME="$HOME" USER="${USER:-deployer}" PATH="$PATH" PM2_HOME="${PM2_HOME:-$HOME/.pm2}" \
		APP_STAGE="$APP_STAGE" NODE_ENV="$NODE_ENV" APP_RELAY_URL="$APP_RELAY_URL" CVM_SERVER_KEY="$CVM_SERVER_KEY" \
		"$pm2_bin" start "$config" --only "$CVM_NAME"
}

start_legacy_release() {
	local root="$1"
	cd "$root"
	pm2 startOrReload ecosystem.config.cjs --only "$FAKE_MINT_NAME" 2>/dev/null || true
	pm2 startOrReload ecosystem.config.cjs --only "$APP_NAME"
	pm2 startOrReload ecosystem.config.cjs --only "$CVM_NAME"
}

if [[ -e "$APP_DIR" && ! -L "$APP_DIR" ]]; then
	echo "Active AuctionsDev path must be a symlink: $APP_DIR" >&2
	exit 1
fi
PREVIOUS_RELEASE="$(readlink -f "$APP_DIR" 2>/dev/null || true)"
if [[ -n "$PREVIOUS_RELEASE" && ! -d "$PREVIOUS_RELEASE" ]]; then
	echo 'Active AuctionsDev symlink does not resolve to a directory' >&2
	exit 1
fi

rollback() {
	local exit_code=$?
	trap - ERR
	set +e
	echo "Activation failed with status $exit_code; preserving candidate release and logs" >&2
	if [[ -n "$FRESH_VERIFY_LOG" ]]; then rm -f "$FRESH_VERIFY_LOG"; fi
	if [[ -n "$FRESH_VERIFY_RESULT" ]]; then rm -f "$FRESH_VERIFY_RESULT"; fi

	if [[ "$CADDY_CHANGED" = '1' && -n "$CADDY_BACKUP" && -s "$CADDY_BACKUP" ]]; then
		sudo caddy validate --config "$CADDY_BACKUP" --adapter caddyfile >/dev/null && \
			sudo install -m 0644 "$CADDY_BACKUP" /etc/caddy/Caddyfile && \
			sudo caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
	fi

	if [[ -n "$PREVIOUS_RELEASE" ]]; then
		echo "ROLLBACK_TO_PREVIOUS_RELEASE=$PREVIOUS_RELEASE"
		ln -sfn "$PREVIOUS_RELEASE" "$APP_DIR"
		if [[ -s "$PREVIOUS_RELEASE/.env.runtime" && -f "$PREVIOUS_RELEASE/deploy-simple/auctionsdev/ecosystem.config.cjs" ]]; then
			start_release "$PREVIOUS_RELEASE"
		else
			start_legacy_release "$PREVIOUS_RELEASE"
		fi
		pm2 save --force
	else
		echo 'NO_PREVIOUS_RELEASE'
		pm2 delete "$FAKE_MINT_NAME" "$APP_NAME" "$CVM_NAME" 2>/dev/null || true
		if [[ "$SWITCHED" = '1' && "$(readlink -f "$APP_DIR" 2>/dev/null || true)" = "$RELEASE_DIR" ]]; then
			rm -f "$APP_DIR"
		fi
		pm2 save --force
	fi

	exit "$exit_code"
}
trap rollback ERR

test -x "$RELEASE_DIR/runtime/bun"
test -x "$RELEASE_DIR/runtime/cdk-mintd"
test -s "$RUNTIME_ENV"
test -f "$ECOSYSTEM"
test -s "$CANDIDATE_CADDY"
test "$($RELEASE_DIR/runtime/bun --version)" = "$BUN_VERSION"
test "$($RELEASE_DIR/runtime/cdk-mintd --version)" = "cdk-mintd $FAKE_MINT_VERSION"

"$RELEASE_DIR/runtime/bun" "$RELEASE_DIR/scripts/verify-auctionsdev-package.ts" \
	--root "$RELEASE_DIR" \
	--market-sha "$EXPECTED_MARKET_SHA" \
	--market-tree "$EXPECTED_MARKET_TREE" \
	--core-git-sha "$EXPECTED_CORE_GIT_SHA" \
	--core-sha256 "$EXPECTED_CORE_SHA256" \
	--indexeddb-sha256 "$EXPECTED_INDEXEDDB_SHA256" \
	--fresh-test "$RELEASE_DIR/fresh-auctionsdev-test.json" \
	--fresh-public-report "$RELEASE_DIR/fresh-auctionsdev-public-report.json" \
	--fresh-test-sha256 "$EXPECTED_FRESH_TEST_SHA256" \
	--smoke-result "$RELEASE_DIR/coco-auctionsdev-smoke-result.json" \
	--smoke-result-sha256 "$EXPECTED_SMOKE_RESULT_SHA256"

load_runtime_env "$RUNTIME_ENV"
MANIFEST_COCO_IDENTITY="$("$RELEASE_DIR/runtime/bun" -e "const m = await Bun.file(process.argv[1]).json(); process.stdout.write(m.cocoPackageIdentity)" "$RELEASE_DIR/deployment-manifest.json")"
MANIFEST_CORE_ARCHIVE_SHA256="$("$RELEASE_DIR/runtime/bun" -e "const m = await Bun.file(process.argv[1]).json(); process.stdout.write(m.archives.cocoCore.sha256)" "$RELEASE_DIR/deployment-manifest.json")"
MANIFEST_INDEXEDDB_ARCHIVE_SHA256="$("$RELEASE_DIR/runtime/bun" -e "const m = await Bun.file(process.argv[1]).json(); process.stdout.write(m.archives.cocoIndexedDb.sha256)" "$RELEASE_DIR/deployment-manifest.json")"
MANIFEST_CASHU_TS_SHA256="$("$RELEASE_DIR/runtime/bun" -e "const m = await Bun.file(process.argv[1]).json(); process.stdout.write(m.packages.cashuTs.sha256)" "$RELEASE_DIR/deployment-manifest.json")"
MANIFEST_FRESH_NAMESPACE_COMMITMENT="$("$RELEASE_DIR/runtime/bun" -e "const m = await Bun.file(process.argv[1]).json(); process.stdout.write(m.freshAuctionsdevTest.result.namespaceCommitment)" "$RELEASE_DIR/deployment-manifest.json")"
MANIFEST_FRESH_REPORT_COMMITMENT="$("$RELEASE_DIR/runtime/bun" -e "const m = await Bun.file(process.argv[1]).json(); process.stdout.write(m.freshAuctionsdevTest.result.reportCommitment)" "$RELEASE_DIR/deployment-manifest.json")"
MANIFEST_FRESH_ENVELOPE_COMMITMENT="$("$RELEASE_DIR/runtime/bun" -e "const m = await Bun.file(process.argv[1]).json(); process.stdout.write(m.freshAuctionsdevTest.envelopeCommitment)" "$RELEASE_DIR/deployment-manifest.json")"
MANIFEST_SMOKE_ENVELOPE_COMMITMENT="$("$RELEASE_DIR/runtime/bun" -e "const m = await Bun.file(process.argv[1]).json(); process.stdout.write(m.cocoAuctionsdevSmoke.envelopeCommitment)" "$RELEASE_DIR/deployment-manifest.json")"
: "${APP_STAGE:?APP_STAGE is required}"
: "${NODE_ENV:?NODE_ENV is required}"
: "${PORT:?PORT is required}"
: "${APP_RELAY_URL:?APP_RELAY_URL is required}"
: "${APP_PRIVATE_KEY:?APP_PRIVATE_KEY is required}"
: "${CVM_SERVER_KEY:?CVM_SERVER_KEY is required}"
: "${NIP46_RELAY_URL:?NIP46_RELAY_URL is required}"
: "${CASHU_MINT_DIR:?CASHU_MINT_DIR is required}"
: "${CASHU_MINT_PUBLIC_URL:?CASHU_MINT_PUBLIC_URL is required}"
: "${CDK_MINTD_MNEMONIC:?CDK_MINTD_MNEMONIC is required}"
: "${AUCTIONSDEV_FRESH_WALLET_ACCOUNT_PUBKEY:?AUCTIONSDEV_FRESH_WALLET_ACCOUNT_PUBKEY is required}"
test "$APP_DEPLOYMENT_ENVIRONMENT" = 'auctionsdev'
test "$APP_MARKET_GIT_SHA" = "$EXPECTED_MARKET_SHA"
test "$APP_MARKET_GIT_TREE" = "$EXPECTED_MARKET_TREE"
test "$APP_COCO_PACKAGE_IDENTITY" = "$MANIFEST_COCO_IDENTITY"
test "$APP_COCO_CORE_GIT_SHA" = "$EXPECTED_CORE_GIT_SHA"
test "$APP_COCO_CORE_ARCHIVE_SHA256" = "$MANIFEST_CORE_ARCHIVE_SHA256"
test "$APP_COCO_CORE_SHA256" = "$EXPECTED_CORE_SHA256"
test "$APP_COCO_INDEXEDDB_ARCHIVE_SHA256" = "$MANIFEST_INDEXEDDB_ARCHIVE_SHA256"
test "$APP_COCO_INDEXEDDB_SHA256" = "$EXPECTED_INDEXEDDB_SHA256"
test "$APP_CASHU_TS_VERSION" = '5.0.0-rc.4'
test "$APP_CASHU_TS_SHA256" = "$MANIFEST_CASHU_TS_SHA256"
test "$APP_FAKE_MINT_VERSION" = "$FAKE_MINT_VERSION"
test "$APP_BUN_VERSION" = "$BUN_VERSION"
test "$APP_MONETARY_MODE" = 'coco-test'
test "$APP_MINT_MODE" = 'fake'
test "$APP_REAL_FUNDS_ENABLED" = 'false'
test "$APP_FRESH_AUCTIONSDEV_TEST_SHA256" = "$EXPECTED_FRESH_TEST_SHA256"
test "$APP_FRESH_AUCTIONSDEV_TEST_VERDICT" = 'FRESH_AUCTIONSDEV_READY'
test "$APP_FRESH_NAMESPACE_COMMITMENT" = "$MANIFEST_FRESH_NAMESPACE_COMMITMENT"
test "$APP_FRESH_REPORT_COMMITMENT" = "$MANIFEST_FRESH_REPORT_COMMITMENT"
test "$APP_FRESH_ENVELOPE_COMMITMENT" = "$MANIFEST_FRESH_ENVELOPE_COMMITMENT"
test "$APP_FRESH_EVIDENCE_ENVIRONMENT" = 'test'
test "$APP_COCO_AUCTIONSDEV_SMOKE_SHA256" = "$EXPECTED_SMOKE_RESULT_SHA256"
test "$APP_COCO_AUCTIONSDEV_SMOKE_STATUS" = 'passed'
test "$APP_COCO_AUCTIONSDEV_SMOKE_ENVELOPE_COMMITMENT" = "$MANIFEST_SMOKE_ENVELOPE_COMMITMENT"
test "$APP_COCO_AUCTIONSDEV_SMOKE_SCHEMA_VERSION" = '2'
test "$APP_COCO_AUCTIONSDEV_SMOKE_COLD_START" = 'true'
test "$APP_COCO_AUCTIONSDEV_SMOKE_CHECKS_PASSED" = '10'
[[ "$AUCTIONSDEV_FRESH_WALLET_ACCOUNT_PUBKEY" =~ ^[0-9a-f]{64}$ ]]
test "$CASHU_MINT_HOST" = '127.0.0.1'
test "$CASHU_MINT_PORT" = '3338'

# Re-run the canonical offline verifier against the packaged public report. Its
# public result must be byte-for-byte equivalent to the one inside the bound envelope.
FRESH_VERIFY_LOG="$(mktemp "$RELEASE_DIR/.fresh-wallet-verify.XXXXXX")"
FRESH_VERIFY_RESULT="$(mktemp "$RELEASE_DIR/.fresh-wallet-result.XXXXXX")"
AUCTIONSDEV_MARKET_COMMIT_SHA="$EXPECTED_MARKET_SHA" \
	AUCTIONSDEV_COCO_ENVIRONMENT_ID=test \
	AUCTIONSDEV_ACCOUNT_PUBKEY="$AUCTIONSDEV_FRESH_WALLET_ACCOUNT_PUBKEY" \
	"$RELEASE_DIR/runtime/bun" --cwd "$RELEASE_DIR" run preflight:auctionsdev:fresh-wallet "$RELEASE_DIR/fresh-auctionsdev-public-report.json" >"$FRESH_VERIFY_LOG"
"$RELEASE_DIR/runtime/bun" "$RELEASE_DIR/scripts/check-auctionsdev-fresh-wallet-result.ts" \
	--market-sha "$EXPECTED_MARKET_SHA" --log "$FRESH_VERIFY_LOG" --write-result "$FRESH_VERIFY_RESULT" >/dev/null
"$RELEASE_DIR/runtime/bun" -e "
	const actual = await Bun.file(process.argv[1]).json()
	const manifest = await Bun.file(process.argv[2]).json()
	if (JSON.stringify(actual) !== JSON.stringify(manifest.freshAuctionsdevTest.result)) process.exit(1)
" "$FRESH_VERIFY_RESULT" "$RELEASE_DIR/deployment-manifest.json"
rm -f "$FRESH_VERIFY_LOG" "$FRESH_VERIFY_RESULT"
FRESH_VERIFY_LOG=''
FRESH_VERIFY_RESULT=''

# Validate candidate syntax before the active Caddyfile is touched.
sudo caddy validate --config "$CANDIDATE_CADDY" --adapter caddyfile
test "$(grep -cF 'handle_path /fake-mint/*' "$CANDIDATE_CADDY")" = '1'
if grep -Eq '^plebeian\.market[[:space:]]*\{' "$CANDIDATE_CADDY"; then
	echo 'The staging Caddyfile must not define the production host' >&2
	exit 1
fi

# A backup is restorable only when it is non-empty and independently valid.
if sudo test -s /etc/caddy/Caddyfile; then
	CADDY_BACKUP="$(mktemp /home/deployer/caddy-auctionsdev-backup.XXXXXX)"
	sudo cp /etc/caddy/Caddyfile "$CADDY_BACKUP"
	sudo chown "$(id -u):$(id -g)" "$CADDY_BACKUP"
	test -s "$CADDY_BACKUP"
	sudo caddy validate --config "$CADDY_BACKUP" --adapter caddyfile
fi

ln -sfn "$RELEASE_DIR" "$APP_DIR"
SWITCHED=1
start_release "$RELEASE_DIR"

for attempt in $(seq 1 30); do
	if curl --silent --show-error --fail --max-time 3 http://127.0.0.1:3338/v1/info >/dev/null; then break; fi
	if [[ "$attempt" = '30' ]]; then
		pm2 logs "$FAKE_MINT_NAME" --lines 50 --nostream || true
		exit 1
	fi
	sleep 1
done

for attempt in $(seq 1 30); do
	CVM_PID="$(pm2 pid "$CVM_NAME")"
	APP_PID="$(pm2 pid "$APP_NAME")"
	if [[ "$CVM_PID" =~ ^[1-9][0-9]*$ && "$APP_PID" =~ ^[1-9][0-9]*$ ]]; then break; fi
	if [[ "$attempt" = '30' ]]; then
		pm2 logs "$CVM_NAME" --lines 50 --nostream || true
		exit 1
	fi
	sleep 1
done

FAKE_MINT_PID="$(pm2 pid "$FAKE_MINT_NAME")"
[[ "$FAKE_MINT_PID" =~ ^[1-9][0-9]*$ ]]
RUNNING_FAKE_MINT="$(readlink -f "/proc/$FAKE_MINT_PID/exe")"
test "$RUNNING_FAKE_MINT" = "$(readlink -f "$RELEASE_DIR/runtime/cdk-mintd")"
test "$($RUNNING_FAKE_MINT --version)" = "cdk-mintd $FAKE_MINT_VERSION"
RUNNING_APP="$(readlink -f "/proc/$APP_PID/exe")"
RUNNING_CVM="$(readlink -f "/proc/$CVM_PID/exe")"
PACKAGED_BUN="$(readlink -f "$RELEASE_DIR/runtime/bun")"
test "$RUNNING_APP" = "$PACKAGED_BUN"
test "$RUNNING_CVM" = "$PACKAGED_BUN"
test "$($RUNNING_APP --version)" = "$BUN_VERSION"
test "$($RUNNING_CVM --version)" = "$BUN_VERSION"

for attempt in $(seq 1 30); do
	if "$RELEASE_DIR/runtime/bun" "$RELEASE_DIR/scripts/check-auctionsdev-coco-health.ts" \
		--origin http://127.0.0.1:3002 \
		--mint-url http://127.0.0.1:3338 \
		--market-sha "$EXPECTED_MARKET_SHA" \
		--market-tree "$EXPECTED_MARKET_TREE" \
		--coco-identity "$APP_COCO_PACKAGE_IDENTITY" \
		--core-git-sha "$EXPECTED_CORE_GIT_SHA" \
		--core-archive-sha256 "$MANIFEST_CORE_ARCHIVE_SHA256" \
		--core-sha256 "$EXPECTED_CORE_SHA256" \
		--indexeddb-archive-sha256 "$MANIFEST_INDEXEDDB_ARCHIVE_SHA256" \
		--indexeddb-sha256 "$EXPECTED_INDEXEDDB_SHA256" \
		--cashu-ts-sha256 "$APP_CASHU_TS_SHA256" \
		--fresh-test-sha256 "$EXPECTED_FRESH_TEST_SHA256" \
		--fresh-envelope-commitment "$MANIFEST_FRESH_ENVELOPE_COMMITMENT" \
		--fresh-namespace-commitment "$MANIFEST_FRESH_NAMESPACE_COMMITMENT" \
		--fresh-report-commitment "$MANIFEST_FRESH_REPORT_COMMITMENT" \
		--smoke-result-sha256 "$EXPECTED_SMOKE_RESULT_SHA256" \
		--smoke-envelope-commitment "$MANIFEST_SMOKE_ENVELOPE_COMMITMENT" \
		--fake-mint-version "$FAKE_MINT_VERSION" \
		--bun-version "$BUN_VERSION"; then break; fi
	if [[ "$attempt" = '30' ]]; then
		pm2 logs "$APP_NAME" --lines 50 --nostream || true
		exit 1
	fi
	sleep 1
done

sudo install -m 0644 "$CANDIDATE_CADDY" /etc/caddy/Caddyfile
CADDY_CHANGED=1
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile

"$RELEASE_DIR/runtime/bun" "$RELEASE_DIR/scripts/check-auctionsdev-coco-health.ts" \
	--origin https://auctionsdev.plebeian.market \
	--market-sha "$EXPECTED_MARKET_SHA" \
	--market-tree "$EXPECTED_MARKET_TREE" \
	--coco-identity "$APP_COCO_PACKAGE_IDENTITY" \
	--core-git-sha "$EXPECTED_CORE_GIT_SHA" \
	--core-archive-sha256 "$MANIFEST_CORE_ARCHIVE_SHA256" \
	--core-sha256 "$EXPECTED_CORE_SHA256" \
	--indexeddb-archive-sha256 "$MANIFEST_INDEXEDDB_ARCHIVE_SHA256" \
	--indexeddb-sha256 "$EXPECTED_INDEXEDDB_SHA256" \
	--cashu-ts-sha256 "$APP_CASHU_TS_SHA256" \
	--fresh-test-sha256 "$EXPECTED_FRESH_TEST_SHA256" \
	--fresh-envelope-commitment "$MANIFEST_FRESH_ENVELOPE_COMMITMENT" \
	--fresh-namespace-commitment "$MANIFEST_FRESH_NAMESPACE_COMMITMENT" \
	--fresh-report-commitment "$MANIFEST_FRESH_REPORT_COMMITMENT" \
	--smoke-result-sha256 "$EXPECTED_SMOKE_RESULT_SHA256" \
	--smoke-envelope-commitment "$MANIFEST_SMOKE_ENVELOPE_COMMITMENT" \
	--fake-mint-version "$FAKE_MINT_VERSION" \
	--bun-version "$BUN_VERSION"

pm2 save --force
trap - ERR
if [[ -n "$CADDY_BACKUP" ]]; then rm -f "$CADDY_BACKUP"; fi
echo "AUCTIONSDEV_ACTIVATED=$EXPECTED_MARKET_SHA"
