package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/PlebeianApp/market/services/auction-consensus/internal/auction"
	"github.com/PlebeianApp/market/services/auction-consensus/internal/bidauth"
)

const CommittedAuctionBatchSchema = "CommittedAuctionBatchV2"

// CommittedAuctionBatchV2 is public, non-bearer outbox data. It contains no Cashu
// proofs, tokens, keys, wallet credentials, or settlement authority.
type CommittedAuctionBatchV2 struct {
	Schema        string                         `json:"schema"`
	AuthProfile   string                         `json:"auth_profile"`
	AuthNetworkID string                         `json:"auth_network_id"`
	ChainID       string                         `json:"chain_id"`
	Height        int64                          `json:"height"`
	PBTSSeconds   int64                          `json:"pbts_seconds"`
	AppHash       string                         `json:"app_hash"`
	Bids          []CommittedBidEntry            `json:"bids"`
	Closures      []CommittedAutomaticCloseEntry `json:"closures"`
}

type CommittedBidEntry struct {
	ActorID              string `json:"actor_id"`
	OperationID          string `json:"operation_id"`
	AuctionID            string `json:"auction_id"`
	BidID                string `json:"bid_id"`
	EventID              string `json:"event_id"`
	Amount               int64  `json:"amount"`
	DisplacedActorID     string `json:"displaced_actor_id,omitempty"`
	DisplacedOperationID string `json:"displaced_operation_id,omitempty"`
	DisplacedBidID       string `json:"displaced_bid_id,omitempty"`
	DisplacedEventID     string `json:"displaced_event_id,omitempty"`
	DisplacedRefundable  bool   `json:"displaced_refund_eligible"`
}

type CommittedAutomaticCloseEntry struct {
	AuthNetworkID     string               `json:"auth_network_id"`
	ChainID           string               `json:"chain_id"`
	AuctionID         string               `json:"auction_id"`
	Height            int64                `json:"height"`
	PBTSSeconds       int64                `json:"pbts_seconds"`
	EffectiveEnd      int64                `json:"effective_end"`
	AppHash           string               `json:"app_hash"`
	CloseOutcome      auction.CloseOutcome `json:"close_outcome"`
	WinnerBidID       string               `json:"winner_bid_id"`
	WinnerActorID     string               `json:"winner_actor_id"`
	WinnerOperationID string               `json:"winner_operation_id"`
	Amount            int64                `json:"amount"`
}

func (batch CommittedAuctionBatchV2) CanonicalBytes() ([]byte, error) {
	if err := batch.Validate(); err != nil {
		return nil, err
	}
	return json.Marshal(batch)
}

func (batch CommittedAuctionBatchV2) Hash() ([32]byte, error) {
	raw, err := batch.CanonicalBytes()
	if err != nil {
		return [32]byte{}, err
	}
	return sha256.Sum256(raw), nil
}

func (batch CommittedAuctionBatchV2) Key() string {
	return fmt.Sprintf("%s/%d/%s", batch.AuthNetworkID, batch.Height, batch.AppHash)
}

