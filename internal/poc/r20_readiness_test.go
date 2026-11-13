package poc

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestBrowserConfigReadinessCoalescesOnlyConcurrentPresentationProbes(t *testing.T) {
	t.Parallel()
	_, server := exactR20CloseActivationFixture()
	started := make(chan struct{})
	release := make(chan struct{})
	var calls atomic.Int32
	server.runtimeReadyProbe = func(context.Context) bool {
		if calls.Add(1) == 1 {
			close(started)
		}
		<-release
		return true
	}

	const readers = 32
	results := make(chan bool, readers)
	go func() { results <- server.browserConfigRuntimeReady(context.Background()) }()
	<-started
	for range readers - 1 {
		go func() { results <- server.browserConfigRuntimeReady(context.Background()) }()
	}
	// Keep the leader blocked long enough for every follower to join its flight.
	time.Sleep(25 * time.Millisecond)
	if got := calls.Load(); got != 1 {
		t.Fatalf("concurrent public config reads started %d authority probes", got)
	}
	close(release)
	for range readers {
		if !<-results {
			t.Fatal("coalesced healthy readiness returned false")
		}
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("one completed flight used %d authority probes", got)
	}

	// Flights are not a cache. A later config read must re-check authority
	// health, while mutation handlers continue to use browserRuntimeReady
	// directly.
	server.runtimeReadyProbe = func(context.Context) bool {
		calls.Add(1)
		return false
	}
	if server.browserConfigRuntimeReady(context.Background()) {
		t.Fatal("a later config read reused stale healthy readiness")
	}
	if got := calls.Load(); got != 2 {
		t.Fatalf("later config read did not perform one fresh probe: %d", got)
	}
}

func TestR20ReadinessBlocksDirectMutationBeforeRPC(t *testing.T) {
	t.Parallel()
	_, server := exactR20CloseActivationFixture()
	// No Comet client exists: reaching RPC would panic, so these assertions also
	// prove direct clients cannot bypass the readiness decision.
	ready := false
	server.runtimeReadyProbe = func(context.Context) bool { return ready }
	handler, err := server.Handler()
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/api/event", "/api/close"} {
		body := `{"auction_id":"auction-1"}`
		if path == "/api/event" {
			body = `{}`
		}
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodPost, path, strings.NewReader(body)))
		if response.Code != http.StatusServiceUnavailable {
			t.Fatalf("%s status=%d body=%s", path, response.Code, response.Body.String())
		}
	}
	for _, value := range []bool{false, true, false} {
		ready = value
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/config", nil))
		var config map[string]any
		if json.Unmarshal(response.Body.Bytes(), &config) != nil || config["browser_threshold_admission_ready"] != value || config["browser_threshold_wallet_ready"] != value {
			t.Fatalf("readiness=%v body=%s", value, response.Body.String())
		}
	}
	ready = true
	server.closeTriggerReady = nil
	if server.browserRuntimeReady(context.Background()) {
		t.Fatal("missing automatic close trigger did not block direct admission")
	}
	server.closeTriggerReady = func() bool { return true }
	server.browserThresholdReady = false
	if server.browserRuntimeReady(context.Background()) {
		t.Fatal("static browser-disable flag did not block direct admission")
	}
}

func TestR20ReadinessIdentityAndRecoveryStatus(t *testing.T) {
	t.Parallel()
	_, server := exactR20CloseActivationFixture()
	server.healthPinsSHA256 = strings.Repeat("a", 64)
	pins := server.browserReleasePins
	good := map[string]any{"schema": "PLEBEIAN_FRIDAY_AUTHORITY_STATUS_V1", "deploymentId": pins.DeploymentID,
		"quarantined": false, "consensusAvailable": true, "newOperationsReady": true, "mode": "normal",
		"funding": "enabled_two_step_nip07", "readinessConfigSha256": server.healthPinsSHA256, "lastCommittedHeight": 10,
		"readinessPins": map[string]any{"deploymentId": pins.DeploymentID, "chainId": pins.ChainID, "genesisSha256": pins.GenesisSHA256,
			"validatorsHash": pins.ValidatorsHash, "mintUrl": pins.CashuMintURL, "committeeKeysetId": pins.CommitteeKeysetID,
			"committeeKeysetVersion": pins.CommitteeKeysetVersion, "dkgRunId": pins.DKGRunID,
			"publicKeyPackageSha256": pins.PublicKeyPackageSHA256, "signerRosterDigest": pins.SignerRosterDigest}}
	raw, _ := json.Marshal(good)
	if !server.validRuntimeReadiness(raw) {
		t.Fatal("matching fresh response refused")
	}
	for _, field := range []string{"deploymentId", "chainId", "genesisSha256", "mintUrl", "committeeKeysetId", "committeeKeysetVersion", "dkgRunId", "publicKeyPackageSha256", "signerRosterDigest", "validatorsHash"} {
		var altered map[string]any
		_ = json.Unmarshal(raw, &altered)
		altered["readinessPins"].(map[string]any)[field] = "wrong"
		body, _ := json.Marshal(altered)
		if server.validRuntimeReadiness(body) {
			t.Fatalf("accepted wrong %s", field)
		}
	}
	for field, value := range map[string]any{"mode": "recovery_only", "quarantined": true, "consensusAvailable": false,
		"newOperationsReady": false, "readinessConfigSha256": strings.Repeat("c", 64), "funding": "disabled_pending_integrated_test"} {
		var altered map[string]any
		_ = json.Unmarshal(raw, &altered)
		altered[field] = value
		body, _ := json.Marshal(altered)
		if server.validRuntimeReadiness(body) {
			t.Fatalf("accepted unsafe %s", field)
		}
	}
}
