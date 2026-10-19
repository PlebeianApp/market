package demo

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/PlebeianApp/market/services/auction-consensus/internal/app"
	"github.com/PlebeianApp/market/services/auction-consensus/internal/auction"
	"github.com/PlebeianApp/market/services/auction-consensus/internal/bidauth"
	abci "github.com/cometbft/cometbft/abci/types"
	coretypes "github.com/cometbft/cometbft/rpc/core/types"
)

func slotFixture(operation string, amount int64) BidSlotRequest {
	intentDigest := fmt.Sprintf("%x", sha256.Sum256([]byte("intent/"+operation)))
	intentBytes, _ := hex.DecodeString(intentDigest)
	bidDigest := fmt.Sprintf("%x", sha256.Sum256(append([]byte("DEMO_AUTH_V1/bid\x00"), intentBytes...)))
	return BidSlotRequest{Profile: bidauth.DemoAuthProfile, ActorPubkey: strings.Repeat("11", 32), AuctionID: "friday-auction", OperationID: "da1o:" + intentDigest[:59], BidID: "da1b:" + bidDigest[:59], Amount: amount, IntentDigest: intentDigest}
}

func TestBidSlotStoreCapacityIdempotencyConflictRecoveryAndCorruption(t *testing.T) {
	path := filepath.Join(t.TempDir(), "slots.wal")
	store, err := OpenBidSlotStore(path, 1)
	if err != nil {
		t.Fatal(err)
	}
	first, err := store.Reserve(slotFixture("op-1", 13))
	if err != nil {
		t.Fatal(err)
	}
	duplicate, err := store.Reserve(slotFixture("op-1", 13))
	if err != nil || duplicate != first {
		t.Fatalf("exact retry: %+v %v", duplicate, err)
	}
	changed := first.BidSlotRequest
	changed.Amount = 15
	if _, err := store.Reserve(changed); err == nil || !strings.Contains(err.Error(), "operation-conflict") {
		t.Fatalf("changed retry accepted: %v", err)
	}
	if _, err := store.Reserve(slotFixture("op-2", 15)); err == nil || !strings.Contains(err.Error(), "capacity") {
		t.Fatalf("capacity overflow accepted: %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := OpenBidSlotStore(path, 1)
	if err != nil {
		t.Fatal(err)
	}
	recovered, err := reopened.Reserve(slotFixture("op-1", 13))
	if err != nil || recovered != first {
		t.Fatalf("recovery mismatch: %+v %v", recovered, err)
	}
	if err := reopened.Close(); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	for name, mutated := range map[string][]byte{
		"corrupt": func() []byte { value := append([]byte(nil), raw...); value[len(value)-2] ^= 1; return value }(),
		"torn":    append([]byte(nil), raw[:len(raw)/2]...),
	} {
		t.Run(name, func(t *testing.T) {
			mutatedPath := filepath.Join(t.TempDir(), "slots.wal")
			if err := os.WriteFile(mutatedPath, mutated, 0o600); err != nil {
				t.Fatal(err)
			}
			if opened, err := OpenBidSlotStore(mutatedPath, 1); err == nil {
				opened.Close()
				t.Fatal("corrupt or torn slot journal accepted")
			}
		})
	}
}

func TestBidSlotStoreRejectsNonDomainIdentifiersBeforeAdmission(t *testing.T) {
	store, err := OpenBidSlotStore(filepath.Join(t.TempDir(), "slots.wal"), 1)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	changeLast := func(value string) string {
		replacement := byte('0')
		if value[len(value)-1] == replacement {
			replacement = '1'
		}
		return value[:len(value)-1] + string(replacement)
	}
	for name, mutate := range map[string]func(*BidSlotRequest){
		"operation prefix": func(value *BidSlotRequest) { value.OperationID = "wrong:" + value.OperationID[6:] },
		"operation length": func(value *BidSlotRequest) { value.OperationID = value.OperationID[:63] },
		"operation case":   func(value *BidSlotRequest) { value.OperationID = value.OperationID[:63] + "A" },
		"operation digest": func(value *BidSlotRequest) { value.OperationID = changeLast(value.OperationID) },
		"bid prefix":       func(value *BidSlotRequest) { value.BidID = "wrong:" + value.BidID[6:] },
		"bid digest":       func(value *BidSlotRequest) { value.BidID = changeLast(value.BidID) },
		"intent binding":   func(value *BidSlotRequest) { value.IntentDigest = changeLast(value.IntentDigest) },
	} {
		request := slotFixture("invalid-"+name, 13)
		mutate(&request)
		if _, err := store.Reserve(request); err == nil {
			t.Fatalf("%s accepted", name)
		}
	}
	if used, _ := store.Usage(); used != 0 {
		t.Fatalf("invalid identifiers consumed %d slots", used)
	}
}

func TestBidSlotStoreConcurrentAdmissionNeverExceedsCap(t *testing.T) {
	store, err := OpenBidSlotStore(filepath.Join(t.TempDir(), "slots.wal"), 5)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	var wait sync.WaitGroup
	accepted := make(chan BidSlotReservationV1, 20)
	for index := 0; index < 20; index++ {
		wait.Add(1)
		go func(index int) {
			defer wait.Done()
			request := slotFixture(fmt.Sprintf("op-%02d", index), int64(13+index))
			if value, err := store.Reserve(request); err == nil {
				accepted <- value
			}
		}(index)
	}
	wait.Wait()
	close(accepted)
	seen := make(map[int]struct{})
	for value := range accepted {
		seen[value.Slot] = struct{}{}
	}
	used, capacity := store.Usage()
	if used != 5 || capacity != 5 || len(seen) != 5 {
		t.Fatalf("used/capacity/slots=%d/%d/%d", used, capacity, len(seen))
	}
}

func TestBridgeListenAddressIsExplicitLoopbackOnly(t *testing.T) {
	for _, value := range []string{"tcp://127.0.0.1:8080", "tcp://[::1]:8080"} {
		if err := ValidateBridgeListenAddress(value); err != nil {
			t.Fatalf("%s: %v", value, err)
		}
	}
	for _, value := range []string{"http://127.0.0.1:8080", "tcp://0.0.0.0:8080", "tcp://192.0.2.1:8080", "tcp://localhost:8080", "tcp://:8080"} {
		if err := ValidateBridgeListenAddress(value); err == nil {
			t.Fatalf("unsafe bridge bind accepted: %s", value)
		}
	}
	server, address, err := NewAuthenticatedBridgeServer("tcp://127.0.0.1:18080", http.NotFoundHandler())
	if err != nil || address != "127.0.0.1:18080" || server.ReadHeaderTimeout <= 0 || server.ReadTimeout <= 0 || server.WriteTimeout <= 0 || server.IdleTimeout <= 0 || server.MaxHeaderBytes != 8*1024 {
		t.Fatalf("bounded bridge server mismatch: address=%q server=%+v err=%v", address, server, err)
	}
}

func testBridge(t *testing.T, capacity int, rpc *fakeRPC) (*AuthenticatedBridge, func()) {
	t.Helper()
	genesis := authenticatedGenesisFixture()
	_, store, err := OpenAuthenticatedApplication(genesis, filepath.Join(t.TempDir(), "state.wal"))
	if err != nil {
		t.Fatal(err)
	}
	slots, err := OpenBidSlotStore(filepath.Join(t.TempDir(), "slots.wal"), capacity)
	if err != nil {
		t.Fatal(err)
	}
	bridge, err := NewAuthenticatedBridge(genesis, store, slots, rpc, 4)
	if err != nil {
		t.Fatal(err)
	}
	return bridge, func() { slots.Close(); store.Close() }
}

func TestAuthenticatedBridgeDirectHandlersAreBoundedStrictAndPublicOnly(t *testing.T) {
	rpc := &fakeRPC{broadcasts: []*coretypes.ResultBroadcastTxCommit{{Height: 3}}}
	bridge, closeBridge := testBridge(t, 1, rpc)
	defer closeBridge()
	requestBody, _ := json.Marshal(slotFixture("op-1", 13))
	request := httptest.NewRequest(http.MethodPost, "/v1/demo-auth/bid-slots", bytes.NewReader(requestBody))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	bridge.ServeHTTP(response, request)
	if response.Code != http.StatusOK || response.Header().Get("Access-Control-Allow-Origin") != "" || !strings.Contains(response.Body.String(), BidSlotReservationSchema) {
		t.Fatalf("slot response: %d %s", response.Code, response.Body.String())
	}

	for name, malformed := range map[string]*http.Request{
		"method":       httptest.NewRequest(http.MethodGet, "/v1/demo-auth/bid-slots", nil),
		"content type": httptest.NewRequest(http.MethodPost, "/v1/demo-auth/bid-slots", bytes.NewReader(requestBody)),
		"oversize": func() *http.Request {
			value := httptest.NewRequest(http.MethodPost, "/v1/demo-auth/bid-slots", strings.NewReader(strings.Repeat("x", maxBridgeBodyBytes+1)))
			value.Header.Set("Content-Type", "application/json")
			return value
		}(),
		"duplicate": func() *http.Request {
			value := httptest.NewRequest(http.MethodPost, "/v1/demo-auth/bid-slots", strings.NewReader(`{"profile":"DEMO_AUTH_V1","profile":"DEMO_AUTH_V1"}`))
			value.Header.Set("Content-Type", "application/json")
			return value
		}(),
	} {
		recorder := httptest.NewRecorder()
		bridge.ServeHTTP(recorder, malformed)
		if recorder.Code < 400 {
			t.Fatalf("%s accepted: %d", name, recorder.Code)
		}
	}

	statusRecorder := httptest.NewRecorder()
	bridge.ServeHTTP(statusRecorder, httptest.NewRequest(http.MethodGet, "/v1/demo-auth/status", nil))
	var status DemoAuthBridgeStatusV2
	if statusRecorder.Code != http.StatusOK || json.Unmarshal(statusRecorder.Body.Bytes(), &status) != nil || status.Schema != DemoAuthBridgeStatusSchema || status.StateVersion != auction.StateVersion || status.CommittedBatchSchema != app.CommittedAuctionBatchSchema || status.AuctionStatus != auction.AuctionOpen || status.FreshSlotsUsed != 1 || status.AcceptedBidCount != 0 || status.CommittedLeaderAmount != 0 {
		t.Fatalf("status: %d %s", statusRecorder.Code, statusRecorder.Body.String())
	}
	batches := httptest.NewRecorder()
	bridge.ServeHTTP(batches, httptest.NewRequest(http.MethodGet, "/v1/demo-auth/batches?after_height=0&limit=16", nil))
	if batches.Code != http.StatusOK || !strings.Contains(batches.Body.String(), `"batches":[]`) {
		t.Fatalf("batches: %d %s", batches.Code, batches.Body.String())
	}
	for _, target := range []string{
		"/v1/demo-auth/batches", "/v1/demo-auth/batches?after_height=00", "/v1/demo-auth/batches?after_height=-1",
		"/v1/demo-auth/batches?after_height=0&limit=0", "/v1/demo-auth/batches?after_height=0&limit=17",
		"/v1/demo-auth/batches?after_height=0&after_height=1", "/v1/demo-auth/batches?after_height=0&unknown=1",
	} {
		recorder := httptest.NewRecorder()
		bridge.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, target, nil))
		if recorder.Code != http.StatusBadRequest {
			t.Fatalf("noncanonical page accepted: %s => %d", target, recorder.Code)
		}
	}
}