func (batch CommittedAuctionBatchV2) Validate() error {
	if batch.Schema != CommittedAuctionBatchSchema || batch.AuthProfile != bidauth.DemoAuthProfile {
		return fmt.Errorf("app: invalid committed auction batch schema or profile")
	}
	if len(batch.AuthNetworkID) != 64 || batch.ChainID == "" || len(batch.AppHash) != 64 || batch.Height < 1 || batch.PBTSSeconds < 0 {
		return fmt.Errorf("app: invalid committed auction batch identity")
	}
	if strings.ToLower(batch.AuthNetworkID) != batch.AuthNetworkID {
		return fmt.Errorf("app: committed batch network ID is not lowercase")
	}
	if _, err := hex.DecodeString(batch.AuthNetworkID); err != nil {
		return fmt.Errorf("app: invalid committed batch network ID")
	}
	if strings.ToLower(batch.AppHash) != batch.AppHash {
		return fmt.Errorf("app: committed batch app hash is not lowercase")
	}
	if _, err := hex.DecodeString(batch.AppHash); err != nil {
		return fmt.Errorf("app: invalid committed batch app hash")
	}
	if len(batch.Bids) > 16 {
		return fmt.Errorf("app: committed batch exceeds bid count")
	}
	for index, bid := range batch.Bids {
		if len(bid.ActorID) != 64 || len(bid.EventID) != 64 || bid.OperationID == "" || bid.AuctionID == "" || bid.BidID == "" || bid.Amount <= 0 {
			return fmt.Errorf("app: invalid committed bid entry %d", index)
		}
		if _, err := hex.DecodeString(bid.ActorID); err != nil {
			return fmt.Errorf("app: invalid actor in committed entry %d", index)
		}
		if _, err := hex.DecodeString(bid.EventID); err != nil {
			return fmt.Errorf("app: invalid event in committed entry %d", index)
		}
		if bid.DisplacedRefundable != (bid.DisplacedBidID != "") {
			return fmt.Errorf("app: inconsistent displaced bid entry %d", index)
		}
		if bid.DisplacedBidID != "" && (len(bid.DisplacedActorID) != 64 || bid.DisplacedOperationID == "" || len(bid.DisplacedEventID) != 64) {
			return fmt.Errorf("app: invalid displaced actor in entry %d", index)
		}
		if bid.DisplacedBidID != "" {
			if _, err := hex.DecodeString(bid.DisplacedActorID); err != nil {
				return fmt.Errorf("app: invalid displaced actor in entry %d", index)
			}
			if _, err := hex.DecodeString(bid.DisplacedEventID); err != nil {
				return fmt.Errorf("app: invalid displaced event in entry %d", index)
			}
		}
		if strings.ToLower(bid.ActorID) != bid.ActorID || strings.ToLower(bid.EventID) != bid.EventID || strings.ToLower(bid.DisplacedActorID) != bid.DisplacedActorID || strings.ToLower(bid.DisplacedEventID) != bid.DisplacedEventID {
			return fmt.Errorf("app: committed bid entry %d has non-lowercase identity", index)
		}
	}
	if len(batch.Closures) > 64 {
		return fmt.Errorf("app: committed batch exceeds closure count")
	}
	previousAuctionID := ""
	for index, closure := range batch.Closures {
		if closure.AuthNetworkID != batch.AuthNetworkID || closure.ChainID != batch.ChainID || closure.Height != batch.Height || closure.PBTSSeconds != batch.PBTSSeconds || closure.AppHash != batch.AppHash || closure.AuctionID == "" || closure.EffectiveEnd < 0 || closure.EffectiveEnd > closure.PBTSSeconds {
			return fmt.Errorf("app: invalid automatic closure identity %d", index)
		}
		if index > 0 && closure.AuctionID <= previousAuctionID {
			return fmt.Errorf("app: automatic closures are not strictly sorted")
		}
		previousAuctionID = closure.AuctionID
		switch closure.CloseOutcome {
		case auction.OutcomeWinner:
			if closure.WinnerBidID == "" || len(closure.WinnerActorID) != 64 || closure.WinnerOperationID == "" || closure.Amount <= 0 {
				return fmt.Errorf("app: invalid automatic winner closure %d", index)
			}
			if strings.ToLower(closure.WinnerActorID) != closure.WinnerActorID {
				return fmt.Errorf("app: automatic winner actor is not lowercase")
			}
			if _, err := hex.DecodeString(closure.WinnerActorID); err != nil {
				return fmt.Errorf("app: invalid automatic winner actor %d", index)
			}
		case auction.OutcomeNoBids, auction.OutcomeReserveNotMet:
			if closure.WinnerBidID != "" || closure.WinnerActorID != "" || closure.WinnerOperationID != "" || closure.Amount != 0 {
				return fmt.Errorf("app: losing automatic closure has winner fields %d", index)
			}
		default:
			return fmt.Errorf("app: invalid automatic closure outcome %d", index)
		}
	}
	return nil
}

