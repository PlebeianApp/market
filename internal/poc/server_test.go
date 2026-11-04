package poc

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

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
		`name="viewport"`, `Worthless fake sats only`, `3-of-4 FROST admission`,
		`Participant-local policy over FIPS transport`, `not production or federal FIPS compliance`,
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

	cssRequest := httptest.NewRequest(http.MethodGet, "/styles.css", nil)
	cssResponse := httptest.NewRecorder()
	handler.ServeHTTP(cssResponse, cssRequest)
	if cssResponse.Code != http.StatusOK || !strings.Contains(cssResponse.Body.String(), "@media(max-width:560px)") || !strings.Contains(cssResponse.Body.String(), "padding:.72rem 1rem") {
		t.Fatalf("Friday phone layout/touch target CSS is absent")
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
	releasePins := BrowserReleasePinsV1{Schema: "PLEBEIAN_FRIDAY_R20_BROWSER_RELEASE_PINS_V1",
		DeploymentID: fridayR20DeploymentID, AuthNetworkID: pins.AuthNetworkID, ChainID: pins.ChainID,
		GenesisSHA256: pins.GenesisSHA256, CashuMintURL: pins.MintURL,
		CommitteePublicKey: pins.CommitteePublicKey, CommitteeKeysetID: pins.CommitteeKeysetID,
		CommitteeKeysetVersion: pins.CommitteeKeysetVersion, DKGRunID: pins.DKGRunID,
		PublicKeyPackageSHA256: pins.PublicKeyPackageSHA256, SignerRosterDigest: pins.SignerRosterDigest,
		FakeFundingPolicyDigest: "3588ddbd214b3c1e57926b77a20c070249c1d468fbbe1592ff85e18daf4ae069"}
	server := &APIServer{manifest: NetworkManifest{Schema: "PlebeianAuctionsPOCNetworkV4",
		DeploymentID: "friday-demo-20261023-r20", ChainID: pins.ChainID, Mode: "remote",
		CashuMintURL: pins.MintURL, CommitteePublicKey: pins.CommitteePublicKey, FundingAbortPins: &pins,
		Policy: Policy{FaucetAmount: 10_000, FaucetCap: 50_000}},
		browserThresholdReady: true, browserReleasePins: &releasePins, runtimeReadyProbe: func(context.Context) bool { return true }}
	handler, err := server.Handler()
	if err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/config", nil))
	body := response.Body.String()
	for _, expected := range []string{`"browser_threshold_admission_ready":true`,
		`"browser_threshold_wallet_ready":true`, `"deployment_id":"friday-demo-20261023-r20"`,
		`"auth_network_id":"friday-network-r20"`, `"dkg_run_id":"friday-demo-20261023-r20-dkg2"`,
		`"fake_funding_policy":{"digest":"3588ddbd214b3c1e57926b77a20c070249c1d468fbbe1592ff85e18daf4ae069","enforcement":"browser_wallet_advisory_only","max_per_request":10000,"max_resulting_balance":50000,"schema":"PLEBEIAN_FRIDAY_R20_FAKE_FUNDING_POLICY_V1"}`,
		`"public_key_package_sha256":"` + strings.Repeat("22", 32) + `"`} {
		if !strings.Contains(body, expected) {
			t.Fatalf("exact threshold config is missing %q: %s", expected, body)
		}
	}
	pinsResponse := httptest.NewRecorder()
	handler.ServeHTTP(pinsResponse, httptest.NewRequest(http.MethodGet, "/api/browser-release-pins", nil))
	if pinsResponse.Code != http.StatusOK || !strings.Contains(pinsResponse.Body.String(),
		`"schema":"PLEBEIAN_FRIDAY_R20_BROWSER_RELEASE_PINS_V1"`) {
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