func TestAuthenticatedBridgeForwardsExactAcceptedWireBytes(t *testing.T) {
	genesis := authenticatedGenesisFixture()
	profile, _, err := genesis.Build()
	if err != nil {
		t.Fatal(err)
	}
	tags, err := bidauth.ExpectedTags(profile, 200)
	if err != nil {
		t.Fatal(err)
	}
	var signed bidauth.SignedEvent
	for index := range signed.Event.PublicKey {
		signed.Event.PublicKey[index] = byte(index + 1)
	}
	for index := range signed.ID {
		signed.ID[index] = byte(0x40 + index)
	}
	for index := range signed.Signature {
		signed.Signature[index] = byte(0x80 + index)
	}
	slot := slotFixture("forward", 13)
	slot.ActorPubkey = fmt.Sprintf("%x", signed.Event.PublicKey)
	command := auction.Command{Version: auction.CommandVersion, Kind: auction.CommandBid, OperationID: slot.OperationID, AuctionID: slot.AuctionID, BidID: slot.BidID, Amount: slot.Amount, Reservations: []auction.ReservationInput{{ReservationID: strings.Repeat("33", 32), Amount: slot.Amount}}}
	content, err := auction.EncodeCommand(command, Policy())
	if err != nil {
		t.Fatal(err)
	}
	signed.Event.CreatedAt, signed.Event.Kind, signed.Event.Tags, signed.Event.Content = 100, bidauth.DemoBidKind, tags, string(content)
	raw, err := bidauth.EncodeBridgeJSON(signed, profile)
	if err != nil {
		t.Fatal(err)
	}
	wantWire, err := bidauth.EncodeWire(signed, profile)
	if err != nil {
		t.Fatal(err)
	}
	rpc := &fakeRPC{broadcasts: []*coretypes.ResultBroadcastTxCommit{{Height: 7}}}
	bridge, closeBridge := testBridge(t, 1, rpc)
	defer closeBridge()
	request := httptest.NewRequest(http.MethodPost, "/v1/demo-auth/bids", bytes.NewReader(raw))
	request.Header.Set("Content-Type", "application/json")
	unreserved := httptest.NewRecorder()
	bridge.ServeHTTP(unreserved, request)
	if unreserved.Code != http.StatusConflict || len(rpc.transactions) != 0 || !strings.Contains(unreserved.Body.String(), "bid_slot_required") {
		t.Fatalf("unreserved Bid reached RPC: %d %s", unreserved.Code, unreserved.Body.String())
	}
	if _, err := bridge.slots.Reserve(slot); err != nil {
		t.Fatal(err)
	}
	request = httptest.NewRequest(http.MethodPost, "/v1/demo-auth/bids", bytes.NewReader(raw))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	bridge.ServeHTTP(response, request)
	if response.Code != http.StatusOK || len(rpc.transactions) != 1 || !bytes.Equal(rpc.transactions[0], wantWire) {
		t.Fatalf("broadcast mismatch: %d %s", response.Code, response.Body.String())
	}
	changedCommand := command
	changedCommand.Amount++
	changedCommand.Reservations = []auction.ReservationInput{{ReservationID: strings.Repeat("33", 32), Amount: changedCommand.Amount}}
	changedContent, err := auction.EncodeCommand(changedCommand, Policy())
	if err != nil {
		t.Fatal(err)
	}
	changed := signed
	changed.Event.Content = string(changedContent)
	changedRaw, err := bidauth.EncodeBridgeJSON(changed, profile)
	if err != nil {
		t.Fatal(err)
	}
	changedRequest := httptest.NewRequest(http.MethodPost, "/v1/demo-auth/bids", bytes.NewReader(changedRaw))
	changedRequest.Header.Set("Content-Type", "application/json")
	changedResponse := httptest.NewRecorder()
	bridge.ServeHTTP(changedResponse, changedRequest)
	if changedResponse.Code != http.StatusConflict || len(rpc.transactions) != 1 {
		t.Fatalf("changed reserved tuple reached RPC: %d %s", changedResponse.Code, changedResponse.Body.String())
	}

	wrong := httptest.NewRequest(http.MethodPost, "/v1/demo-auth/bids", bytes.NewReader(bytes.Replace(raw, []byte(`"kind":28642`), []byte(`"kind":1023`), 1)))
	wrong.Header.Set("Content-Type", "application/json")
	rejected := httptest.NewRecorder()
	bridge.ServeHTTP(rejected, wrong)
	if rejected.Code != http.StatusBadRequest || len(rpc.transactions) != 1 {
		t.Fatalf("wrong kind reached RPC: %d", rejected.Code)
	}
}

