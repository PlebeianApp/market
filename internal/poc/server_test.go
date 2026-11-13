package poc

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const catalogueReleaseFridayBrowserSHA256 = "6fbcb16bc2c660ed5710a19aea8d52f820966013ed8d8fdde19500a1aac5f214"

func TestRemoteOfflineControlIsNotReachable(t *testing.T) {
	t.Parallel()
	server := &APIServer{manifest: NetworkManifest{ChainID: "remote", Mode: "remote"}, offline: nil}
	handler, err := server.Handler()
	if err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest(http.MethodPost, "/api/admin/offline", strings.NewReader(`{"slot":4}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), "disabled outside the loopback") {
		t.Fatalf("remote offline endpoint status=%d body=%s", response.Code, response.Body.String())
	}

	configRequest := httptest.NewRequest(http.MethodGet, "/api/config", nil)
	configResponse := httptest.NewRecorder()
	handler.ServeHTTP(configResponse, configRequest)
	if configResponse.Code != http.StatusOK || !strings.Contains(configResponse.Body.String(), `"fault_control_enabled":false`) {
		t.Fatalf("remote config status=%d body=%s", configResponse.Code, configResponse.Body.String())
	}

	faucetRequest := httptest.NewRequest(http.MethodPost, "/api/interim/faucet", strings.NewReader(`{"actor":"`+strings.Repeat("11", 32)+`"}`))
	faucetRequest.Header.Set("Content-Type", "application/json")
	faucetResponse := httptest.NewRecorder()
	handler.ServeHTTP(faucetResponse, faucetRequest)
	if faucetResponse.Code != http.StatusGone || !strings.Contains(faucetResponse.Body.String(), "custodial reservations") {
		t.Fatalf("interim faucet status=%d body=%s", faucetResponse.Code, faucetResponse.Body.String())
	}
}

func TestFridayPhoneUIHasPermanentDisclosuresAndNoVisibleRemoteFaultControl(t *testing.T) {
	t.Parallel()
	server := &APIServer{manifest: NetworkManifest{ChainID: "friday", Mode: "remote"}, offline: nil}
	handler, err := server.Handler()
	if err != nil {
		t.Fatal(err)
	}

	indexRequest := httptest.NewRequest(http.MethodGet, "/", nil)
	indexResponse := httptest.NewRecorder()
	handler.ServeHTTP(indexResponse, indexRequest)
	body := indexResponse.Body.String()
	for _, required := range []string{
		`name="viewport"`, `MVP · FAKE SATS`, `3-of-4 FROST monetary authorization`,
		`jmcorgan/fips transport`, `One operator · fake sats only · not production`,
		`id="description"`, `id="image"`, `id="increment"`, `id="faucet-amount"`,
		`id="process-payments"`, `type="module" src="/app-bootstrap.js"`,
	} {
		if !strings.Contains(body, required) {
			t.Fatalf("Friday index is missing %q", required)
		}
	}
	browserRequest := httptest.NewRequest(http.MethodGet, "/friday-browser.js", nil)
	browserResponse := httptest.NewRecorder()
	handler.ServeHTTP(browserResponse, browserRequest)
	if browserResponse.Code != http.StatusOK || !strings.Contains(browserResponse.Body.String(), "plebeianFridayConnect") {
		t.Fatalf("Friday Coco v2 browser bundle is absent or not served")
	}
	bootstrapRequest := httptest.NewRequest(http.MethodGet, "/app-bootstrap.js", nil)
	bootstrapResponse := httptest.NewRecorder()
	handler.ServeHTTP(bootstrapResponse, bootstrapRequest)
	if bootstrapResponse.Code != http.StatusOK ||
		!strings.Contains(bootstrapResponse.Body.String(), `import "/friday-browser.js";`) ||
		!strings.Contains(bootstrapResponse.Body.String(), `import "/app.js";`) ||
		strings.Contains(bootstrapResponse.Body.String(), `import "/demo-signer.js";`) ||
		!strings.Contains(browserResponse.Body.String(), "plebeianCreateDemoSigner") {
		t.Fatalf("Friday ES-module bootstrap is absent or does not order the browser bundle before the app")
	}
	if csp := indexResponse.Header().Get("Content-Security-Policy"); !strings.Contains(csp, "img-src 'self' data: https:") {
		t.Fatalf("Friday HTTPS item images are not bounded by the expected CSP: %q", csp)
	}
	if csp := indexResponse.Header().Get("Content-Security-Policy"); !strings.Contains(csp, "connect-src 'self' wss://relay.powr.build") || strings.Contains(csp, " wss: ") || strings.Contains(csp, " wss:;") {
		t.Fatalf("Friday Clave relay CSP is absent or broader than the reviewed relay: %q", csp)
	}

	cssRequest := httptest.NewRequest(http.MethodGet, "/styles.css", nil)
	cssResponse := httptest.NewRecorder()
	handler.ServeHTTP(cssResponse, cssRequest)
	if cssResponse.Code != http.StatusOK || !strings.Contains(cssResponse.Body.String(), "@media (max-width: 700px)") || !strings.Contains(cssResponse.Body.String(), "padding: .7rem 1rem") {
		t.Fatalf("Friday phone layout/touch target CSS is absent")
	}
}

func TestDevelopmentNsecSignerRequiresEveryExplicitGate(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name, build, environment string
		want                     bool
	}{
		{name: "all explicit development gates", build: "enabled", environment: "true", want: true},
		{name: "ordinary release build", build: "disabled", environment: "true"},
		{name: "missing runtime flag", build: "enabled", environment: ""},
		{name: "false runtime flag", build: "enabled", environment: "false"},
		{name: "near match rejected", build: "ENABLED", environment: "TRUE"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := devNsecSignerAllowed(test.build, test.environment); got != test.want {
				t.Fatalf("devNsecSignerAllowed(%q, %q) = %v, want %v", test.build, test.environment, got, test.want)
			}
		})
	}
}

func TestDevelopmentNsecConfigDefaultsOffAndCannotEscapeRemoteMode(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name string
		api  *APIServer
		want string
	}{
		{name: "ordinary local build", api: &APIServer{manifest: NetworkManifest{}}, want: `"dev_nsec_signer_enabled":false`},
		{name: "explicit local test", api: &APIServer{manifest: NetworkManifest{}, devNsecSignerEnabled: true}, want: `"dev_nsec_signer_enabled":true`},
		{name: "explicit remote test build", api: &APIServer{manifest: NetworkManifest{Mode: "remote"}, devNsecSignerEnabled: true}, want: `"dev_nsec_signer_enabled":true`},
	} {
		t.Run(test.name, func(t *testing.T) {
			handler, err := test.api.Handler()
			if err != nil {
				t.Fatal(err)
			}
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/config", nil))
			if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), test.want) {
				t.Fatalf("config status=%d body=%s, want %s", response.Code, response.Body.String(), test.want)
			}
		})
	}
}

func TestEmbeddedFridayBrowserBundleMatchesCatalogueRelease(t *testing.T) {
	t.Parallel()
	bundle, err := staticFiles.ReadFile("static/friday-browser.js")
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(bundle)
	if got := hex.EncodeToString(digest[:]); got != catalogueReleaseFridayBrowserSHA256 {
		t.Fatalf("embedded Friday browser SHA-256 = %s, want %s", got, catalogueReleaseFridayBrowserSHA256)
	}
}

func TestFridayThresholdConfigNeverFallsBackToSharedKeyBrowserFunding(t *testing.T) {
	t.Parallel()
	server := &APIServer{manifest: NetworkManifest{
		Schema: "PlebeianAuctionsPOCNetworkV4", ChainID: "friday", Mode: "remote",
	}, offline: nil}
	handler, err := server.Handler()
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, "/api/config", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	body := response.Body.String()
	for _, expected := range []string{
		`"threshold_custody":true`, `"fips_transport":true`, `"shared_application_key":false`,
		`"browser_threshold_admission_ready":false`, `"browser_threshold_wallet_ready":false`,
		`3-of-4 FROST admission`, `NUT-11 proof pools`,
	} {
		if !strings.Contains(body, expected) {
			t.Fatalf("Friday threshold config is missing %q: %s", expected, body)
		}
	}

	appRequest := httptest.NewRequest(http.MethodGet, "/app.js", nil)
	appResponse := httptest.NewRecorder()
	handler.ServeHTTP(appResponse, appRequest)
	if appResponse.Code != http.StatusOK || !strings.Contains(appResponse.Body.String(), "The reviewed R20 browser wallet and admission path is not active") {
		t.Fatalf("Friday browser does not fail closed when the R20 wallet is unavailable")
	}
	if !strings.Contains(appResponse.Body.String(), "plebeianFridayR20Connect") ||
		strings.Contains(appResponse.Body.String(), "plebeianFridayConnect?.") {
		t.Fatalf("Friday threshold page does not exclusively use the exact pin-gated R20 connector")
	}
	if !strings.Contains(appResponse.Body.String(), `api("/api/browser-release-pins", { signal: abort.signal })`) ||
		!strings.Contains(appResponse.Body.String(), "r20Pins(state.releasePins)") ||
		!strings.Contains(appResponse.Body.String(), "validateReadinessPins(pins)") ||
		!strings.Contains(appResponse.Body.String(), "JSON.stringify(runtimePins) !== JSON.stringify(r20Pins(pins))") ||
		!strings.Contains(appResponse.Body.String(), "fakeFundingPolicyDigest: config.fake_funding_policy_digest") ||
		strings.Contains(appResponse.Body.String(), "r20Pins(state.config)") {
		t.Fatalf("Friday threshold page does not consume the independently release-pinned browser manifest")
	}

	for _, endpoint := range []string{
		"/api/cashu/wallet/faucet", "/api/cashu/auction/reserve",
		"/api/cashu/auction/refund", "/api/cashu/auction/settle",
	} {
		directRequest := httptest.NewRequest(http.MethodPost, endpoint, strings.NewReader(`{"untrusted":true}`))
		directRequest.Header.Set("Content-Type", "application/json")
		directResponse := httptest.NewRecorder()
		handler.ServeHTTP(directResponse, directRequest)
		if directResponse.Code != http.StatusGone || !strings.Contains(directResponse.Body.String(), "custody fallback is disabled") {
			t.Fatalf("Friday direct legacy Cashu request %s was not rejected server-side: status=%d body=%s", endpoint, directResponse.Code, directResponse.Body.String())
		}
	}
}

func TestFridayThresholdLegacyTestMintAssemblyNamespaceIsNonOperational(t *testing.T) {
	t.Parallel()
	const legacyNamespace = "http://127.0.0.1:8180/test-mint"
	const cashuIdentity = "https://139.162.161.233"
	if err := validateFakeMoneyEndpoint(legacyNamespace, "/test-mint"); err != nil {
		t.Fatalf("source-compatible legacy namespace was rejected: %v", err)
	}
	if err := validateFakeMoneyEndpoint(cashuIdentity+"/test-mint", "/test-mint"); err == nil {
		t.Fatal("public Cashu identity was accepted as the private legacy namespace")
	}
	server := &APIServer{manifest: NetworkManifest{
		Schema: "PlebeianAuctionsPOCNetworkV4", ChainID: "friday", Mode: "remote",
		MintURL: legacyNamespace, CashuMintURL: cashuIdentity,
	}}
	handler, err := server.Handler()
	if err != nil {
		t.Fatal(err)
	}
	legacyResponse := httptest.NewRecorder()
	handler.ServeHTTP(legacyResponse, httptest.NewRequest(http.MethodGet, "/test-mint", nil))
	if legacyResponse.Code != http.StatusNotFound || strings.Contains(legacyResponse.Header().Get("Content-Type"), "application/json") {
		t.Fatalf("disabled legacy namespace became an operational API: status=%d content-type=%q body=%q",
			legacyResponse.Code, legacyResponse.Header().Get("Content-Type"), legacyResponse.Body.String())
	}
	configResponse := httptest.NewRecorder()
	handler.ServeHTTP(configResponse, httptest.NewRequest(http.MethodGet, "/api/config", nil))
	body := configResponse.Body.String()
	if configResponse.Code != http.StatusOK || !strings.Contains(body, `"mint_url":"`+legacyNamespace+`"`) ||
		!strings.Contains(body, `"cashu_mint_url":"`+cashuIdentity+`"`) {
		t.Fatalf("config did not preserve distinct legacy and Cashu identities: status=%d body=%s", configResponse.Code, body)
	}
}

func TestFridayFakeFundingPolicyGoldenIsRuntimeData(t *testing.T) {
	t.Parallel()
	policy := r20FakeFundingPolicy(Policy{FaucetAmount: 10_000, FaucetCap: 50_000})
	if policy["schema"] != r20FakeFundingPolicySchema || policy["max_per_request"] != int64(10_000) ||
		policy["max_resulting_balance"] != int64(50_000) || policy["enforcement"] != "browser_wallet_advisory_only" ||
		policy["digest"] != "3588ddbd214b3c1e57926b77a20c070249c1d468fbbe1592ff85e18daf4ae069" {
		t.Fatalf("unexpected policy golden: %#v", policy)
	}
	changed := r20FakeFundingPolicy(Policy{FaucetAmount: 100_000, FaucetCap: 250_000})
	if changed["digest"] == policy["digest"] || changed["max_per_request"] != int64(100_000) {
		t.Fatalf("runtime policy did not change independently: %#v", changed)
	}
}

func TestFridayAuctionPaymentPolicyPublishesExactBrowserAndPayoutCap(t *testing.T) {
	t.Parallel()
	policy := r20AuctionPaymentPolicy()
	if policy["schema"] != r20AuctionPaymentPolicySchema || policy["max_bid_amount"] != int64(50_000) ||
		policy["max_payout"] != int64(50_000) {
		t.Fatalf("unexpected auction payment policy: %#v", policy)
	}
	if digest := r20AuctionPaymentPolicyDigest(); digest != "4d88017e3d191421aa46702ca9b6670fb324162c4c39d3ce4604bbfcfec3492b" {
		t.Fatalf("unexpected auction payment policy digest: %s", digest)
	}
	if digest := r20AuctionPolicyDigest(DefaultPolicy()); digest != "257fb5bf2b414f206278ada15464030a075d6f4f51b9c2f6b965259136f9a777" {
		t.Fatalf("unexpected one-hour auction policy digest: %s", digest)
	}
	if digest := r20AuctionPolicyDigest(SevenDayPolicy()); digest != "827ba464a45f6c2e3a70665e86d05a1f7465bcfe8fb8438cce6b9943da849d5e" {
		t.Fatalf("unexpected inactive seven-day auction policy digest: %s", digest)
	}
}

func TestPolicyRejectsBrowserUnsafeFundingIntegers(t *testing.T) {
	t.Parallel()
	for _, policy := range []Policy{
		{FaucetAmount: 9_007_199_254_740_992, FaucetCap: 9_007_199_254_740_992,
			MinBidIncrement: 1, MinDurationSeconds: 1, MaxDurationSeconds: 1,
			EventSkewSeconds: 1, LateBidWindow: 1, LateBidExtension: 1,
			MaxTotalExtension: 1, ReceiptTTLSeconds: 1},
		{FaucetAmount: 1, FaucetCap: 9_007_199_254_740_992,
			MinBidIncrement: 1, MinDurationSeconds: 1, MaxDurationSeconds: 1,
			EventSkewSeconds: 1, LateBidWindow: 1, LateBidExtension: 1,
			MaxTotalExtension: 1, ReceiptTTLSeconds: 1},
	} {
		if err := policy.Validate(); err == nil {
			t.Fatalf("unsafe funding policy accepted: %+v", policy)
		}
	}
}

func TestFridayThresholdConfigRequiresExplicitReviewedActivation(t *testing.T) {
	t.Parallel()
	server := &APIServer{manifest: NetworkManifest{
		Schema: "PlebeianAuctionsPOCNetworkV4", ChainID: "friday", Mode: "remote",
	}, offline: nil, browserThresholdReady: true}
	handler, err := server.Handler()
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, "/api/config", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	body := response.Body.String()
	for _, expected := range []string{
		`"browser_threshold_admission_ready":false`, `"browser_threshold_wallet_ready":false`,
	} {
		if !strings.Contains(body, expected) {
			t.Fatalf("Friday activation without exact public pins is missing %q: %s", expected, body)
		}
	}

	// Activation never restores the incompatible Wednesday custody API.
	directRequest := httptest.NewRequest(http.MethodPost, "/api/cashu/wallet/faucet", strings.NewReader(`{"untrusted":true}`))
	directResponse := httptest.NewRecorder()
	handler.ServeHTTP(directResponse, directRequest)
	if directResponse.Code != http.StatusGone {
		t.Fatalf("Friday activation exposed legacy custody API: status=%d body=%s", directResponse.Code, directResponse.Body.String())
	}
}

func TestFridayThresholdConfigPublishesExactPinsOnlyWhenActivationIsComplete(t *testing.T) {
	t.Parallel()
	pins := FundingAbortPinsV1{AuthNetworkID: "friday-network-r20", ChainID: "friday-chain-r20",
		GenesisSHA256: strings.Repeat("11", 32), MintURL: "https://172.105.95.57",
		ActiveKeysetID: "active-keyset", CommitteePublicKey: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
		CommitteeKeysetID: "friday-demo-frost-keyset-v2", CommitteeKeysetVersion: "2",
		DKGRunID: "friday-demo-20261023-r20-dkg2", PublicKeyPackageSHA256: strings.Repeat("22", 32),
		SignerRosterDigest: strings.Repeat("33", 32)}
	releasePins := BrowserReleasePinsV1{Schema: browserReleasePinsSchemaV2,
		DeploymentID: fridayR20DeploymentID, AuthNetworkID: pins.AuthNetworkID, ChainID: pins.ChainID,
		GenesisSHA256: pins.GenesisSHA256, ValidatorsHash: strings.Repeat("55", 32), CashuMintURL: pins.MintURL,
		CommitteePublicKey: pins.CommitteePublicKey, CommitteeKeysetID: pins.CommitteeKeysetID,
		CommitteeKeysetVersion: pins.CommitteeKeysetVersion, DKGRunID: pins.DKGRunID,
		PublicKeyPackageSHA256: pins.PublicKeyPackageSHA256, SignerRosterDigest: pins.SignerRosterDigest,
		FakeFundingPolicyDigest: "3588ddbd214b3c1e57926b77a20c070249c1d468fbbe1592ff85e18daf4ae069",
		AuctionPolicyDigest:     "257fb5bf2b414f206278ada15464030a075d6f4f51b9c2f6b965259136f9a777",
		AuctionPaymentDigest:    "4d88017e3d191421aa46702ca9b6670fb324162c4c39d3ce4604bbfcfec3492b"}
	server := &APIServer{manifest: NetworkManifest{Schema: "PlebeianAuctionsPOCNetworkV4",
		DeploymentID: "friday-demo-20261023-r20", ChainID: pins.ChainID, Mode: "remote",
		CashuMintURL: pins.MintURL, CommitteePublicKey: pins.CommitteePublicKey, FundingAbortPins: &pins,
		Policy: DefaultPolicy()},
		browserThresholdReady: true, browserReleasePins: &releasePins,
		closeTriggerReady: func() bool { return true }, runtimeReadyProbe: func(context.Context) bool { return true }}
	handler, err := server.Handler()
	if err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/config", nil))
	body := response.Body.String()
	for _, expected := range []string{`"browser_threshold_admission_ready":true`,
		`"browser_threshold_wallet_ready":true`, `"automatic_close_healthy":true`, `"deployment_id":"friday-demo-20261023-r20"`,
		`"auth_network_id":"friday-network-r20"`, `"dkg_run_id":"friday-demo-20261023-r20-dkg2"`,
		`"validators_hash":"` + strings.Repeat("55", 32) + `"`,
		`"auction_policy_digest":"257fb5bf2b414f206278ada15464030a075d6f4f51b9c2f6b965259136f9a777"`,
		`"auction_payment_policy_digest":"4d88017e3d191421aa46702ca9b6670fb324162c4c39d3ce4604bbfcfec3492b"`,
		`"auction_policy":{"default_duration_seconds":600,"emergency_recovery_seconds":900,"late_bid_extension_seconds":180,"late_bid_window_seconds":180,"max_duration_seconds":3600,"max_total_extension_seconds":1800,"min_duration_seconds":3,"schema":"PLEBEIAN_AUCTION_TIMING_POLICY_V1"}`,
		`"auction_payment_policy":{"max_bid_amount":50000,"max_payout":50000,"schema":"PLEBEIAN_FRIDAY_AUCTION_PAYMENT_POLICY_V1"}`,
		`"fake_funding_policy":{"digest":"3588ddbd214b3c1e57926b77a20c070249c1d468fbbe1592ff85e18daf4ae069","enforcement":"browser_wallet_advisory_only","max_per_request":10000,"max_resulting_balance":50000,"schema":"PLEBEIAN_FRIDAY_R20_FAKE_FUNDING_POLICY_V1"}`,
		`"public_key_package_sha256":"` + strings.Repeat("22", 32) + `"`} {
		if !strings.Contains(body, expected) {
			t.Fatalf("exact threshold config is missing %q: %s", expected, body)
		}
	}
	pinsResponse := httptest.NewRecorder()
	handler.ServeHTTP(pinsResponse, httptest.NewRequest(http.MethodGet, "/api/browser-release-pins", nil))
	if pinsResponse.Code != http.StatusOK || !strings.Contains(pinsResponse.Body.String(),
		`"schema":"PLEBEIAN_FRIDAY_R20_BROWSER_RELEASE_PINS_V2"`) {
		t.Fatalf("independent browser release pins are unavailable: %d %s", pinsResponse.Code, pinsResponse.Body.String())
	}

	server.browserReleasePins.GenesisSHA256 = strings.Repeat("44", 32)
	mismatch := httptest.NewRecorder()
	handler.ServeHTTP(mismatch, httptest.NewRequest(http.MethodGet, "/api/config", nil))
	if !strings.Contains(mismatch.Body.String(), `"browser_threshold_admission_ready":false`) {
		t.Fatalf("runtime config did not fail closed against changed independent release pins: %s", mismatch.Body.String())
	}
	server.browserReleasePins.GenesisSHA256 = pins.GenesisSHA256
	server.browserReleasePins.FakeFundingPolicyDigest = strings.Repeat("44", 32)
	policyMismatch := httptest.NewRecorder()
	handler.ServeHTTP(policyMismatch, httptest.NewRequest(http.MethodGet, "/api/config", nil))
	if !strings.Contains(policyMismatch.Body.String(), `"browser_threshold_admission_ready":false`) {
		t.Fatalf("runtime config did not fail closed against changed funding policy pin: %s", policyMismatch.Body.String())
	}
	server.browserReleasePins.FakeFundingPolicyDigest = "3588ddbd214b3c1e57926b77a20c070249c1d468fbbe1592ff85e18daf4ae069"
	for name, mutate := range map[string]func(){
		"auction timing":  func() { server.browserReleasePins.AuctionPolicyDigest = strings.Repeat("44", 32) },
		"auction payment": func() { server.browserReleasePins.AuctionPaymentDigest = strings.Repeat("44", 32) },
	} {
		server.browserReleasePins.AuctionPolicyDigest = r20AuctionPolicyDigest(DefaultPolicy())
		server.browserReleasePins.AuctionPaymentDigest = r20AuctionPaymentPolicyDigest()
		mutate()
		mismatch := httptest.NewRecorder()
		handler.ServeHTTP(mismatch, httptest.NewRequest(http.MethodGet, "/api/config", nil))
		if !strings.Contains(mismatch.Body.String(), `"browser_threshold_admission_ready":false`) ||
			!strings.Contains(mismatch.Body.String(), `"browser_threshold_wallet_ready":false`) {
			t.Fatalf("runtime config did not fail closed against changed %s policy pin: %s", name, mismatch.Body.String())
		}
	}
	server.browserReleasePins.AuctionPolicyDigest = r20AuctionPolicyDigest(SevenDayPolicy())
	server.browserReleasePins.AuctionPaymentDigest = r20AuctionPaymentPolicyDigest()
	server.manifest.Policy = SevenDayPolicy()
	sevenDay := httptest.NewRecorder()
	handler.ServeHTTP(sevenDay, httptest.NewRequest(http.MethodGet, "/api/config", nil))
	if !strings.Contains(sevenDay.Body.String(), `"max_duration_seconds":604800`) ||
		!strings.Contains(sevenDay.Body.String(), `"browser_threshold_admission_ready":false`) ||
		!strings.Contains(sevenDay.Body.String(), `"browser_threshold_wallet_ready":false`) {
		t.Fatalf("unapproved seven-day policy became operational: %s", sevenDay.Body.String())
	}
}

func TestAuctionPolicyConfigDistinguishesRecoveryAndSevenDayCandidate(t *testing.T) {
	legacy := r20AuctionPolicy(DefaultPolicy())
	candidate := r20AuctionPolicy(SevenDayPolicy())
	if legacy["max_duration_seconds"] != LegacyMaxAuctionDurationSeconds ||
		candidate["max_duration_seconds"] != MaxAuctionDurationSeconds {
		t.Fatalf("auction policy profiles changed: legacy=%v candidate=%v", legacy, candidate)
	}
	for _, key := range []string{"late_bid_window_seconds", "late_bid_extension_seconds", "max_total_extension_seconds", "emergency_recovery_seconds"} {
		if legacy[key] != candidate[key] {
			t.Fatalf("anti-sniping or recovery policy changed for %s: legacy=%v candidate=%v", key, legacy[key], candidate[key])
		}
	}
}

func TestFridayRecoveryOnlyBlocksEverySiteMutationServerSide(t *testing.T) {
	t.Parallel()
	server := &APIServer{manifest: NetworkManifest{
		Schema: "PlebeianAuctionsPOCNetworkV4", ChainID: "friday", Mode: "remote",
	}, offline: func(int) error { t.Fatal("offline callback must not run"); return nil },
		browserThresholdReady: true, recoveryOnly: true}
	handler, err := server.Handler()
	if err != nil {
		t.Fatal(err)
	}
	for _, endpoint := range []string{"/api/interim/faucet", "/api/event", "/api/close", "/api/admin/offline"} {
		request := httptest.NewRequest(http.MethodPost, endpoint, strings.NewReader(`{"untrusted":true}`))
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "recovery-only") {
			t.Fatalf("recovery-only endpoint %s status=%d body=%s", endpoint, response.Code, response.Body.String())
		}
	}
	configResponse := httptest.NewRecorder()
	handler.ServeHTTP(configResponse, httptest.NewRequest(http.MethodGet, "/api/config", nil))
	body := configResponse.Body.String()
	for _, expected := range []string{`"recovery_only":true`, `"browser_threshold_admission_ready":false`, `"browser_threshold_wallet_ready":false`} {
		if !strings.Contains(body, expected) {
			t.Fatalf("recovery-only config is missing %q: %s", expected, body)
		}
	}
}

func TestFridayRecoveryOnlyConfigurationIsExact(t *testing.T) {
	t.Setenv("POC_FRIDAY_RECOVERY_ONLY", "yes")
	_, err := NewAPIServer(NetworkManifest{}, nil)
	if err == nil || !strings.Contains(err.Error(), "must be exactly true or false") {
		t.Fatalf("malformed recovery-only setting did not fail closed: %v", err)
	}
}
