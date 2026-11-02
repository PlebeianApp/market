package poc

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

type scriptedR20ClosePort struct {
	states     []r20CloseState
	readErrors []error
	closeCode  int
	closeErr   error
	closed     []string
}

type deadlineR20ClosePort struct{ remaining time.Duration }

func (port *deadlineR20ClosePort) ReadState(ctx context.Context) (r20CloseState, error) {
	deadline, ok := ctx.Deadline()
	if !ok {
		return r20CloseState{}, errors.New("missing deadline")
	}
	port.remaining = time.Until(deadline)
	return r20CloseState{}, errors.New("R20_CLOSE_RESPONSE_JSON_INVALID")
}

func (*deadlineR20ClosePort) Close(context.Context, string) (r20CloseResponse, error) {
	return r20CloseResponse{}, errors.New("close must not be reached")
}

func (port *scriptedR20ClosePort) ReadState(context.Context) (r20CloseState, error) {
	if len(port.readErrors) > 0 {
		err := port.readErrors[0]
		port.readErrors = port.readErrors[1:]
		if err != nil {
			return r20CloseState{}, err
		}
	}
	if len(port.states) == 0 {
		return r20CloseState{}, errors.New("unavailable")
	}
	value := port.states[0]
	port.states = port.states[1:]
	return value, nil
}

func TestR20CloseTriggerPreservesMalformedResponseCategories(t *testing.T) {
	malformed := errors.New("R20_CLOSE_RESPONSE_JSON_INVALID")
	initial := &scriptedR20ClosePort{readErrors: []error{malformed}}
	if err := newR20CloseTrigger(initial, time.Now).Step(context.Background()); err == nil || err.Error() != malformed.Error() {
		t.Fatalf("initial malformed response=%v", err)
	}

	open := closeState(100, closeAuction("auction-1", "open", 90))
	afterClose := &scriptedR20ClosePort{states: []r20CloseState{open, open}, closeErr: malformed}
	if err := newR20CloseTrigger(afterClose, time.Now).Step(context.Background()); err == nil || err.Error() != malformed.Error() {
		t.Fatalf("close malformed response=%v", err)
	}

	closed := closeState(100, closeAuction("auction-1", "closed", 90))
	malformedButClosed := &scriptedR20ClosePort{states: []r20CloseState{open, closed}, closeErr: malformed}
	if err := newR20CloseTrigger(malformedButClosed, time.Now).Step(context.Background()); err == nil || err.Error() != malformed.Error() {
		t.Fatalf("malformed response with canonical closed state=%v", err)
	}

	transportLostButClosed := &scriptedR20ClosePort{states: []r20CloseState{open, closed}, closeErr: errors.New("lost response")}
	if err := newR20CloseTrigger(transportLostButClosed, time.Now).Step(context.Background()); err != nil {
		t.Fatalf("transport loss with canonical closed state=%v", err)
	}
}

func TestR20CloseTriggerUsesBoundedExponentialRetry(t *testing.T) {
	open := closeState(100, closeAuction("auction-1", "open", 90))
	states := make([]r20CloseState, 0, 16)
	for range 8 {
		states = append(states, open, open)
	}
	now := time.Unix(100, 0)
	port := &scriptedR20ClosePort{states: states, closeErr: errors.New("lost response")}
	trigger := newR20CloseTrigger(port, func() time.Time { return now })
	want := []time.Duration{5, 10, 20, 40, 80, 160, 300, 300}
	for attempt, seconds := range want {
		if err := trigger.Step(context.Background()); err == nil || err.Error() != "R20_CLOSE_OUTCOME_UNRESOLVED" {
			t.Fatalf("attempt %d error=%v", attempt+1, err)
		}
		delay := trigger.nextAttempt["auction-1"].Sub(now)
		if delay != seconds*time.Second {
			t.Fatalf("attempt %d delay=%v want=%vs", attempt+1, delay, seconds)
		}
		now = trigger.nextAttempt["auction-1"]
	}
	serverNow := time.Unix(200, 0)
	serverError := &scriptedR20ClosePort{states: []r20CloseState{open, open}, closeCode: 503}
	serverTrigger := newR20CloseTrigger(serverError, func() time.Time { return serverNow })
	if err := serverTrigger.Step(context.Background()); err == nil || err.Error() != "R20_CLOSE_OUTCOME_UNRESOLVED" {
		t.Fatalf("server error=%v", err)
	}
	if delay := serverTrigger.nextAttempt["auction-1"].Sub(serverNow); delay != 5*time.Second {
		t.Fatalf("server error delay=%v", delay)
	}
}