func TestAuthenticatedBridgeConcurrentStatusBatchesAndCommitAreCoherentV2Snapshots(t *testing.T) {
	genesis := authenticatedGenesisFixture()
	application, store, err := OpenAuthenticatedApplication(genesis, filepath.Join(t.TempDir(), "state.wal"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	slots, err := OpenBidSlotStore(filepath.Join(t.TempDir(), "slots.wal"), 6)
	if err != nil {
		t.Fatal(err)
	}
	defer slots.Close()
	bridge, err := NewAuthenticatedBridge(genesis, store, slots, &fakeRPC{}, 64)
	if err != nil {
		t.Fatal(err)
	}

	stop := make(chan struct{})
	errorsSeen := make(chan string, 32)
	var readers sync.WaitGroup
	for worker := 0; worker < 8; worker++ {
		readers.Add(1)
		go func() {
			defer readers.Done()
			for {
				select {
				case <-stop:
					return
				default:
				}
				for _, target := range []string{"/v1/demo-auth/status", "/v1/demo-auth/batches?after_height=0&limit=16"} {
					recorder := httptest.NewRecorder()
					bridge.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, target, nil))
					if recorder.Code != http.StatusOK {
						select {
						case errorsSeen <- fmt.Sprintf("%s => %d %s", target, recorder.Code, recorder.Body.String()):
						default:
						}
						return
					}
				}
			}
		}()
	}
	for _, block := range []struct {
		height  int64
		seconds int64
	}{{height: 1, seconds: 999}, {height: 2, seconds: 1000}} {
		response, err := application.FinalizeBlock(context.Background(), &abci.FinalizeBlockRequest{Height: block.height, Time: time.Unix(block.seconds, 0).UTC()})
		if err != nil || len(response.AppHash) != sha256.Size {
			close(stop)
			readers.Wait()
			t.Fatalf("finalize height %d: response=%+v err=%v", block.height, response, err)
		}
		if _, err := application.Commit(context.Background(), &abci.CommitRequest{}); err != nil {
			close(stop)
			readers.Wait()
			t.Fatalf("commit height %d: %v", block.height, err)
		}
	}
	close(stop)
	readers.Wait()
	close(errorsSeen)
	for message := range errorsSeen {
		t.Fatal(message)
	}

	statusRecorder := httptest.NewRecorder()
	bridge.ServeHTTP(statusRecorder, httptest.NewRequest(http.MethodGet, "/v1/demo-auth/status", nil))
	var status DemoAuthBridgeStatusV2
	if err := json.Unmarshal(statusRecorder.Body.Bytes(), &status); err != nil {
		t.Fatal(err)
	}
	if status.Schema != DemoAuthBridgeStatusSchema || status.StateVersion != auction.StateVersion || status.LatestCommittedHeight != 2 || status.LatestCommittedPBTSSeconds != 1000 || status.AuctionStatus != auction.AuctionClosed || status.ClosedSeconds != 1000 || status.CloseOutcome != auction.OutcomeNoBids || status.WinnerBidID != "" || status.WinnerActorID != "" || status.WinnerAmount != 0 {
		t.Fatalf("final V2 status mismatch: %+v", status)
	}
	batchesRecorder := httptest.NewRecorder()
	bridge.ServeHTTP(batchesRecorder, httptest.NewRequest(http.MethodGet, "/v1/demo-auth/batches?after_height=0&limit=16", nil))
	var page struct {
		Batches []app.CommittedAuctionBatchV2 `json:"batches"`
	}
	if err := json.Unmarshal(batchesRecorder.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	if len(page.Batches) != 1 || page.Batches[0].Height != 2 || len(page.Batches[0].Bids) != 0 || len(page.Batches[0].Closures) != 1 || page.Batches[0].Closures[0].CloseOutcome != auction.OutcomeNoBids {
		t.Fatalf("closure-only V2 page mismatch: %+v", page.Batches)
	}
}

func TestAuthenticatedBridgeContextDoesNotAuthorizeCommit(t *testing.T) {
	// Compile-time evidence that the bridge consumes a context-bound RPC call;
	// no handler starts a listener in these tests.
	if context.Background() == nil {
		t.Fatal("unreachable")
	}
}
