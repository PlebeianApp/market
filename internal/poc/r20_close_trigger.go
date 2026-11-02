package poc

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	r20CloseMaxStateBytes = 4 * 1024 * 1024
	r20CloseHTTPTimeout   = 25 * time.Second
	r20CloseStepTimeout   = 30 * time.Second
)

const (
	r20ApplicationPath = "/etc/plebeian-auctions-friday/application.json"
	r20ExecutorPath    = "/opt/plebeian-auctions-friday/releases/r20-deploy-v1/bin/plebeian-friday-terminal-executor"
	r20NetworkRoot     = "/var/lib/plebeian-auctions-friday/network-r20"
)

type r20CloseState struct {
	ConsensusTime int64
	Auctions      map[string]Auction
}

type r20CloseResponse struct{ Status int }

type r20ClosePort interface {
	ReadState(context.Context) (r20CloseState, error)
	Close(context.Context, string) (r20CloseResponse, error)
}

type r20CloseTrigger struct {
	port        r20ClosePort
	now         func() time.Time
	mu          sync.Mutex
	quarantined map[string]bool
	nextAttempt map[string]time.Time
	retryCount  map[string]uint8
}

func newR20CloseTrigger(port r20ClosePort, now func() time.Time) *r20CloseTrigger {
	return &r20CloseTrigger{port: port, now: now, quarantined: map[string]bool{}, nextAttempt: map[string]time.Time{}, retryCount: map[string]uint8{}}
}

// requireR20CloseTriggerActivation keeps automatic close submission inert
// unless the exact reviewed R20 application host and public browser release
// are active.  The policy values themselves remain runtime manifest data and
// are deliberately not compiled into this gate.
func requireR20CloseTriggerActivation(root, listen string, manifest NetworkManifest, server *APIServer) (bool, error) {
	enabled := os.Getenv("POC_FRIDAY_R20_CLOSE_TRIGGER")
	if enabled == "" || enabled == "false" {
		return false, nil
	}
	if enabled != "true" {
		return false, errors.New("POC_FRIDAY_R20_CLOSE_TRIGGER must be exactly true or false")
	}
	if server == nil || manifest.Schema != "PlebeianAuctionsPOCNetworkV4" || manifest.Mode != "remote" ||
		(manifest.DeploymentID != fridayR20DeploymentID && manifest.DeploymentID != fridaySeparatedDeploymentID) || manifestApplicationAuthority(manifest) != ApplicationAuthorityFrostCashu ||
		server.recoveryOnly || !server.browserThresholdReady || server.browserReleasePins == nil {
		return false, errors.New("R20_CLOSE_ACTIVATION_PROFILE_INVALID")
	}
	expectedRoot := r20NetworkRoot
	roleOK := os.Getenv("FRIDAY_SLOT") == "2"
	binding := os.Getenv("FRIDAY_R20_RUNTIME_BINDING_DIGEST")
	expectedBinding := manifest.R20RuntimeBindingDigest
	expectedExecutor := r20ExecutorPath
	if manifest.DeploymentID == fridaySeparatedDeploymentID {
		expectedRoot = "/var/lib/plebeian-auctions-friday/network-separated"
		expectedExecutor = "/opt/plebeian-auctions-friday/releases/separated-deploy-v1/bin/plebeian-friday-terminal-executor"
		roleOK = os.Getenv("FRIDAY_ROLE") == "APPLICATION" && os.Getenv("FRIDAY_SLOT") == "" && server.observerNodeID != ""
		binding = os.Getenv("FRIDAY_SEPARATED_RUNTIME_DIGEST")
		expectedBinding = manifest.SeparatedRuntimeBindingDigest
	}
	if filepath.Clean(root) != expectedRoot || os.Getenv("FRIDAY_NETWORK_ROOT") != expectedRoot ||
		os.Getenv("FRIDAY_APPLICATION") != r20ApplicationPath || os.Getenv("FRIDAY_TERMINAL_EXECUTOR_BIN") != expectedExecutor ||
		!roleOK || os.Getenv("FRIDAY_SITE_PORT") != "8180" || listen != "127.0.0.1:8180" {
		return false, errors.New("R20_CLOSE_ACTIVATION_HOST_BINDING_INVALID")
	}
	if !validLowerHex(binding, 32) || binding != expectedBinding {
		return false, errors.New("R20_CLOSE_ACTIVATION_RUNTIME_BINDING_INVALID")
	}
	pins := server.browserReleasePins
	policyDigest, _ := r20FakeFundingPolicy(manifest.Policy)["digest"].(string)
	if validateBrowserReleasePins(*pins) != nil || pins.DeploymentID != manifest.DeploymentID ||
		pins.ChainID != manifest.ChainID || pins.CashuMintURL != manifest.CashuMintURL ||
		pins.CommitteePublicKey != manifest.CommitteePublicKey || pins.FakeFundingPolicyDigest != policyDigest ||
		manifest.FundingAbortPins == nil {
		return false, errors.New("R20_CLOSE_ACTIVATION_BROWSER_BINDING_INVALID")
	}
	funding := manifest.FundingAbortPins
	if pins.AuthNetworkID != funding.AuthNetworkID || pins.GenesisSHA256 != funding.GenesisSHA256 ||
		pins.CommitteeKeysetID != funding.CommitteeKeysetID || pins.CommitteeKeysetVersion != funding.CommitteeKeysetVersion ||
		pins.DKGRunID != funding.DKGRunID || pins.PublicKeyPackageSHA256 != funding.PublicKeyPackageSHA256 ||
		pins.SignerRosterDigest != funding.SignerRosterDigest {
		return false, errors.New("R20_CLOSE_ACTIVATION_BROWSER_BINDING_INVALID")
	}
	if port, err := strconv.Atoi(os.Getenv("FRIDAY_SITE_PORT")); err != nil || port != 8180 {
		return false, errors.New("R20_CLOSE_ACTIVATION_HOST_BINDING_INVALID")
	}
	return true, nil
}