func TestR20CloseHTTPPortWaitsPastTheServerBroadcastBudget(t *testing.T) {
	port, err := newR20CloseHTTPPort("127.0.0.1:8080")
	if err != nil {
		t.Fatal(err)
	}
	if port.client.Timeout != r20CloseHTTPTimeout {
		t.Fatalf("HTTP timeout=%v", port.client.Timeout)
	}
}

func TestR20CloseRunnerStepBudgetExceedsTheHTTPBudget(t *testing.T) {
	port := &deadlineR20ClosePort{}
	reports := []string{}
	runR20CloseTrigger(context.Background(), newR20CloseTrigger(port, time.Now), func(category string) {
		reports = append(reports, category)
	})
	if port.remaining < r20CloseHTTPTimeout+4*time.Second || port.remaining > r20CloseStepTimeout {
		t.Fatalf("runner deadline remaining=%v", port.remaining)
	}
	if len(reports) != 1 || reports[0] != "R20_CLOSE_RESPONSE_JSON_INVALID" {
		t.Fatalf("reports=%v", reports)
	}
}

func (port *scriptedR20ClosePort) Close(_ context.Context, auctionID string) (r20CloseResponse, error) {
	port.closed = append(port.closed, auctionID)
	return r20CloseResponse{Status: port.closeCode}, port.closeErr
}

func closeState(now int64, auctions ...Auction) r20CloseState {
	items := make(map[string]Auction, len(auctions))
	for _, auction := range auctions {
		items[auction.ID] = auction
	}
	return r20CloseState{ConsensusTime: now, Auctions: items}
}

func closeAuction(id, status string, end int64) Auction {
	return Auction{ID: id, Status: status, OriginalEndTime: end, EndTime: end}
}

