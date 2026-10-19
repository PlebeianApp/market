package app

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	"github.com/PlebeianApp/market/services/auction-consensus/internal/auction"
	"github.com/PlebeianApp/market/services/auction-consensus/internal/bidauth"
	abci "github.com/cometbft/cometbft/abci/types"
)

type fixtureVerifier struct{}

func (fixtureVerifier) Verify(_ [32]byte, _ [32]byte, signature [64]byte) error {
	if signature[0] != 7 {
		return context.Canceled
	}
	return nil
}

func authProfile() bidauth.Profile {
	var network [32]byte
	for index := range network {
		network[index] = byte(index + 1)
	}
	return bidauth.Profile{NetworkID: network, ChainID: "auth-test-chain", ActivationHeight: 1}
}
func authGenesis() auction.State {
	state := auction.NewState()
	state.Auctions["friday-auction"] = auction.Auction{AuctionID: "friday-auction", CreatorID: "genesis-seller", CreatedSeconds: 1, BaseEnd: 1000, EffectiveEnd: 1000, StartingBid: 100, Reserve: 0, AdvertisedIncrement: 10, Status: auction.AuctionOpen, Bids: make(map[string]auction.Bid)}
	return state
}

func authenticatedBid(t *testing.T, policy auction.Policy, keyByte byte, operation, bidID string, amount, created, until int64) []byte {
	t.Helper()
	command := bidCommand(operation, "friday-auction", bidID, amount)
	return authenticatedCommand(t, policy, keyByte, command, created, until)
}

