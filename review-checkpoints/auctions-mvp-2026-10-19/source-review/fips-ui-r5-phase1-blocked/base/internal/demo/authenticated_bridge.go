package demo

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/PlebeianApp/market/services/auction-consensus/internal/app"
	"github.com/PlebeianApp/market/services/auction-consensus/internal/auction"
	"github.com/PlebeianApp/market/services/auction-consensus/internal/bidauth"
	cmttypes "github.com/cometbft/cometbft/types"
)

const (
	BidSlotReservationSchema   = "BidSlotReservationV1"
	DemoAuthBridgeStatusSchema = "DemoAuthBridgeStatusV2"
	MinSessionSubmissionCap    = 1
	MaxSessionSubmissionCap    = 40
	maxBridgeBodyBytes         = 8192
	maxSlotJournalBytes        = 2 * 1024 * 1024
)

// BidSlotRequest is public pre-lock capacity input. It deliberately cannot
// carry a proof, token, path, key, signature, or refund authority.
type BidSlotRequest struct {
	Profile      string `json:"profile"`
	ActorPubkey  string `json:"actor_pubkey"`
	AuctionID    string `json:"auction_id"`
	OperationID  string `json:"operation_id"`
	BidID        string `json:"bid_id"`
	Amount       int64  `json:"amount"`
	IntentDigest string `json:"intent_digest"`
}

type BidSlotReservationV1 struct {
	Schema      string `json:"schema"`
	Slot        int    `json:"slot"`
	Reservation string `json:"reservation_id"`
	BidSlotRequest
}

type slotRecord struct {
	Reservation BidSlotReservationV1 `json:"reservation"`
	Checksum    string               `json:"checksum"`
}

// BidSlotStore is the one durable ingress budget. A successfully written slot
// is never recycled, including when a later signing or submission step stops.
type BidSlotStore struct {
	mu      sync.Mutex
	file    *os.File
	cap     int
	ordered []BidSlotReservationV1
	byOp    map[string]BidSlotReservationV1
}

func OpenBidSlotStore(path string, sessionCap int) (*BidSlotStore, error) {
	if sessionCap < MinSessionSubmissionCap || sessionCap > MaxSessionSubmissionCap {
		return nil, fmt.Errorf("demo: session_submission_cap must be within 1..40")
	}
	if strings.TrimSpace(path) == "" {
		return nil, errors.New("demo: bid-slot journal path is required")
	}
	file, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE, 0o600)
	if err != nil {
		return nil, err
	}
	store := &BidSlotStore{file: file, cap: sessionCap, byOp: make(map[string]BidSlotReservationV1)}
	if err := store.recover(); err != nil {
		file.Close()
		return nil, err
	}
	return store, nil
}

func (store *BidSlotStore) Close() error {
	if store == nil || store.file == nil {
		return nil
	}
	return store.file.Close()
}

func (store *BidSlotStore) Usage() (used, capacity int) {
	store.mu.Lock()
	defer store.mu.Unlock()
	return len(store.ordered), store.cap
}

func canonicalSlotRequest(request BidSlotRequest) ([]byte, error) {
	if request.Profile != bidauth.DemoAuthProfile || !lowerHex(request.ActorPubkey, 64) || !lowerHex(request.IntentDigest, 64) {
		return nil, errors.New("demo: invalid bid-slot profile or identity")
	}
	if request.AuctionID == "" || len(request.AuctionID) > 64 || !demoDigestID(request.OperationID, "da1o:") || !demoDigestID(request.BidID, "da1b:") {
		return nil, errors.New("demo: invalid bid-slot tuple")
	}
	intentBytes, _ := hex.DecodeString(request.IntentDigest)
	bidDigest := sha256.Sum256(append([]byte("DEMO_AUTH_V1/bid\x00"), intentBytes...))
	if request.OperationID != "da1o:"+request.IntentDigest[:59] || request.BidID != "da1b:"+hex.EncodeToString(bidDigest[:])[:59] {
		return nil, errors.New("demo: invalid bid-slot intent binding")
	}
	if request.Amount < 1 || request.Amount > bidauth.DemoMaxInteger {
		return nil, errors.New("demo: invalid bid-slot amount")
	}
	return json.Marshal(request)
}

