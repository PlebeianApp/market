package app

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/PlebeianApp/market/services/auction-consensus/internal/auction"
)

func validDisplacedBatch() CommittedAuctionBatchV2 {
	return CommittedAuctionBatchV2{Schema: CommittedAuctionBatchSchema, AuthProfile: "DEMO_AUTH_V1", AuthNetworkID: strings.Repeat("1", 64), ChainID: "chain", Height: 1, PBTSSeconds: 1, AppHash: strings.Repeat("2", 64), Bids: []CommittedBidEntry{{ActorID: strings.Repeat("3", 64), OperationID: "current-operation", AuctionID: "auction", BidID: "current-bid", EventID: strings.Repeat("4", 64), Amount: 1, DisplacedActorID: strings.Repeat("5", 64), DisplacedOperationID: "original-operation", DisplacedBidID: "original-bid", DisplacedEventID: strings.Repeat("6", 64), DisplacedRefundable: true}}, Closures: []CommittedAutomaticCloseEntry{}}
}

func validClosureBatch() CommittedAuctionBatchV2 {
	batch := CommittedAuctionBatchV2{Schema: CommittedAuctionBatchSchema, AuthProfile: "DEMO_AUTH_V1", AuthNetworkID: strings.Repeat("1", 64), ChainID: "fresh-chain", Height: 2, PBTSSeconds: 1000, AppHash: strings.Repeat("2", 64), Bids: []CommittedBidEntry{}, Closures: []CommittedAutomaticCloseEntry{}}
	batch.Closures = append(batch.Closures, CommittedAutomaticCloseEntry{AuthNetworkID: batch.AuthNetworkID, ChainID: batch.ChainID, AuctionID: "auction", Height: batch.Height, PBTSSeconds: batch.PBTSSeconds, EffectiveEnd: 1000, AppHash: batch.AppHash, CloseOutcome: auction.OutcomeWinner, WinnerBidID: "bid", WinnerActorID: strings.Repeat("3", 64), WinnerOperationID: "operation", Amount: 100})
	return batch
}

func TestCommittedAuctionBatchV2ClosureBindingAndOrdering(t *testing.T) {
	if err := validClosureBatch().Validate(); err != nil {
		t.Fatalf("valid closure rejected: %v", err)
	}
	tests := map[string]func(*CommittedAuctionBatchV2){
		"network": func(batch *CommittedAuctionBatchV2) { batch.Closures[0].AuthNetworkID = strings.Repeat("4", 64) },
		"chain":   func(batch *CommittedAuctionBatchV2) { batch.Closures[0].ChainID = "other" },
		"height":  func(batch *CommittedAuctionBatchV2) { batch.Closures[0].Height++ },
		"time":    func(batch *CommittedAuctionBatchV2) { batch.Closures[0].PBTSSeconds++ },
		"hash":    func(batch *CommittedAuctionBatchV2) { batch.Closures[0].AppHash = strings.Repeat("5", 64) },
		"winner":  func(batch *CommittedAuctionBatchV2) { batch.Closures[0].WinnerOperationID = "" },
		"late end": func(batch *CommittedAuctionBatchV2) {
			batch.Closures[0].EffectiveEnd = batch.PBTSSeconds + 1
		},
		"order": func(batch *CommittedAuctionBatchV2) {
			second := batch.Closures[0]
			second.AuctionID = "a"
			batch.Closures = append(batch.Closures, second)
		},
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			batch := validClosureBatch()
			mutate(&batch)
			if err := batch.Validate(); err == nil {
				t.Fatal("invalid closure batch accepted")
			}
		})
	}
}

