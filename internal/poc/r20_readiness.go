package poc

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"time"
)

// One loopback authority owns composite readiness. A fresh bounded request and
// independent health-input digest bind its decision to this site's release pins.
// No caller-supplied URL or public status endpoint can satisfy this gate.
func (server *APIServer) browserRuntimeReady(ctx context.Context) bool {
	if server.manifest.Schema != "PlebeianAuctionsPOCNetworkV4" {
		return true
	}
	if server.recoveryOnly || !server.browserThresholdReady || !server.browserPinsReady() {
		return false
	}
	// Threshold funding is not end-to-end ready unless the automatic close path
	// is installed and healthy; otherwise accepted bids can never settle.
	if server.closeTriggerReady == nil || !server.closeTriggerReady() {
		return false
	}
	if server.runtimeReadyProbe != nil {
		return server.runtimeReadyProbe(ctx)
	}
	if !validLowerHex(server.healthPinsSHA256, 32) {
		return false
	}
	ctx, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://127.0.0.1:8181/api/friday/status", nil)
	if err != nil {
		return false
	}
	client := http.Client{Timeout: 6 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(request)
	if err != nil {
		return false
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return false
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, 16_385))
	if err != nil || len(raw) > 16_384 {
		return false
	}
	return server.validRuntimeReadiness(raw)
}

// browserConfigRuntimeReady coalesces only concurrent public config reads.
// The shared probe is detached from any one browser request but remains
// bounded by browserRuntimeReady's own six-second deadline. There is no cache:
// after a flight completes, the next config read performs a fresh probe.
// Direct mutation handlers never use this helper, so admission remains
// fail-closed against current authority health.
func (server *APIServer) browserConfigRuntimeReady(ctx context.Context) bool {
	server.configReadinessMu.Lock()
	flight := server.configReadinessFlight
	if flight == nil {
		flight = &configReadinessFlight{done: make(chan struct{})}
		server.configReadinessFlight = flight
		go func(current *configReadinessFlight) {
			ready := server.browserRuntimeReady(context.Background())
			server.configReadinessMu.Lock()
			current.ready = ready
			close(current.done)
			if server.configReadinessFlight == current {
				server.configReadinessFlight = nil
			}
			server.configReadinessMu.Unlock()
		}(flight)
	}
	server.configReadinessMu.Unlock()

	select {
	case <-ctx.Done():
		return false
	case <-flight.done:
		return flight.ready
	}
}

func (server *APIServer) validRuntimeReadiness(raw []byte) bool {
	var value struct {
		Schema             string `json:"schema"`
		DeploymentID       string `json:"deploymentId"`
		Quarantined        bool   `json:"quarantined"`
		ConsensusAvailable bool   `json:"consensusAvailable"`
		NewOperationsReady bool   `json:"newOperationsReady"`
		Mode               string `json:"mode"`
		Funding            string `json:"funding"`
		ConfigSHA256       string `json:"readinessConfigSha256"`
		Height             int64  `json:"lastCommittedHeight"`
		Pins               struct {
			DeploymentID           string `json:"deploymentId"`
			ChainID                string `json:"chainId"`
			GenesisSHA256          string `json:"genesisSha256"`
			ValidatorsHash         string `json:"validatorsHash"`
			MintURL                string `json:"mintUrl"`
			CommitteeKeysetID      string `json:"committeeKeysetId"`
			CommitteeKeysetVersion string `json:"committeeKeysetVersion"`
			DKGRunID               string `json:"dkgRunId"`
			PublicKeyPackageSHA256 string `json:"publicKeyPackageSha256"`
			SignerRosterDigest     string `json:"signerRosterDigest"`
		} `json:"readinessPins"`
	}
	if json.Unmarshal(raw, &value) != nil || !server.browserPinsReady() || !validLowerHex(server.healthPinsSHA256, 32) {
		return false
	}
	expected, pins := server.browserReleasePins, value.Pins
	return value.Schema == "PLEBEIAN_FRIDAY_AUTHORITY_STATUS_V1" && value.NewOperationsReady && !value.Quarantined &&
		value.ConsensusAvailable && value.Mode == "normal" && value.Funding == "enabled_two_step_nip07" && value.Height > 0 &&
		value.DeploymentID == expected.DeploymentID && value.ConfigSHA256 == server.healthPinsSHA256 &&
		pins.DeploymentID == expected.DeploymentID && pins.ChainID == expected.ChainID && pins.GenesisSHA256 == expected.GenesisSHA256 &&
		pins.ValidatorsHash == expected.ValidatorsHash && pins.MintURL == expected.CashuMintURL && pins.CommitteeKeysetID == expected.CommitteeKeysetID &&
		pins.CommitteeKeysetVersion == expected.CommitteeKeysetVersion && pins.DKGRunID == expected.DKGRunID &&
		pins.PublicKeyPackageSHA256 == expected.PublicKeyPackageSHA256 && pins.SignerRosterDigest == expected.SignerRosterDigest
}