func demoDigestID(value, prefix string) bool {
	if len(value) != 64 || !strings.HasPrefix(value, prefix) {
		return false
	}
	for _, character := range value[len(prefix):] {
		if (character < '0' || character > '9') && (character < 'a' || character > 'f') {
			return false
		}
	}
	return true
}

func (store *BidSlotStore) Reserve(request BidSlotRequest) (BidSlotReservationV1, error) {
	canonical, err := canonicalSlotRequest(request)
	if err != nil {
		return BidSlotReservationV1{}, err
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	if prior, ok := store.byOp[request.OperationID]; ok {
		priorCanonical, _ := canonicalSlotRequest(prior.BidSlotRequest)
		if bytes.Equal(priorCanonical, canonical) {
			return prior, nil
		}
		return BidSlotReservationV1{}, errors.New("demo: bid-slot-operation-conflict")
	}
	if len(store.ordered) >= store.cap {
		return BidSlotReservationV1{}, errors.New("demo: bid-slot-capacity-exhausted")
	}
	digest := sha256.Sum256(append([]byte("DEMO_AUTH_V1/bid-slot\x00"), canonical...))
	reservation := BidSlotReservationV1{Schema: BidSlotReservationSchema, Slot: len(store.ordered) + 1, Reservation: hex.EncodeToString(digest[:]), BidSlotRequest: request}
	body, err := json.Marshal(reservation)
	if err != nil {
		return BidSlotReservationV1{}, err
	}
	checksum := sha256.Sum256(body)
	record, err := json.Marshal(slotRecord{Reservation: reservation, Checksum: hex.EncodeToString(checksum[:])})
	if err != nil {
		return BidSlotReservationV1{}, err
	}
	record = append(record, '\n')
	if _, err := store.file.Seek(0, io.SeekEnd); err != nil {
		return BidSlotReservationV1{}, err
	}
	if written, err := store.file.Write(record); err != nil || written != len(record) {
		return BidSlotReservationV1{}, fmt.Errorf("demo: append bid-slot journal")
	}
	if err := store.file.Sync(); err != nil {
		return BidSlotReservationV1{}, fmt.Errorf("demo: fsync bid-slot journal")
	}
	store.ordered = append(store.ordered, reservation)
	store.byOp[request.OperationID] = reservation
	return reservation, nil
}

// MatchBid proves that the public authenticated Bid being broadcast owns one
// exact pre-lock slot. It never consumes another slot.
func (store *BidSlotStore) MatchBid(actorPubkey string, command auction.Command) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	reservation, ok := store.byOp[command.OperationID]
	if !ok {
		return errors.New("demo: bid-slot-reservation-required")
	}
	if reservation.Profile != bidauth.DemoAuthProfile || reservation.ActorPubkey != actorPubkey || reservation.AuctionID != command.AuctionID || reservation.BidID != command.BidID || reservation.Amount != command.Amount {
		return errors.New("demo: bid-slot-operation-conflict")
	}
	return nil
}