func authenticatedCommand(t *testing.T, policy auction.Policy, keyByte byte, command auction.Command, created, until int64) []byte {
	t.Helper()
	content, err := auction.EncodeCommand(command, policy)
	if err != nil {
		t.Fatal(err)
	}
	tags, err := bidauth.ExpectedTags(authProfile(), until)
	if err != nil {
		t.Fatal(err)
	}
	var signed bidauth.SignedEvent
	for index := range signed.Event.PublicKey {
		signed.Event.PublicKey[index] = keyByte
	}
	signed.Event.CreatedAt = created
	signed.Event.Kind = bidauth.DemoBidKind
	signed.Event.Tags = tags
	signed.Event.Content = string(content)
	signed.Signature[0] = 7
	signed.ID, err = bidauth.ComputeEventID(signed.Event, bidauth.EventLimitsForProfile())
	if err != nil {
		t.Fatal(err)
	}
	raw, err := bidauth.EncodeWire(signed, authProfile())
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func newAuthenticatedTestApp(t *testing.T, path string) (*Application, *DurableStore) {
	t.Helper()
	policy := testPolicy()
	genesis := authGenesis()
	hash, err := auction.CanonicalHash(genesis, policy)
	if err != nil {
		t.Fatal(err)
	}
	store, err := OpenDurableStore(path, policy, hash)
	if err != nil {
		t.Fatal(err)
	}
	application, err := NewAuthenticatedApplication(policy, AuthenticatedConfig{Profile: authProfile(), Verifier: fixtureVerifier{}, GenesisAppState: []byte(`{"auth_profile":"DEMO_AUTH_V1"}`)}, genesis, store)
	if err != nil {
		t.Fatal(err)
	}
	return application, store
}

func TestAuthenticatedV2RequiresFreshGenesisHistory(t *testing.T) {
	policy := testPolicy()
	genesis := authGenesis()
	genesis.LastConsensusSeconds = 1
	hash, err := auction.CanonicalHash(genesis, policy)
	if err != nil {
		t.Fatal(err)
	}
	store, err := OpenDurableStore(filepath.Join(t.TempDir(), "state.wal"), policy, hash)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if application, err := NewAuthenticatedApplication(policy, AuthenticatedConfig{Profile: authProfile(), Verifier: fixtureVerifier{}, GenesisAppState: []byte(`{"auth_profile":"DEMO_AUTH_V1"}`)}, genesis, store); err == nil || application != nil {
		t.Fatal("authenticated V2 accepted reused consensus history")
	}
}

func TestAuthenticatedIngressIndependentChecksDurableOutboxAndRecovery(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.wal")
	application, store := newAuthenticatedTestApp(t, path)
	defer store.Close()
	policy := testPolicy()
	genesisBytes := []byte(`{"auth_profile":"DEMO_AUTH_V1"}`)
	if _, err := application.InitChain(context.Background(), &abci.InitChainRequest{InitialHeight: 1, AppStateBytes: genesisBytes}); err != nil {
		t.Fatalf("exact authenticated genesis rejected: %v", err)
	}
	if _, err := application.InitChain(context.Background(), &abci.InitChainRequest{InitialHeight: 1, AppStateBytes: []byte(`{}`)}); err == nil {
		t.Fatal("mismatched authenticated genesis accepted")
	}
	first := authenticatedBid(t, policy, 0x11, "auctions.bid-lock:friday-auction:bid-one", "bid-one", 100, 100, 200)
	second := authenticatedBid(t, policy, 0x22, "auctions.bid-lock:friday-auction:bid-two", "bid-two", 110, 101, 201)
	if response, err := application.CheckTx(context.Background(), &abci.CheckTxRequest{Tx: first}); err != nil || response.Code != 0 {
		t.Fatalf("CheckTx rejected: %+v %v", response, err)
	}
	prepared, err := application.PrepareProposal(context.Background(), prepareRequest(1, 100, 38304, first))
	if err != nil || len(prepared.Txs) != 1 {
		t.Fatalf("PrepareProposal: %+v %v", prepared, err)
	}
	framed := cometProtoSizeForTxs([][]byte{first})
	tooSmall, err := application.PrepareProposal(context.Background(), prepareRequest(1, 100, framed-1, first))
	if err != nil || len(tooSmall.Txs) != 0 {
		t.Fatal("one-under protobuf request limit selected transaction")
	}
	processed, err := application.ProcessProposal(context.Background(), processRequest(1, 100, first))
	if err != nil || processed.Status != abci.PROCESS_PROPOSAL_STATUS_ACCEPT {
		t.Fatalf("ProcessProposal: %+v %v", processed, err)
	}
	finalizeAndCommit(t, application, 1, 100, first)
	finalizeAndCommit(t, application, 2, 101, second)
	state, batch, hash, height, ok := store.Recovered()
	if !ok || height != 2 || len(batch.Bids) != 1 || !batch.Bids[0].DisplacedRefundable || batch.Bids[0].DisplacedBidID != "bid-one" {
		t.Fatalf("recovered outbox mismatch: ok=%v height=%d batch=%+v", ok, height, batch)
	}
	if batch.Bids[0].DisplacedOperationID != "auctions.bid-lock:friday-auction:bid-one" || len(batch.Bids[0].DisplacedEventID) != 64 {
		t.Fatal("outbox omitted displaced operation/event join")
	}
	if state.Auctions["friday-auction"].LeaderBidID != "bid-two" || !state.Auctions["friday-auction"].Bids["bid-one"].RefundEligible {
		t.Fatal("durable state does not match outbox")
	}
	if hash != application.committedHash {
		t.Fatal("recovered hash mismatch")
	}
	restarted, err := NewAuthenticatedApplication(policy, AuthenticatedConfig{Profile: authProfile(), Verifier: fixtureVerifier{}, GenesisAppState: []byte(`{"auth_profile":"DEMO_AUTH_V1"}`)}, authGenesis(), store)
	if err != nil {
		t.Fatal(err)
	}
	if restarted.committedHeight != 2 || restarted.committed.Operations["auctions.bid-lock:friday-auction:bid-one"].ActorID == "" {
		t.Fatal("restart lost height or operation ownership")
	}
	if response, _ := restarted.CheckTx(context.Background(), &abci.CheckTxRequest{Tx: append([]byte(nil), first...)}); response.Code != 0 {
		t.Fatal("advisory CheckTx rejected valid historical bytes")
	}
}

func TestAuthenticatedIngressRejectsTamperingLegacyAndExpired(t *testing.T) {
	application, store := newAuthenticatedTestApp(t, filepath.Join(t.TempDir(), "state.wal"))
	defer store.Close()
	policy := testPolicy()
	valid := authenticatedBid(t, policy, 0x33, "operation", "bid", 100, 100, 200)
	legacy := transaction(t, policy, "asserted", bidCommand("operation", "friday-auction", "bid", 100))
	signedClose := authenticatedCommand(t, policy, 0x33, closeCommand("close", "friday-auction"), 100, 200)
	badSignature := append([]byte(nil), valid...)
	badSignature[len(badSignature)-64] = 8
	badContent := append([]byte(nil), valid...)
	badContent[len(badContent)-97] ^= 1
	for name, raw := range map[string][]byte{"legacy": legacy, "signed close": signedClose, "signature": badSignature, "signed content": badContent} {
		t.Run(name, func(t *testing.T) {
			response, _ := application.CheckTx(context.Background(), &abci.CheckTxRequest{Tx: raw})
			if response.Code == 0 {
				t.Fatal("invalid transaction admitted")
			}
		})
	}
	if response, _ := application.ProcessProposal(context.Background(), processRequest(1, 200, valid)); response.Status != abci.PROCESS_PROPOSAL_STATUS_REJECT {
		t.Fatal("t=u accepted")
	}
	if _, _, err := application.finalize(finalizeRequest(1, 200, valid)); err == nil {
		t.Fatal("FinalizeBlock accepted expired event")
	}
}

func TestAuthenticatedBidNumericDomain(t *testing.T) {
	command := func(amount int64, reservations ...int64) auction.Command {
		value := bidCommand("operation", "friday-auction", "bid", amount)
		value.Reservations = make([]auction.ReservationInput, len(reservations))
		for index, reservationAmount := range reservations {
			value.Reservations[index] = auction.ReservationInput{ReservationID: fmt.Sprintf("reservation-%d", index), Amount: reservationAmount}
		}
		return value
	}
	tests := map[string]struct {
		command auction.Command
		valid   bool
	}{
		"safe maximum":                   {command(bidauth.DemoMaxInteger, bidauth.DemoMaxInteger-1, 1), true},
		"amount above maximum":           {command(bidauth.DemoMaxInteger+1, bidauth.DemoMaxInteger), false},
		"reservation above maximum":      {command(bidauth.DemoMaxInteger+1, bidauth.DemoMaxInteger+1), false},
		"checked sum above maximum":      {command(bidauth.DemoMaxInteger+1, bidauth.DemoMaxInteger, 1), false},
		"reservation sum mismatches Bid": {command(bidauth.DemoMaxInteger, bidauth.DemoMaxInteger-1), false},
	}
	for name, test := range tests {
		t.Run(name, func(t *testing.T) {
			err := validateAuthenticatedBidNumericDomain(test.command)
			if test.valid && err != nil {
				t.Fatalf("safe command rejected: %v", err)
			}
			if !test.valid && err == nil {
				t.Fatal("unsafe command accepted")
			}
		})
	}
}

func TestAuthenticatedIngressSafeIntegerBoundaryAcrossABCI(t *testing.T) {
	policy := testPolicy()
	command := func(operationID, bidID string, amount int64, reservations ...int64) auction.Command {
		value := bidCommand(operationID, "friday-auction", bidID, amount)
		value.Reservations = make([]auction.ReservationInput, len(reservations))
		for index, reservationAmount := range reservations {
			value.Reservations[index] = auction.ReservationInput{ReservationID: fmt.Sprintf("%s-reservation-%d", bidID, index), Amount: reservationAmount}
		}
		return value
	}

	t.Run("safe maximum passes every ABCI ingress", func(t *testing.T) {
		application, store := newAuthenticatedTestApp(t, filepath.Join(t.TempDir(), "state.wal"))
		defer store.Close()
		safe := authenticatedCommand(t, policy, 0x73, command("safe-operation", "safe-bid", bidauth.DemoMaxInteger, bidauth.DemoMaxInteger-1, 1), 100, 200)
		if response, err := application.CheckTx(context.Background(), &abci.CheckTxRequest{Tx: safe}); err != nil || response.Code != abci.CodeTypeOK {
			t.Fatalf("safe maximum CheckTx rejected: response=%+v err=%v", response, err)
		}
		prepared, err := application.PrepareProposal(context.Background(), prepareRequest(1, 100, 38304, safe))
		if err != nil || len(prepared.Txs) != 1 || !bytes.Equal(prepared.Txs[0], safe) {
			t.Fatalf("safe maximum PrepareProposal rejected: response=%+v err=%v", prepared, err)
		}
		processed, err := application.ProcessProposal(context.Background(), processRequest(1, 100, safe))
		if err != nil || processed.Status != abci.PROCESS_PROPOSAL_STATUS_ACCEPT {
			t.Fatalf("safe maximum ProcessProposal rejected: response=%+v err=%v", processed, err)
		}
		finalized, err := application.FinalizeBlock(context.Background(), finalizeRequest(1, 100, safe))
		if err != nil || application.pending == nil {
			t.Fatalf("safe maximum FinalizeBlock rejected: response=%+v err=%v", finalized, err)
		}
		if _, err := application.Commit(context.Background(), &abci.CommitRequest{}); err != nil {
			t.Fatal(err)
		}
		state, batch, recoveredHash, height, ok := store.Recovered()
		if !ok || height != 1 || recoveredHash != application.committedHash || len(batch.Bids) != 1 || batch.Bids[0].Amount != bidauth.DemoMaxInteger || state.Auctions["friday-auction"].Bids["safe-bid"].Amount != bidauth.DemoMaxInteger {
			t.Fatalf("safe maximum did not commit exactly: ok=%v height=%d batch=%+v", ok, height, batch)
		}
	})

	t.Run("maximum plus one fails every ABCI ingress without mutation", func(t *testing.T) {
		application, store := newAuthenticatedTestApp(t, filepath.Join(t.TempDir(), "state.wal"))
		defer store.Close()
		unsafeSum := authenticatedCommand(t, policy, 0x74, command("unsafe-sum-operation", "unsafe-sum-bid", bidauth.DemoMaxInteger+1, bidauth.DemoMaxInteger, 1), 100, 200)
		unsafeItem := authenticatedCommand(t, policy, 0x75, command("unsafe-item-operation", "unsafe-item-bid", bidauth.DemoMaxInteger+1, bidauth.DemoMaxInteger+1), 100, 200)

		beforeStateHash, err := auction.CanonicalHash(application.committed, policy)
		if err != nil {
			t.Fatal(err)
		}
		beforeAppHash, beforeHeight, beforeHasCommitted, beforeGeneration := application.committedHash, application.committedHeight, application.hasCommitted, application.generation
		assertUnchanged := func(stage string) {
			t.Helper()
			afterStateHash, hashErr := auction.CanonicalHash(application.committed, policy)
			if hashErr != nil {
				t.Fatal(hashErr)
			}
			if afterStateHash != beforeStateHash || application.committedHash != beforeAppHash || application.committedHeight != beforeHeight || application.hasCommitted != beforeHasCommitted || application.generation != beforeGeneration || application.pending != nil || len(store.CommittedBatches()) != 0 {
				t.Fatalf("%s mutated committed state/hash, pending state, or outbox", stage)
			}
			if _, _, recoveredHash, recoveredHeight, ok := store.Recovered(); ok || recoveredHeight != 0 || recoveredHash != beforeAppHash {
				t.Fatalf("%s mutated durable recovery state: ok=%v height=%d hash=%x", stage, ok, recoveredHeight, recoveredHash)
			}
		}

		for name, raw := range map[string][]byte{"sum": unsafeSum, "item": unsafeItem} {
			response, checkErr := application.CheckTx(context.Background(), &abci.CheckTxRequest{Tx: raw})
			if checkErr != nil || response.Code == abci.CodeTypeOK {
				t.Fatalf("%s maximum-plus-one CheckTx was not refused: response=%+v err=%v", name, response, checkErr)
			}
			assertUnchanged(name + " CheckTx")
		}

		prepared, err := application.PrepareProposal(context.Background(), prepareRequest(1, 100, 38304, unsafeSum, unsafeItem))
		if err != nil || len(prepared.Txs) != 0 {
			t.Fatalf("maximum-plus-one PrepareProposal retained a transaction: response=%+v err=%v", prepared, err)
		}
		assertUnchanged("PrepareProposal")

		for name, raw := range map[string][]byte{"sum": unsafeSum, "item": unsafeItem} {
			processed, processErr := application.ProcessProposal(context.Background(), processRequest(1, 100, raw))
			if processErr != nil || processed.Status != abci.PROCESS_PROPOSAL_STATUS_REJECT {
				t.Fatalf("%s maximum-plus-one ProcessProposal was not refused: response=%+v err=%v", name, processed, processErr)
			}
			assertUnchanged(name + " ProcessProposal")

			if finalized, finalizeErr := application.FinalizeBlock(context.Background(), finalizeRequest(1, 100, raw)); finalizeErr == nil || finalized != nil {
				t.Fatalf("%s maximum-plus-one FinalizeBlock was not refused: response=%+v err=%v", name, finalized, finalizeErr)
			}
			assertUnchanged(name + " FinalizeBlock")
		}
	})
}

func TestAuthenticatedAutomaticCloseStagesThenCommitsAndRecoversExactlyOnce(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.wal")
	application, store := newAuthenticatedTestApp(t, path)
	policy := testPolicy()
	first := authenticatedBid(t, policy, 0x11, "auctions.bid-lock:friday-auction:bid-one", "bid-one", 100, 100, 200)
	finalizeAndCommit(t, application, 1, 100, first)

	beforeHash := application.committedHash
	prepared, err := application.PrepareProposal(context.Background(), prepareRequest(2, 1000, 38304))
	if err != nil || len(prepared.Txs) != 0 {
		t.Fatalf("empty PrepareProposal: %+v %v", prepared, err)
	}
	processed, err := application.ProcessProposal(context.Background(), processRequest(2, 1000))
	if err != nil || processed.Status != abci.PROCESS_PROPOSAL_STATUS_ACCEPT {
		t.Fatalf("empty ProcessProposal: %+v %v", processed, err)
	}
	if application.pending != nil || application.committedHash != beforeHash || application.committed.Auctions["friday-auction"].Status != auction.AuctionOpen || len(store.CommittedBatches()) != 1 {
		t.Fatal("Prepare/Process mutated staged, committed, or durable state")
	}

	finalized, err := application.FinalizeBlock(context.Background(), finalizeRequest(2, 1000))
	if err != nil {
		t.Fatal(err)
	}
	if application.pending == nil || application.committedHash != beforeHash || application.committed.Auctions["friday-auction"].Status != auction.AuctionOpen || len(store.CommittedBatches()) != 1 {
		t.Fatal("Finalize did not stage exclusively")
	}
	pendingBytes, err := application.pending.batch.CanonicalBytes()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := application.Commit(context.Background(), &abci.CommitRequest{}); err != nil {
		t.Fatal(err)
	}
	state, batch, recoveredHash, height, ok := store.Recovered()
	if !ok || height != 2 || recoveredHash != application.committedHash || !bytes.Equal(finalized.AppHash, recoveredHash[:]) || state.Auctions["friday-auction"].Status != auction.AuctionClosed || state.Auctions["friday-auction"].ClosedSeconds != 1000 {
		t.Fatalf("committed close mismatch: ok=%v height=%d state=%+v", ok, height, state.Auctions["friday-auction"])
	}
	if len(batch.Bids) != 0 || len(batch.Closures) != 1 {
		t.Fatalf("V2 closure batch mismatch: %+v", batch)
	}
	closure := batch.Closures[0]
	if closure.AuthNetworkID != authProfile().NetworkHex() || closure.ChainID != authProfile().ChainID || closure.AuctionID != "friday-auction" || closure.Height != 2 || closure.PBTSSeconds != 1000 || closure.EffectiveEnd != 1000 || closure.AppHash != fmt.Sprintf("%x", recoveredHash) || closure.CloseOutcome != auction.OutcomeWinner || closure.WinnerBidID != "bid-one" || closure.WinnerActorID != strings.Repeat("11", 32) || closure.WinnerOperationID != "auctions.bid-lock:friday-auction:bid-one" || closure.Amount != 100 {
		t.Fatalf("V2 closure fields mismatch: %+v", closure)
	}
	recoveredBytes, err := batch.CanonicalBytes()
	if err != nil || !bytes.Equal(pendingBytes, recoveredBytes) {
		t.Fatal("WAL did not recover exact staged outbox")
	}

	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	genesisHash, err := auction.CanonicalHash(authGenesis(), policy)
	if err != nil {
		t.Fatal(err)
	}
	reopened, err := OpenDurableStore(path, policy, genesisHash)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	restarted, err := NewAuthenticatedApplication(policy, AuthenticatedConfig{Profile: authProfile(), Verifier: fixtureVerifier{}, GenesisAppState: []byte(`{"auth_profile":"DEMO_AUTH_V1"}`)}, authGenesis(), reopened)
	if err != nil {
		t.Fatal(err)
	}
	finalizeAndCommit(t, restarted, 3, 1001)
	_, nextBatch, nextHash, nextHeight, ok := reopened.Recovered()
	if !ok || nextHeight != 3 || nextHash != restarted.committedHash || len(nextBatch.Closures) != 0 || restarted.committed.Auctions["friday-auction"].ClosedSeconds != 1000 {
		t.Fatal("restart emitted a duplicate automatic closure")
	}
}

func TestAuthenticatedAutomaticCloseCrashBeforeCommitReplaysIdentically(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.wal")
	firstApp, store := newAuthenticatedTestApp(t, path)
	policy := testPolicy()
	bid := authenticatedBid(t, policy, 0x21, "operation", "bid", 100, 100, 200)
	finalizeAndCommit(t, firstApp, 1, 100, bid)
	firstFinalized, err := firstApp.FinalizeBlock(context.Background(), finalizeRequest(2, 1000))
	if err != nil {
		t.Fatal(err)
	}
	if len(store.CommittedBatches()) != 1 {
		t.Fatal("uncommitted close reached WAL")
	}
	replayed, err := NewAuthenticatedApplication(policy, AuthenticatedConfig{Profile: authProfile(), Verifier: fixtureVerifier{}, GenesisAppState: []byte(`{"auth_profile":"DEMO_AUTH_V1"}`)}, authGenesis(), store)
	if err != nil {
		t.Fatal(err)
	}
	secondFinalized, err := replayed.FinalizeBlock(context.Background(), finalizeRequest(2, 1000))
	if err != nil {
		t.Fatal(err)
	}
	firstBatch, _ := firstApp.pending.batch.CanonicalBytes()
	secondBatch, _ := replayed.pending.batch.CanonicalBytes()
	if !bytes.Equal(firstFinalized.AppHash, secondFinalized.AppHash) || !bytes.Equal(firstBatch, secondBatch) {
		t.Fatal("pre-Commit replay changed state hash or closure outbox")
	}
	if _, err := replayed.Commit(context.Background(), &abci.CommitRequest{}); err != nil {
		t.Fatal(err)
	}
	store.Close()
}

func TestAuthenticatedAutomaticClosePrecedesDeadlineBidAndHonorsPriorExtension(t *testing.T) {
	policy := testPolicy()
	t.Run("exact deadline bid sees closed state", func(t *testing.T) {
		application, store := newAuthenticatedTestApp(t, filepath.Join(t.TempDir(), "state.wal"))
		defer store.Close()
		first := authenticatedBid(t, policy, 0x41, "first-operation", "first-bid", 100, 100, 200)
		late := authenticatedBid(t, policy, 0x42, "late-operation", "late-bid", 110, 1000, 1100)
		finalizeAndCommit(t, application, 1, 100, first)
		if response, err := application.ProcessProposal(context.Background(), processRequest(2, 1000, late)); err != nil || response.Status != abci.PROCESS_PROPOSAL_STATUS_REJECT {
			t.Fatalf("exact-deadline response=%+v err=%v", response, err)
		}
		if _, err := application.FinalizeBlock(context.Background(), finalizeRequest(2, 1000, late)); err == nil || application.pending != nil {
			t.Fatal("exact-deadline Bid staged after automatic close")
		}
		finalizeAndCommit(t, application, 2, 1000)
		if application.committed.Auctions["friday-auction"].Status != auction.AuctionClosed {
			t.Fatal("empty exact-deadline block did not close")
		}
	})
	t.Run("deadline minus one leader extends first", func(t *testing.T) {
		application, store := newAuthenticatedTestApp(t, filepath.Join(t.TempDir(), "state.wal"))
		defer store.Close()
		first := authenticatedBid(t, policy, 0x51, "first-operation", "first-bid", 100, 100, 200)
		extended := authenticatedBid(t, policy, 0x52, "extended-operation", "extended-bid", 110, 999, 1099)
		finalizeAndCommit(t, application, 1, 100, first)
		finalizeAndCommit(t, application, 2, 999, extended)
		if got := application.committed.Auctions["friday-auction"].EffectiveEnd; got != 1299 {
			t.Fatalf("effective end = %d, want 1299", got)
		}
		finalizeAndCommit(t, application, 3, 1000)
		if application.committed.Auctions["friday-auction"].Status != auction.AuctionOpen {
			t.Fatal("extended auction closed at original deadline")
		}
		finalizeAndCommit(t, application, 4, 1299)
		if application.committed.Auctions["friday-auction"].Status != auction.AuctionClosed {
			t.Fatal("extended auction did not close at effective deadline")
		}
	})
}

func TestAuthenticatedIngressRejectsBitTamperingAcrossSignedTuple(t *testing.T) {
	application, store := newAuthenticatedTestApp(t, filepath.Join(t.TempDir(), "state.wal"))
	defer store.Close()
	raw := authenticatedBid(t, testPolicy(), 0x39, "operation", "bid", 100, 100, 200)
	offsets := map[string]int{"pubkey": 5, "created_at": 44, "kind": 46, "protocol": bytes.Index(raw, []byte(bidauth.DemoProtocol)), "version": bytes.Index(raw, []byte{0, 0, 0, 1, '1'}) + 4, "environment": bytes.Index(raw, []byte(authProfile().NetworkHex())), "valid_until": bytes.Index(raw, []byte("200")), "content": bytes.Index(raw, []byte("operation")), "id": len(raw) - 96, "signature": len(raw) - 64}
	for name, offset := range offsets {
		t.Run(name, func(t *testing.T) {
			if offset < 0 {
				t.Fatal("fixture offset missing")
			}
			mutated := append([]byte(nil), raw...)
			mutated[offset] ^= 1
			response, _ := application.CheckTx(context.Background(), &abci.CheckTxRequest{Tx: mutated})
			if response.Code == 0 {
				t.Fatal("signed-field tampering admitted")
			}
		})
	}
}

func TestAuthenticatedPreparePermutationDeterminism(t *testing.T) {
	policy := testPolicy()
	a := authenticatedBid(t, policy, 0x41, "op-a", "bid-a", 100, 100, 200)
	b := authenticatedBid(t, policy, 0x42, "op-b", "bid-b", 110, 100, 200)
	orders := [][][]byte{{a, b}, {b, a}, {a, b}, {b, a}}
	var selectedHash [32]byte
	var appHash [32]byte
	for index, order := range orders {
		application, store := newAuthenticatedTestApp(t, filepath.Join(t.TempDir(), "state.wal"))
		prepared, err := application.PrepareProposal(context.Background(), prepareRequest(1, 100, 38304, order...))
		if err != nil {
			t.Fatal(err)
		}
		sum := sha256.Sum256(bytesJoin(prepared.Txs))
		if index > 0 && sum != selectedHash {
			t.Fatalf("permutation %d selected different bytes", index)
		}
		selectedHash = sum
		finalizeAndCommit(t, application, 1, 100, prepared.Txs...)
		if index > 0 && application.committedHash != appHash {
			t.Fatalf("permutation %d committed different app hash", index)
		}
		appHash = application.committedHash
		store.Close()
	}
}

func TestAuthenticatedReplayOwnershipAndProposalDuplicateRules(t *testing.T) {
	policy := testPolicy()
	application, store := newAuthenticatedTestApp(t, filepath.Join(t.TempDir(), "state.wal"))
	defer store.Close()
	original := authenticatedBid(t, policy, 0x61, "shared-operation", "bid-original", 100, 100, 200)
	if response, _ := application.ProcessProposal(context.Background(), processRequest(1, 100, original, original)); response.Status != abci.PROCESS_PROPOSAL_STATUS_REJECT {
		t.Fatal("duplicate event/operation in one proposal accepted")
	}
	finalizeAndCommit(t, application, 1, 100, original)
	if response, _ := application.ProcessProposal(context.Background(), processRequest(2, 101, original)); response.Status != abci.PROCESS_PROPOSAL_STATUS_REJECT {
		t.Fatal("committed replay accepted in proposal")
	}
	signed, err := bidauth.DecodeWire(original, authProfile())
	if err != nil {
		t.Fatal(err)
	}
	signed.Signature[1] ^= 1
	alternative, err := bidauth.EncodeWire(signed, authProfile())
	if err != nil {
		t.Fatal(err)
	}
	if response, _ := application.ProcessProposal(context.Background(), processRequest(2, 101, alternative)); response.Status != abci.PROCESS_PROPOSAL_STATUS_REJECT {
		t.Fatal("alternative accepted signature over committed event ID bypassed replay")
	}
	changed := authenticatedBid(t, policy, 0x61, "shared-operation", "bid-changed", 110, 101, 201)
	if response, _ := application.ProcessProposal(context.Background(), processRequest(2, 101, changed)); response.Status != abci.PROCESS_PROPOSAL_STATUS_REJECT {
		t.Fatal("changed command under committed operation accepted")
	}
	takeover := authenticatedBid(t, policy, 0x62, "shared-operation", "bid-other", 110, 101, 201)
	if response, _ := application.ProcessProposal(context.Background(), processRequest(2, 101, takeover)); response.Status != abci.PROCESS_PROPOSAL_STATUS_REJECT {
		t.Fatal("other actor operation takeover accepted")
	}
}

func TestMalformedCandidatesConsumeAuthenticatedFrontierBudget(t *testing.T) {
	application, store := newAuthenticatedTestApp(t, filepath.Join(t.TempDir(), "state.wal"))
	defer store.Close()
	txs := make([][]byte, 33)
	for index := range txs {
		txs[index] = make([]byte, bidauth.DemoMaxRawBytes)
		txs[index][0] = byte(index)
	}
	response, metrics, err := application.prepareAuthenticated(prepareRequest(1, 100, 38304, txs...))
	if err != nil {
		t.Fatal(err)
	}
	if metrics.Examined != 32 || metrics.RawBytes != 76512 || len(response.Txs) != 0 {
		t.Fatalf("malformed work accounting = %+v txs=%d", metrics, len(response.Txs))
	}
}

func TestAuthenticatedSelectedCountExactAndOneOver(t *testing.T) {
	application, store := newAuthenticatedTestApp(t, filepath.Join(t.TempDir(), "state.wal"))
	defer store.Close()
	raw := authenticatedBid(t, testPolicy(), 0x71, "operation", "bid", 100, 100, 200)
	exact := make([][]byte, 16)
	for index := range exact {
		exact[index] = raw
	}
	if _, transactions, metrics, err := application.decodeAuthenticatedProposal(exact, 100); err != nil || len(transactions) != 16 || metrics.Examined != 16 {
		t.Fatalf("exact selected count rejected: tx=%d metrics=%+v err=%v", len(transactions), metrics, err)
	}
	oneOver := append(exact, raw)
	if _, _, metrics, err := application.decodeAuthenticatedProposal(oneOver, 100); err == nil || metrics.Examined != 0 {
		t.Fatalf("one-over selected count not rejected before work: %+v %v", metrics, err)
	}
}
func bytesJoin(values [][]byte) []byte {
	var result []byte
	for _, value := range values {
		result = append(result, value...)
	}
	return result
}
