package poc

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

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
			"validatorsHash": strings.Repeat("b", 64), "mintUrl": pins.CashuMintURL, "committeeKeysetId": pins.CommitteeKeysetID,
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