func (store *BidSlotStore) recover() error {
	raw, err := io.ReadAll(io.LimitReader(store.file, maxSlotJournalBytes+1))
	if err != nil || len(raw) > maxSlotJournalBytes {
		return errors.New("demo: bid-slot journal is unavailable or oversized")
	}
	lines := bytes.Split(raw, []byte{'\n'})
	for index, line := range lines {
		if len(line) == 0 {
			if index != len(lines)-1 {
				return errors.New("demo: empty bid-slot journal record")
			}
			continue
		}
		var record slotRecord
		if err := decodeStrict(line, &record); err != nil {
			return errors.New("demo: invalid bid-slot journal record")
		}
		body, err := json.Marshal(record.Reservation)
		checksum := sha256.Sum256(body)
		canonical, canonicalErr := canonicalSlotRequest(record.Reservation.BidSlotRequest)
		expectedReservation := sha256.Sum256(append([]byte("DEMO_AUTH_V1/bid-slot\x00"), canonical...))
		if err != nil || canonicalErr != nil || record.Checksum != hex.EncodeToString(checksum[:]) || record.Reservation.Schema != BidSlotReservationSchema || record.Reservation.Slot != len(store.ordered)+1 || record.Reservation.Reservation != hex.EncodeToString(expectedReservation[:]) {
			return errors.New("demo: corrupt bid-slot journal record")
		}
		if _, exists := store.byOp[record.Reservation.OperationID]; exists {
			return errors.New("demo: conflicting bid-slot journal operation")
		}
		store.ordered = append(store.ordered, record.Reservation)
		store.byOp[record.Reservation.OperationID] = record.Reservation
	}
	if len(store.ordered) > store.cap {
		return errors.New("demo: bid-slot journal exceeds configured capacity")
	}
	_, err = store.file.Seek(0, io.SeekEnd)
	return err
}

type AuthenticatedBridge struct {
	profile bidauth.Profile
	genesis AuthenticatedGenesis
	initial auction.State
	store   *app.DurableStore
	slots   *BidSlotStore
	rpc     RPC
	sem     chan struct{}
}

func NewAuthenticatedBridge(genesis AuthenticatedGenesis, store *app.DurableStore, slots *BidSlotStore, rpc RPC, maxConcurrent int) (*AuthenticatedBridge, error) {
	profile, initial, err := genesis.Build()
	if err != nil {
		return nil, err
	}
	if store == nil || slots == nil || rpc == nil || maxConcurrent < 1 || maxConcurrent > 64 {
		return nil, errors.New("demo: invalid authenticated bridge dependencies")
	}
	return &AuthenticatedBridge{profile: profile, genesis: genesis, initial: initial, store: store, slots: slots, rpc: rpc, sem: make(chan struct{}, maxConcurrent)}, nil
}

func ValidateBridgeListenAddress(address string) error {
	if address == "" {
		return nil
	}
	if !strings.HasPrefix(address, "tcp://") {
		return errors.New("demo: bridge listen address must use tcp://")
	}
	host, port, err := net.SplitHostPort(strings.TrimPrefix(address, "tcp://"))
	if err != nil || port == "" {
		return errors.New("demo: bridge listen address is invalid")
	}
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsLoopback() || ip.IsUnspecified() {
		return errors.New("demo: bridge listen address must be an explicit IP loopback")
	}
	return nil
}

func (bridge *AuthenticatedBridge) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	select {
	case bridge.sem <- struct{}{}:
		defer func() { <-bridge.sem }()
	default:
		writeBridgeError(writer, http.StatusServiceUnavailable, "bridge_busy")
		return
	}
	switch request.URL.Path {
	case "/v1/demo-auth/bids":
		bridge.handleBid(writer, request)
	case "/v1/demo-auth/bid-slots":
		bridge.handleSlot(writer, request)
	case "/v1/demo-auth/status":
		bridge.handleStatus(writer, request)
	case "/v1/demo-auth/batches":
		bridge.handleBatches(writer, request)
	default:
		writeBridgeError(writer, http.StatusNotFound, "not_found")
	}
}

func readBridgeJSON(request *http.Request) ([]byte, error) {
	mediaType, _, err := mime.ParseMediaType(request.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		return nil, errors.New("content_type")
	}
	raw, err := io.ReadAll(io.LimitReader(request.Body, maxBridgeBodyBytes+1))
	if err != nil || len(raw) == 0 || len(raw) > maxBridgeBodyBytes {
		return nil, errors.New("body_limit")
	}
	return raw, nil
}