func TestCommittedAuctionBatchV2SortsMultipleAutomaticClosures(t *testing.T) {
	policy := testPolicy()
	state := auction.NewState()
	for _, auctionID := range []string{"z", "a"} {
		transition, err := auction.Transition(state, createCommand("create-"+auctionID, auctionID, 20), auction.AcceptanceContext{ActorID: "seller-" + auctionID, ConsensusSeconds: 1}, policy)
		if err != nil {
			t.Fatal(err)
		}
		state = transition.State
	}
	advanced, err := auction.AdvanceConsensusTime(state, 2, 20, policy)
	if err != nil {
		t.Fatal(err)
	}
	closures := []auction.AutomaticCloseRecord{advanced.Closures[1], advanced.Closures[0]}
	hash, err := auction.CanonicalHash(advanced.State, policy)
	if err != nil {
		t.Fatal(err)
	}
	batch, err := buildCommittedAuctionBatch(authProfile(), 2, hash, advanced.State, nil, closures, nil, policy)
	if err != nil {
		t.Fatal(err)
	}
	if len(batch.Closures) != 2 || batch.Closures[0].AuctionID != "a" || batch.Closures[1].AuctionID != "z" {
		t.Fatalf("V2 closures not sorted: %+v", batch.Closures)
	}
}

func TestCommittedBidBatchDisplacedIdentityGrammar(t *testing.T) {
	if err := validDisplacedBatch().Validate(); err != nil {
		t.Fatalf("valid lowercase displaced tuple rejected: %v", err)
	}
	invalid := map[string]string{"63": strings.Repeat("a", 63), "65": strings.Repeat("a", 65), "non hex": strings.Repeat("z", 64), "uppercase": strings.Repeat("A", 64)}
	for field := range map[string]bool{"actor": true, "event": true} {
		for name, value := range invalid {
			t.Run(field+" "+name, func(t *testing.T) {
				batch := validDisplacedBatch()
				if field == "actor" {
					batch.Bids[0].DisplacedActorID = value
				} else {
					batch.Bids[0].DisplacedEventID = value
				}
				if err := batch.Validate(); err == nil {
					t.Fatal("invalid displaced identity accepted")
				}
			})
		}
	}
}

func TestCommittedAuctionBatchV2GoldenPublicFixture(t *testing.T) {
	application, store := newAuthenticatedTestApp(t, filepath.Join(t.TempDir(), "state.wal"))
	defer store.Close()
	policy := testPolicy()
	first := authenticatedBid(t, policy, 0x11, "auctions.bid-lock:friday-auction:bid-one", "bid-one", 100, 100, 200)
	second := authenticatedBid(t, policy, 0x22, "auctions.bid-lock:friday-auction:bid-two", "bid-two", 110, 101, 201)
	finalizeAndCommit(t, application, 1, 100, first)
	finalizeAndCommit(t, application, 2, 101, second)
	_, batch, _, _, ok := store.Recovered()
	if !ok {
		t.Fatal("batch not recovered")
	}
	raw, err := batch.CanonicalBytes()
	if err != nil {
		t.Fatal(err)
	}
	const want = `{"schema":"CommittedAuctionBatchV2","auth_profile":"DEMO_AUTH_V1","auth_network_id":"0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20","chain_id":"auth-test-chain","height":2,"pbts_seconds":101,"app_hash":"91f1a6058e72014fdb5f2b5b90ac4b18ad35859ebe11a30bae90d6c9d33e7152","bids":[{"actor_id":"2222222222222222222222222222222222222222222222222222222222222222","operation_id":"auctions.bid-lock:friday-auction:bid-two","auction_id":"friday-auction","bid_id":"bid-two","event_id":"3f5358bd8ceebadeaca40e2600b3fd52d55791f3c10eee8fc2a8cd62a74da7a3","amount":110,"displaced_actor_id":"1111111111111111111111111111111111111111111111111111111111111111","displaced_operation_id":"auctions.bid-lock:friday-auction:bid-one","displaced_bid_id":"bid-one","displaced_event_id":"88d6c0971a8f24fece0b3f2b523bf28bc6a7d54d9f610131a24b95c5849aa8f5","displaced_refund_eligible":true}],"closures":[]}`
	if string(raw) != want {
		t.Fatalf("public fixture mismatch\ngot: %s", raw)
	}
}
