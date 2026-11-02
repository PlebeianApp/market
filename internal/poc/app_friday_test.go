package poc

import (
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"fmt"
	"testing"
	"time"

	abci "github.com/cometbft/cometbft/abci/types"
)

// TestFridayABCITimingBoundaries exercises the ABCI paths that assign time.
// CheckTx is deliberately advisory and uses the last committed time; proposal
// and finalization use the proposed block time and are authoritative.
func TestFridayABCITimingBoundaries(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	seed := make([]byte, ed25519.SeedSize)
	seed[0] = 47
	committee := testPrivateKey(t)
	policy := DefaultPolicy()
	app, err := NewApplication("friday-abci-time", policy, seed, hex.EncodeToString(committee.PubKey().SerializeCompressed()), t.TempDir()+"/state.json")
	if err != nil {
		t.Fatal(err)
	}
	height := int64(1)
	advance := func(at int64) {
		t.Helper()
		if _, finalizeErr := app.FinalizeBlock(ctx, &abci.FinalizeBlockRequest{Time: time.Unix(at, 0), Height: height}); finalizeErr != nil {
			t.Fatalf("advance to %d: %v", at, finalizeErr)
		}
		if _, commitErr := app.Commit(ctx, &abci.CommitRequest{}); commitErr != nil {
			t.Fatalf("commit advance to %d: %v", at, commitErr)
		}
		height++
	}
	commit := func(tx Transaction, at int64) {
		t.Helper()
		raw, encodeErr := EncodeTransaction(tx)
		if encodeErr != nil {
			t.Fatal(encodeErr)
		}
		prepared, prepareErr := app.PrepareProposal(ctx, &abci.PrepareProposalRequest{Txs: [][]byte{raw}, Time: time.Unix(at, 0), MaxTxBytes: 1 << 20})
		if prepareErr != nil || len(prepared.Txs) != 1 {
			t.Fatalf("prepare at %d: response=%+v error=%v", at, prepared, prepareErr)
		}
		processed, processErr := app.ProcessProposal(ctx, &abci.ProcessProposalRequest{Txs: prepared.Txs, Time: time.Unix(at, 0), Height: height})
		if processErr != nil || processed.Status != abci.PROCESS_PROPOSAL_STATUS_ACCEPT {
			t.Fatalf("process at %d: response=%+v error=%v", at, processed, processErr)
		}
		if _, finalizeErr := app.FinalizeBlock(ctx, &abci.FinalizeBlockRequest{Txs: prepared.Txs, Time: time.Unix(at, 0), Height: height}); finalizeErr != nil {
			t.Fatalf("finalize at %d: %v", at, finalizeErr)
		}
		if _, commitErr := app.Commit(ctx, &abci.CommitRequest{}); commitErr != nil {
			t.Fatalf("commit at %d: %v", at, commitErr)
		}
		height++
	}

	// Establish a consensus-derived clock before the first signed event.
	advance(999)

	seller := testPrivateKey(t)
	create := testEvent(t, seller, 1_000, KindCreate, createContent{AuctionID: "cap", Title: "Cap", Duration: 300, StartingBid: 1_000})
	commit(Transaction{Version: TxVersion, Type: "event", Event: &create}, 1_000)

	// Drive the exact extension cap through CheckTx, proposal processing, and
	// finalization, rather than only through the state transition helper.
	var amount int64 = 1_000
	for index := 0; index < 12; index++ {
		app.mu.RLock()
		end := app.state.Auctions["cap"].EndTime
		app.mu.RUnlock()
		if end == 3_100 {
			break
		}
		at := end - 1
		advance(at - 1)
		bidder := testPrivateKey(t)
		reservationID := fmt.Sprintf("abci-cap-%02d", index)
		receipt := testReservationReceipt(t, committee, "cap", actorForKey(bidder), amount, reservationID, "", at+policy.ReceiptTTLSeconds-1)
		bid := testEvent(t, bidder, at, KindBid, bidContent{AuctionID: "cap", Amount: amount, Reservation: &receipt})
		raw, encodeErr := EncodeTransaction(Transaction{Version: TxVersion, Type: "event", Event: &bid})
		if encodeErr != nil {
			t.Fatal(encodeErr)
		}
		checked, checkErr := app.CheckTx(ctx, &abci.CheckTxRequest{Tx: raw})
		if checkErr != nil || checked.Code != 0 {
			t.Fatalf("CheckTx cap bid %d: response=%+v error=%v", index, checked, checkErr)
		}
		commit(Transaction{Version: TxVersion, Type: "event", Event: &bid}, at)
		amount += 100
	}
	app.mu.RLock()
	capEnd := app.state.Auctions["cap"].EndTime
	app.mu.RUnlock()
	if capEnd != 3_100 {
		t.Fatalf("ABCI extension cap=%d want=3100", capEnd)
	}
	capBidder := testPrivateKey(t)
	capReceipt := testReservationReceipt(t, committee, "cap", actorForKey(capBidder), amount, "abci-at-cap", "", 3_099+policy.ReceiptTTLSeconds)
	capBid := testEvent(t, capBidder, 3_099, KindBid, bidContent{AuctionID: "cap", Amount: amount, Reservation: &capReceipt})
	commit(Transaction{Version: TxVersion, Type: "event", Event: &capBid}, 3_099)
	app.mu.RLock()
	capEnd = app.state.Auctions["cap"].EndTime
	app.mu.RUnlock()
	if capEnd != 3_100 {
		t.Fatalf("qualifying bid beyond extension cap changed end to %d", capEnd)
	}
	amount += 100

	// The event claims the last eligible second. CheckTx accepts it using the
	// last committed time, but a proposal at the exact deadline must reject it.
	deadlineBidder := testPrivateKey(t)
	deadlineReceipt := testReservationReceipt(t, committee, "cap", actorForKey(deadlineBidder), amount, "abci-deadline", "", 3_099+policy.ReceiptTTLSeconds)
	deadlineBid := testEvent(t, deadlineBidder, 3_099, KindBid, bidContent{AuctionID: "cap", Amount: amount, Reservation: &deadlineReceipt})
	deadlineRaw, err := EncodeTransaction(Transaction{Version: TxVersion, Type: "event", Event: &deadlineBid})
	if err != nil {
		t.Fatal(err)
	}
	checked, err := app.CheckTx(ctx, &abci.CheckTxRequest{Tx: deadlineRaw})
	if err != nil || checked.Code != 0 {
		t.Fatalf("CheckTx before deadline: response=%+v error=%v", checked, err)
	}
	processed, err := app.ProcessProposal(ctx, &abci.ProcessProposalRequest{Txs: [][]byte{deadlineRaw}, Time: time.Unix(3_100, 0), Height: height})
	if err != nil || processed.Status != abci.PROCESS_PROPOSAL_STATUS_REJECT {
		t.Fatalf("proposal at deadline: response=%+v error=%v", processed, err)
	}
	prepared, err := app.PrepareProposal(ctx, &abci.PrepareProposalRequest{Txs: [][]byte{deadlineRaw}, Time: time.Unix(3_101, 0), MaxTxBytes: 1 << 20})
	if err != nil || len(prepared.Txs) != 0 {
		t.Fatalf("proposal after deadline: response=%+v error=%v", prepared, err)
	}

	closeTx, err := EncodeTransaction(Transaction{Version: TxVersion, Type: "close", AuctionID: "cap"})
	if err != nil {
		t.Fatal(err)
	}
	tooEarly, err := app.ProcessProposal(ctx, &abci.ProcessProposalRequest{Txs: [][]byte{closeTx}, Time: time.Unix(3_099, 0), Height: height})
	if err != nil || tooEarly.Status != abci.PROCESS_PROPOSAL_STATUS_REJECT {
		t.Fatalf("close before deadline: response=%+v error=%v", tooEarly, err)
	}
	commit(Transaction{Version: TxVersion, Type: "close", AuctionID: "cap"}, 3_100)
}