func (bridge *AuthenticatedBridge) handleBid(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		writeBridgeError(writer, http.StatusMethodNotAllowed, "method")
		return
	}
	raw, err := readBridgeJSON(request)
	if err != nil {
		writeBridgeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	signed, err := bidauth.DecodeBridgeJSON(raw, bridge.profile)
	if err != nil {
		writeBridgeError(writer, http.StatusBadRequest, "invalid_authenticated_bid")
		return
	}
	wire, err := bidauth.EncodeWire(signed, bridge.profile)
	if err != nil {
		writeBridgeError(writer, http.StatusBadRequest, "invalid_authenticated_bid")
		return
	}
	command, err := auction.DecodeCommand([]byte(signed.Event.Content), Policy())
	if err != nil || command.Kind != auction.CommandBid {
		writeBridgeError(writer, http.StatusBadRequest, "invalid_authenticated_bid")
		return
	}
	canonical, err := auction.EncodeCommand(command, Policy())
	if err != nil || !bytes.Equal(canonical, []byte(signed.Event.Content)) {
		writeBridgeError(writer, http.StatusBadRequest, "invalid_authenticated_bid")
		return
	}
	if err := bridge.slots.MatchBid(hex.EncodeToString(signed.Event.PublicKey[:]), command); err != nil {
		writeBridgeError(writer, http.StatusConflict, fixedBridgeClass(err))
		return
	}
	result, err := bridge.rpc.BroadcastTxCommit(request.Context(), cmttypes.Tx(wire))
	if err != nil || result == nil {
		writeBridgeError(writer, http.StatusBadGateway, "rpc_unavailable")
		return
	}
	response := map[string]any{"event_id": hex.EncodeToString(signed.ID[:]), "transaction_sha256": fmt.Sprintf("%x", sha256.Sum256(wire)), "height": result.Height, "check_tx_code": result.CheckTx.Code, "finalize_tx_code": result.TxResult.Code}
	if result.CheckTx.Code != 0 || result.TxResult.Code != 0 || result.Height < 1 {
		writeBridgeJSON(writer, http.StatusConflict, response)
		return
	}
	writeBridgeJSON(writer, http.StatusOK, response)
}

func (bridge *AuthenticatedBridge) handleSlot(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		writeBridgeError(writer, http.StatusMethodNotAllowed, "method")
		return
	}
	raw, err := readBridgeJSON(request)
	if err != nil {
		writeBridgeError(writer, http.StatusBadRequest, err.Error())
		return
	}
	if err := requireExactMembers(raw, []string{"profile", "actor_pubkey", "auction_id", "operation_id", "bid_id", "amount", "intent_digest"}); err != nil {
		writeBridgeError(writer, http.StatusBadRequest, "invalid_bid_slot")
		return
	}
	var input BidSlotRequest
	if err := decodeStrict(raw, &input); err != nil || input.AuctionID != bridge.genesis.Auction.AuctionID {
		writeBridgeError(writer, http.StatusBadRequest, "invalid_bid_slot")
		return
	}
	reservation, err := bridge.slots.Reserve(input)
	if err != nil {
		code := http.StatusConflict
		if strings.Contains(err.Error(), "capacity") {
			code = http.StatusTooManyRequests
		}
		writeBridgeError(writer, code, fixedBridgeClass(err))
		return
	}
	writeBridgeJSON(writer, http.StatusOK, reservation)
}