func (trigger *r20CloseTrigger) scheduleBackoff(id string) {
	count := trigger.retryCount[id]
	if count < 7 {
		count++
	}
	trigger.retryCount[id] = count
	delay := 5 * time.Second * time.Duration(1<<min(int(count-1), 6))
	if delay > 5*time.Minute {
		delay = 5 * time.Minute
	}
	trigger.nextAttempt[id] = trigger.now().Add(delay)
}

func (trigger *r20CloseTrigger) clearBackoff(id string) {
	delete(trigger.nextAttempt, id)
	delete(trigger.retryCount, id)
}

func validateR20CloseState(value r20CloseState) ([]string, error) {
	if value.ConsensusTime < 1 || len(value.Auctions) > 10_000 {
		return nil, errors.New("R20_CLOSE_STATE_MALFORMED")
	}
	eligible := make([]string, 0)
	for id, auction := range value.Auctions {
		if id != auction.ID || !validIdentifier(id) || (auction.Status != "open" && auction.Status != "closed") ||
			auction.EndTime < 1 || auction.OriginalEndTime < 1 || auction.EndTime < auction.OriginalEndTime {
			return nil, errors.New("R20_CLOSE_STATE_MALFORMED")
		}
		if auction.Status == "open" && value.ConsensusTime >= auction.EndTime {
			eligible = append(eligible, id)
		}
	}
	sort.Strings(eligible)
	return eligible, nil
}

// Step submits at most one close transaction. Canonical state is always read
// before and after a submission; an ambiguous response is never an immediate
// retry signal.
func (trigger *r20CloseTrigger) Step(ctx context.Context) error {
	trigger.mu.Lock()
	defer trigger.mu.Unlock()
	state, err := trigger.port.ReadState(ctx)
	if err != nil {
		if strings.HasPrefix(err.Error(), "R20_CLOSE_RESPONSE_") {
			return err
		}
		return errors.New("R20_CLOSE_STATE_UNAVAILABLE")
	}
	eligible, err := validateR20CloseState(state)
	if err != nil {
		return err
	}
	for _, id := range eligible {
		if trigger.quarantined[id] || trigger.now().Before(trigger.nextAttempt[id]) {
			continue
		}
		response, closeErr := trigger.port.Close(ctx, id)
		observed, readErr := trigger.port.ReadState(ctx)
		if readErr != nil {
			if strings.HasPrefix(readErr.Error(), "R20_CLOSE_RESPONSE_") {
				return readErr
			}
			trigger.scheduleBackoff(id)
			return errors.New("R20_CLOSE_OUTCOME_UNRESOLVED")
		}
		if _, validateErr := validateR20CloseState(observed); validateErr != nil {
			return validateErr
		}
		auction, present := observed.Auctions[id]
		if !present {
			return errors.New("R20_CLOSE_STATE_MALFORMED")
		}
		// A malformed protocol response is fail-closed even when the canonical
		// reread happens to show the auction closed. Generic transport loss may
		// still be resolved by a valid canonical closed state below.
		if closeErr != nil && strings.HasPrefix(closeErr.Error(), "R20_CLOSE_RESPONSE_") {
			return closeErr
		}
		if auction.Status == "closed" {
			trigger.clearBackoff(id)
			return nil
		}
		if closeErr != nil {
			trigger.scheduleBackoff(id)
			return errors.New("R20_CLOSE_OUTCOME_UNRESOLVED")
		}
		if response.Status >= 400 && response.Status < 500 {
			trigger.quarantined[id] = true
			return errors.New("R20_CLOSE_PERMANENT_REJECTION_QUARANTINED")
		}
		if response.Status < 200 || response.Status >= 300 {
			trigger.scheduleBackoff(id)
			return errors.New("R20_CLOSE_OUTCOME_UNRESOLVED")
		}
		trigger.scheduleBackoff(id)
		return errors.New("R20_CLOSE_COMMIT_PENDING")
	}
	return nil
}