func buildCommittedAuctionBatch(profile bidauth.Profile, height int64, appHash [32]byte, prior auction.State, transactions []authenticatedTransaction, closures []auction.AutomaticCloseRecord, history []CommittedAuctionBatchV2, policy auction.Policy) (CommittedAuctionBatchV2, error) {
	batch := CommittedAuctionBatchV2{Schema: CommittedAuctionBatchSchema, AuthProfile: bidauth.DemoAuthProfile, AuthNetworkID: profile.NetworkHex(), ChainID: profile.ChainID, Height: height, PBTSSeconds: prior.LastConsensusSeconds, AppHash: hex.EncodeToString(appHash[:]), Bids: make([]CommittedBidEntry, 0, len(transactions)), Closures: make([]CommittedAutomaticCloseEntry, 0, len(closures))}
	state := prior
	accepted := make(map[string]CommittedBidEntry)
	for _, historical := range history {
		for _, entry := range historical.Bids {
			accepted[entry.AuctionID+"\x00"+entry.BidID] = entry
		}
	}
	for _, transaction := range transactions {
		before := state.Auctions[transaction.command.AuctionID]
		transition, err := transaction.bid.Transition(state, transaction.consensusSeconds, policy)
		if err != nil || transition.Replay {
			return CommittedAuctionBatchV2{}, fmt.Errorf("app: derive committed bid batch: %w", err)
		}
		eventID := transaction.bid.EventID()
		entry := CommittedBidEntry{ActorID: transaction.bid.ActorID(), OperationID: transaction.command.OperationID, AuctionID: transaction.command.AuctionID, BidID: transaction.command.BidID, EventID: hex.EncodeToString(eventID[:]), Amount: transaction.command.Amount}
		if transition.PreviousLeaderBidID != "" {
			previous := before.Bids[transition.PreviousLeaderBidID]
			previousEntry, ok := accepted[transaction.command.AuctionID+"\x00"+transition.PreviousLeaderBidID]
			if !ok || previousEntry.ActorID != previous.BidderID {
				return CommittedAuctionBatchV2{}, fmt.Errorf("app: displaced bid lacks one durable authenticated identity")
			}
			entry.DisplacedActorID = previous.BidderID
			entry.DisplacedOperationID = previousEntry.OperationID
			entry.DisplacedBidID = previous.BidID
			entry.DisplacedEventID = previousEntry.EventID
			entry.DisplacedRefundable = true
		}
		batch.Bids = append(batch.Bids, entry)
		accepted[entry.AuctionID+"\x00"+entry.BidID] = entry
		state = transition.State
	}
	sort.Slice(closures, func(i, j int) bool { return closures[i].AuctionID < closures[j].AuctionID })
	for _, closure := range closures {
		if closure.BlockHeight != height || closure.PBTSSeconds != prior.LastConsensusSeconds {
			return CommittedAuctionBatchV2{}, fmt.Errorf("app: automatic closure block identity mismatch")
		}
		entry := CommittedAutomaticCloseEntry{AuthNetworkID: batch.AuthNetworkID, ChainID: batch.ChainID, AuctionID: closure.AuctionID, Height: height, PBTSSeconds: closure.PBTSSeconds, EffectiveEnd: closure.EffectiveEnd, AppHash: batch.AppHash, CloseOutcome: closure.CloseOutcome, WinnerBidID: closure.WinnerBidID, WinnerActorID: closure.WinnerActorID, Amount: closure.WinnerAmount}
		if closure.WinnerBidID != "" {
			winner, ok := accepted[closure.AuctionID+"\x00"+closure.WinnerBidID]
			if !ok || winner.ActorID != closure.WinnerActorID || winner.Amount != closure.WinnerAmount {
				return CommittedAuctionBatchV2{}, fmt.Errorf("app: automatic winner lacks one durable authenticated identity")
			}
			entry.WinnerOperationID = winner.OperationID
		}
		batch.Closures = append(batch.Closures, entry)
	}
	if err := batch.Validate(); err != nil {
		return CommittedAuctionBatchV2{}, err
	}
	return batch, nil
}