type DemoAuthBridgeStatusV2 struct {
	Schema                     string                `json:"schema"`
	Profile                    string                `json:"profile"`
	StateVersion               uint32                `json:"state_version"`
	CommittedBatchSchema       string                `json:"committed_batch_schema"`
	NetworkID                  string                `json:"network_id"`
	ChainID                    string                `json:"chain_id"`
	AuctionID                  string                `json:"auction_id"`
	BaseEnd                    int64                 `json:"base_end"`
	StartingBid                int64                 `json:"starting_bid"`
	Reserve                    int64                 `json:"reserve"`
	AuctionStatus              auction.AuctionStatus `json:"auction_status"`
	EffectiveEnd               int64                 `json:"effective_end"`
	ClosedSeconds              int64                 `json:"closed_seconds"`
	CloseOutcome               auction.CloseOutcome  `json:"close_outcome"`
	WinnerBidID                string                `json:"winner_bid_id"`
	WinnerActorID              string                `json:"winner_actor_id"`
	WinnerAmount               int64                 `json:"winner_amount"`
	LatestCommittedHeight      int64                 `json:"latest_committed_height"`
	LatestAppHash              string                `json:"latest_app_hash"`
	LatestCommittedPBTSSeconds int64                 `json:"latest_committed_pbts_seconds"`
	FreshSlotsUsed             int                   `json:"fresh_slots_used"`
	SessionSubmissionCap       int                   `json:"session_submission_cap"`
	AcceptedBidCount           int                   `json:"accepted_bid_count"`
	CommittedLeaderAmount      int64                 `json:"committed_leader_amount"`
}

func (bridge *AuthenticatedBridge) handleStatus(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet {
		writeBridgeError(writer, http.StatusMethodNotAllowed, "method")
		return
	}
	state, _, hash, height, committed := bridge.store.Recovered()
	if !committed {
		state = bridge.initial
	}
	item, ok := state.Auctions[bridge.genesis.Auction.AuctionID]
	if !ok {
		writeBridgeError(writer, http.StatusInternalServerError, "state_unavailable")
		return
	}
	used, capacity := bridge.slots.Usage()
	status := DemoAuthBridgeStatusV2{
		Schema: DemoAuthBridgeStatusSchema, Profile: bidauth.DemoAuthProfile, StateVersion: state.Version,
		CommittedBatchSchema: app.CommittedAuctionBatchSchema, NetworkID: bridge.profile.NetworkHex(), ChainID: bridge.profile.ChainID,
		AuctionID: item.AuctionID, BaseEnd: item.BaseEnd, StartingBid: item.StartingBid, Reserve: item.Reserve,
		AuctionStatus: item.Status, EffectiveEnd: item.EffectiveEnd, ClosedSeconds: item.ClosedSeconds, CloseOutcome: item.CloseOutcome,
		WinnerBidID: item.WinnerBidID, LatestCommittedHeight: height, LatestAppHash: hex.EncodeToString(hash[:]),
		LatestCommittedPBTSSeconds: state.LastConsensusSeconds, FreshSlotsUsed: used, SessionSubmissionCap: capacity,
		AcceptedBidCount: len(item.Bids),
	}
	if item.LeaderBidID != "" {
		status.CommittedLeaderAmount = item.Bids[item.LeaderBidID].Amount
	}
	if item.WinnerBidID != "" {
		winner := item.Bids[item.WinnerBidID]
		status.WinnerActorID = winner.BidderID
		status.WinnerAmount = winner.Amount
	}
	writeBridgeJSON(writer, http.StatusOK, status)
}