func TestR20CloseTriggerSubmitsOneSortedEligibleAuctionAndObservesCommit(t *testing.T) {
	before := closeState(100, closeAuction("z-auction", "open", 90), closeAuction("a-auction", "open", 80))
	after := closeState(100, closeAuction("z-auction", "open", 90), closeAuction("a-auction", "closed", 80))
	port := &scriptedR20ClosePort{states: []r20CloseState{before, after}, closeCode: 200}
	trigger := newR20CloseTrigger(port, func() time.Time { return time.Unix(100, 0) })
	if err := trigger.Step(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(port.closed) != 1 || port.closed[0] != "a-auction" {
		t.Fatalf("close calls=%v", port.closed)
	}
}

func TestR20CloseTriggerQuarantinesPermanentRejectionWithoutImmediateRetry(t *testing.T) {
	open := closeState(100, closeAuction("auction-1", "open", 90))
	port := &scriptedR20ClosePort{states: []r20CloseState{open, open, open}, closeCode: 409}
	trigger := newR20CloseTrigger(port, func() time.Time { return time.Unix(100, 0) })
	if err := trigger.Step(context.Background()); err == nil || err.Error() != "R20_CLOSE_PERMANENT_REJECTION_QUARANTINED" {
		t.Fatalf("first error=%v", err)
	}
	if err := trigger.Step(context.Background()); err != nil {
		t.Fatalf("quarantined follow-up=%v", err)
	}
	if len(port.closed) != 1 {
		t.Fatalf("permanent rejection was retried: %v", port.closed)
	}
}

func TestR20CloseTriggerAmbiguityBacksOffAndNeverClaimsClosure(t *testing.T) {
	open := closeState(100, closeAuction("auction-1", "open", 90))
	now := time.Unix(100, 0)
	port := &scriptedR20ClosePort{states: []r20CloseState{open, open, open}, closeErr: errors.New("lost response")}
	trigger := newR20CloseTrigger(port, func() time.Time { return now })
	if err := trigger.Step(context.Background()); err == nil || err.Error() != "R20_CLOSE_OUTCOME_UNRESOLVED" {
		t.Fatalf("ambiguous error=%v", err)
	}
	if err := trigger.Step(context.Background()); err != nil {
		t.Fatalf("backoff follow-up=%v", err)
	}
	if len(port.closed) != 1 {
		t.Fatalf("ambiguous close was immediately retried: %v", port.closed)
	}
}

func TestR20CloseTriggerRejectsMalformedCanonicalStateBeforeSubmission(t *testing.T) {
	port := &scriptedR20ClosePort{states: []r20CloseState{{ConsensusTime: 100, Auctions: map[string]Auction{
		"auction-1": {ID: "different", Status: "open", OriginalEndTime: 90, EndTime: 90},
	}}}}
	trigger := newR20CloseTrigger(port, time.Now)
	if err := trigger.Step(context.Background()); err == nil || err.Error() != "R20_CLOSE_STATE_MALFORMED" {
		t.Fatalf("malformed error=%v", err)
	}
	if len(port.closed) != 0 {
		t.Fatalf("malformed state reached close: %v", port.closed)
	}
}

func exactR20CloseActivationFixture() (NetworkManifest, *APIServer) {
	pins := FundingAbortPinsV1{AuthNetworkID: "friday-network-r20", ChainID: "friday-chain-r20",
		GenesisSHA256: strings.Repeat("11", 32), MintURL: "https://172.105.95.57",
		ActiveKeysetID: "active-keyset", CommitteePublicKey: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
		CommitteeKeysetID: fridayR20KeysetID, CommitteeKeysetVersion: fridayR20KeysetVersion,
		DKGRunID: fridayR20DKGRunID, PublicKeyPackageSHA256: strings.Repeat("22", 32),
		SignerRosterDigest: strings.Repeat("33", 32)}
	release := &BrowserReleasePinsV1{Schema: "PLEBEIAN_FRIDAY_R20_BROWSER_RELEASE_PINS_V1",
		DeploymentID: fridayR20DeploymentID, AuthNetworkID: pins.AuthNetworkID, ChainID: pins.ChainID,
		GenesisSHA256: pins.GenesisSHA256, CashuMintURL: pins.MintURL, CommitteePublicKey: pins.CommitteePublicKey,
		CommitteeKeysetID: pins.CommitteeKeysetID, CommitteeKeysetVersion: pins.CommitteeKeysetVersion,
		DKGRunID: pins.DKGRunID, PublicKeyPackageSHA256: pins.PublicKeyPackageSHA256,
		SignerRosterDigest:      pins.SignerRosterDigest,
		FakeFundingPolicyDigest: "3588ddbd214b3c1e57926b77a20c070249c1d468fbbe1592ff85e18daf4ae069"}
	manifest := NetworkManifest{Schema: "PlebeianAuctionsPOCNetworkV4", Mode: "remote",
		ApplicationAuthority: ApplicationAuthorityFrostCashu, DeploymentID: fridayR20DeploymentID,
		ChainID: pins.ChainID, CashuMintURL: pins.MintURL, CommitteePublicKey: pins.CommitteePublicKey,
		FundingAbortPins: &pins, R20RuntimeBindingDigest: strings.Repeat("44", 32),
		Policy: Policy{FaucetAmount: 10_000, FaucetCap: 50_000}}
	return manifest, &APIServer{manifest: manifest, browserThresholdReady: true, browserReleasePins: release}
}

func setExactR20CloseActivationEnvironment(t *testing.T) {
	t.Helper()
	t.Setenv("POC_FRIDAY_R20_CLOSE_TRIGGER", "true")
	t.Setenv("FRIDAY_NETWORK_ROOT", r20NetworkRoot)
	t.Setenv("FRIDAY_APPLICATION", r20ApplicationPath)
	t.Setenv("FRIDAY_TERMINAL_EXECUTOR_BIN", r20ExecutorPath)
	t.Setenv("FRIDAY_SLOT", "2")
	t.Setenv("FRIDAY_SITE_PORT", "8180")
	t.Setenv("FRIDAY_R20_RUNTIME_BINDING_DIGEST", strings.Repeat("44", 32))
}

func TestR20CloseTriggerActivationRequiresExactReviewedBindings(t *testing.T) {
	manifest, server := exactR20CloseActivationFixture()
	setExactR20CloseActivationEnvironment(t)
	enabled, err := requireR20CloseTriggerActivation(r20NetworkRoot, "127.0.0.1:8180", manifest, server)
	if err != nil || !enabled {
		t.Fatalf("exact activation enabled=%v err=%v", enabled, err)
	}

	t.Setenv("FRIDAY_SLOT", "1")
	if enabled, err := requireR20CloseTriggerActivation(r20NetworkRoot, "127.0.0.1:8180", manifest, server); err == nil || enabled {
		t.Fatalf("wrong host slot enabled=%v err=%v", enabled, err)
	}
}

func TestR20CloseTriggerActivationIsDisabledByDefaultAndRejectsNearMisses(t *testing.T) {
	manifest, server := exactR20CloseActivationFixture()
	if enabled, err := requireR20CloseTriggerActivation("/tmp/not-production", "127.0.0.1:8180", manifest, server); err != nil || enabled {
		t.Fatalf("default enabled=%v err=%v", enabled, err)
	}
	t.Setenv("POC_FRIDAY_R20_CLOSE_TRIGGER", "yes")
	if enabled, err := requireR20CloseTriggerActivation(r20NetworkRoot, "127.0.0.1:8180", manifest, server); err == nil || enabled {
		t.Fatalf("malformed boolean enabled=%v err=%v", enabled, err)
	}
}

func TestR20CloseTriggerActivationRejectsEachSecurityBoundaryNearMiss(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*NetworkManifest, *APIServer)
	}{
		{"legacy authority", func(manifest *NetworkManifest, _ *APIServer) {
			manifest.ApplicationAuthority = ApplicationAuthorityLegacy
		}},
		{"wrong deployment", func(manifest *NetworkManifest, _ *APIServer) { manifest.DeploymentID = "friday-other" }},
		{"local mode", func(manifest *NetworkManifest, _ *APIServer) { manifest.Mode = "local" }},
		{"recovery only", func(_ *NetworkManifest, server *APIServer) { server.recoveryOnly = true }},
		{"browser disabled", func(_ *NetworkManifest, server *APIServer) { server.browserThresholdReady = false }},
		{"pins absent", func(_ *NetworkManifest, server *APIServer) { server.browserReleasePins = nil }},
		{"pins differ", func(_ *NetworkManifest, server *APIServer) {
			server.browserReleasePins.GenesisSHA256 = strings.Repeat("55", 32)
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			manifest, server := exactR20CloseActivationFixture()
			setExactR20CloseActivationEnvironment(t)
			test.mutate(&manifest, server)
			enabled, err := requireR20CloseTriggerActivation(r20NetworkRoot, "127.0.0.1:8180", manifest, server)
			if err == nil || enabled {
				t.Fatalf("near miss enabled=%v err=%v", enabled, err)
			}
		})
	}
}