func TestFridayCheckTxNeverUsesClientTimestampAsDeadlineClock(t *testing.T) {
	t.Parallel()
	seed := make([]byte, ed25519.SeedSize)
	seed[0] = 53
	committee := testPrivateKey(t)
	policy := DefaultPolicy()
	state, err := NewState("friday-checktx-clock", ed25519.NewKeyFromSeed(seed).Public().(ed25519.PublicKey), hex.EncodeToString(committee.PubKey().SerializeCompressed()))
	if err != nil {
		t.Fatal(err)
	}
	seller := testPrivateKey(t)
	create := testEvent(t, seller, 1_000, KindCreate, createContent{AuctionID: "deadline", Title: "Deadline", Duration: 300, StartingBid: 1_000})
	state, err = ApplyTransaction(state, Transaction{Version: TxVersion, Type: "event", Event: &create}, 1_000, policy, seed)
	if err != nil {
		t.Fatal(err)
	}
	bidder := testPrivateKey(t)
	receipt := testReservationReceipt(t, committee, "deadline", actorForKey(bidder), 1_000, "client-clock", "", 1_599)
	event := testEvent(t, bidder, 1_300, KindBid, bidContent{AuctionID: "deadline", Amount: 1_000, Reservation: &receipt})
	tx := Transaction{Version: TxVersion, Type: "event", Event: &event}

	state.LastConsensusTime = 1_299
	if err := ValidateForMempool(state, tx, policy, seed); err != nil {
		t.Fatalf("client timestamp at deadline overrode last committed time: %v", err)
	}
	state.LastConsensusTime = 1_300
	earlyEvent := testEvent(t, bidder, 1_299, KindBid, bidContent{AuctionID: "deadline", Amount: 1_000, Reservation: &receipt})
	if err := ValidateForMempool(state, Transaction{Version: TxVersion, Type: "event", Event: &earlyEvent}, policy, seed); err == nil {
		t.Fatal("client timestamp before deadline overrode last committed deadline")
	}
}