func parseCanonicalBridgeInteger(raw string, minimum, maximum int64) (int64, error) {
	if raw == "" || (len(raw) > 1 && raw[0] == '0') {
		return 0, errors.New("noncanonical integer")
	}
	for _, character := range raw {
		if character < '0' || character > '9' {
			return 0, errors.New("noncanonical integer")
		}
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value < minimum || value > maximum || strconv.FormatInt(value, 10) != raw {
		return 0, errors.New("integer outside bounds")
	}
	return value, nil
}

func strictBatchPage(rawQuery string) (int64, int64, error) {
	query, err := url.ParseQuery(rawQuery)
	if err != nil {
		return 0, 0, err
	}
	for key, values := range query {
		if (key != "after_height" && key != "limit") || len(values) != 1 {
			return 0, 0, errors.New("invalid query")
		}
	}
	afterValues, ok := query["after_height"]
	if !ok || len(afterValues) != 1 {
		return 0, 0, errors.New("after_height is required")
	}
	after, err := parseCanonicalBridgeInteger(afterValues[0], 0, int64(^uint64(0)>>1))
	if err != nil {
		return 0, 0, err
	}
	limit := int64(16)
	if values, ok := query["limit"]; ok {
		limit, err = parseCanonicalBridgeInteger(values[0], 1, 16)
		if err != nil {
			return 0, 0, err
		}
	}
	return after, limit, nil
}

func (bridge *AuthenticatedBridge) handleBatches(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet {
		writeBridgeError(writer, http.StatusMethodNotAllowed, "method")
		return
	}
	after, limit, err := strictBatchPage(request.URL.RawQuery)
	if err != nil {
		writeBridgeError(writer, http.StatusBadRequest, "invalid_page")
		return
	}
	all := bridge.store.CommittedBatches()
	result := make([]app.CommittedAuctionBatchV2, 0, limit)
	for _, batch := range all {
		if batch.Height > after && (len(batch.Bids) > 0 || len(batch.Closures) > 0) {
			result = append(result, batch)
			if int64(len(result)) == limit {
				break
			}
		}
	}
	writeBridgeJSON(writer, http.StatusOK, map[string]any{"batches": result})
}

func writeBridgeJSON(writer http.ResponseWriter, status int, value any) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(value)
}

func writeBridgeError(writer http.ResponseWriter, status int, class string) {
	writeBridgeJSON(writer, status, map[string]string{"error": class})
}

func fixedBridgeClass(err error) string {
	if strings.Contains(err.Error(), "capacity") {
		return "bid_slot_capacity"
	}
	if strings.Contains(err.Error(), "conflict") {
		return "bid_slot_conflict"
	}
	if strings.Contains(err.Error(), "required") {
		return "bid_slot_required"
	}
	return "bid_slot_refused"
}

func lowerHex(value string, length int) bool {
	if len(value) != length || strings.ToLower(value) != value {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}

func decodeStrict(raw []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return errors.New("trailing JSON")
	}
	return nil
}

func requireExactMembers(raw []byte, names []string) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	token, err := decoder.Token()
	if err != nil || token != json.Delim('{') {
		return errors.New("not object")
	}
	want := make(map[string]struct{}, len(names))
	for _, name := range names {
		want[name] = struct{}{}
	}
	seen := make(map[string]struct{}, len(names))
	for decoder.More() {
		keyToken, err := decoder.Token()
		if err != nil {
			return err
		}
		key, ok := keyToken.(string)
		if !ok {
			return errors.New("bad key")
		}
		if _, ok := want[key]; !ok {
			return errors.New("unknown key")
		}
		if _, ok := seen[key]; ok {
			return errors.New("duplicate key")
		}
		seen[key] = struct{}{}
		var value json.RawMessage
		if err := decoder.Decode(&value); err != nil {
			return err
		}
	}
	if _, err := decoder.Token(); err != nil || len(seen) != len(want) {
		return errors.New("member count")
	}
	return nil
}

func NewAuthenticatedBridgeServer(address string, handler http.Handler) (*http.Server, string, error) {
	if err := ValidateBridgeListenAddress(address); err != nil {
		return nil, "", err
	}
	if address == "" {
		return nil, "", nil
	}
	server := &http.Server{Addr: strings.TrimPrefix(address, "tcp://"), Handler: handler, ReadHeaderTimeout: 3 * time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 15 * time.Second, MaxHeaderBytes: 8 * 1024}
	return server, server.Addr, nil
}

// ShutdownBridge is separate so callers never perform node/RPC work while
// holding a durable-store snapshot lock.
func ShutdownBridge(ctx context.Context, server *http.Server) error {
	if server == nil {
		return nil
	}
	return server.Shutdown(ctx)
}