type r20CloseHTTPPort struct {
	base   *url.URL
	client *http.Client
}

func newR20CloseHTTPPort(listen string) (*r20CloseHTTPPort, error) {
	parsed, err := url.Parse("http://" + listen)
	if err != nil || parsed.Scheme != "http" || parsed.Hostname() != "127.0.0.1" || parsed.Path != "" {
		return nil, errors.New("R20_CLOSE_LOOPBACK_ORIGIN_INVALID")
	}
	return &r20CloseHTTPPort{base: parsed, client: &http.Client{Timeout: r20CloseHTTPTimeout,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}

func exactJSONResponse(response *http.Response, limit int64, target any) error {
	defer response.Body.Close()
	if strings.Split(response.Header.Get("Content-Type"), ";")[0] != "application/json" {
		return errors.New("R20_CLOSE_RESPONSE_TYPE_INVALID")
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, limit+1))
	if err != nil || int64(len(raw)) > limit {
		return errors.New("R20_CLOSE_RESPONSE_BOUNDS_INVALID")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	if err := decoder.Decode(target); err != nil || decoder.Decode(&struct{}{}) != io.EOF {
		return errors.New("R20_CLOSE_RESPONSE_JSON_INVALID")
	}
	return nil
}

func (port *r20CloseHTTPPort) ReadState(ctx context.Context) (r20CloseState, error) {
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, port.base.String()+"/api/state", nil)
	response, err := port.client.Do(request)
	if err != nil || response.StatusCode != http.StatusOK {
		if response != nil {
			response.Body.Close()
		}
		return r20CloseState{}, errors.New("R20_CLOSE_STATE_REQUEST_FAILED")
	}
	var view StateView
	if err := exactJSONResponse(response, r20CloseMaxStateBytes, &view); err != nil {
		return r20CloseState{}, err
	}
	return r20CloseState{ConsensusTime: view.State.LastConsensusTime, Auctions: view.State.Auctions}, nil
}

func (port *r20CloseHTTPPort) Close(ctx context.Context, auctionID string) (r20CloseResponse, error) {
	if !validIdentifier(auctionID) {
		return r20CloseResponse{}, errors.New("R20_CLOSE_AUCTION_ID_INVALID")
	}
	raw := []byte(fmt.Sprintf("{\"auction_id\":%q}", auctionID))
	request, _ := http.NewRequestWithContext(ctx, http.MethodPost, port.base.String()+"/api/close", bytes.NewReader(raw))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	response, err := port.client.Do(request)
	if err != nil {
		return r20CloseResponse{}, errors.New("R20_CLOSE_REQUEST_FAILED")
	}
	defer response.Body.Close()
	if response.StatusCode >= 200 && response.StatusCode < 300 {
		var result struct {
			Height int64 `json:"height"`
		}
		if err := exactJSONResponseWithoutClose(response, 16*1024, &result); err != nil || result.Height < 1 {
			return r20CloseResponse{}, errors.New("R20_CLOSE_RESPONSE_INVALID")
		}
	} else {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 16*1024))
	}
	return r20CloseResponse{Status: response.StatusCode}, nil
}

func exactJSONResponseWithoutClose(response *http.Response, limit int64, target any) error {
	if strings.Split(response.Header.Get("Content-Type"), ";")[0] != "application/json" {
		return errors.New("R20_CLOSE_RESPONSE_TYPE_INVALID")
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, limit+1))
	if err != nil || int64(len(raw)) > limit {
		return errors.New("R20_CLOSE_RESPONSE_BOUNDS_INVALID")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	if err := decoder.Decode(target); err != nil || decoder.Decode(&struct{}{}) != io.EOF {
		return errors.New("R20_CLOSE_RESPONSE_JSON_INVALID")
	}
	return nil
}

func runR20CloseTrigger(ctx context.Context, trigger *r20CloseTrigger, report func(string)) {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		// The outer step budget must exceed the HTTP client's timeout, which in
		// turn exceeds the server's 20-second BroadcastTxCommit budget. Otherwise
		// this parent context would force an ambiguous result before the server
		// has had its reviewed opportunity to return the commit outcome.
		stepCtx, cancel := context.WithTimeout(ctx, r20CloseStepTimeout)
		err := trigger.Step(stepCtx)
		cancel()
		if err != nil {
			category := err.Error()
			report(category)
			if category == "R20_CLOSE_STATE_MALFORMED" || strings.HasPrefix(category, "R20_CLOSE_RESPONSE_") {
				return
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
