package poc

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/btcsuite/btcd/btcec/v2"
	"github.com/btcsuite/btcd/btcec/v2/schnorr"
)

func TestStateViewCarriesExactCanonicalGoBytes(t *testing.T) {
	t.Parallel()
	seed := make([]byte, ed25519.SeedSize)
	committee := testPrivateKey(t)
	state, err := NewState("canonical-view", ed25519.NewKeyFromSeed(seed).Public().(ed25519.PublicKey), hex.EncodeToString(committee.PubKey().SerializeCompressed()))
	if err != nil {
		t.Fatal(err)
	}
	state.Operations["10"] = true
	state.Operations["2"] = true
	expected, err := json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}
	view, err := state.View("")
	if err != nil {
		t.Fatal(err)
	}
	actual, err := base64.StdEncoding.DecodeString(view.CanonicalState)
	if err != nil {
		t.Fatal(err)
	}
	if string(actual) != string(expected) {
		t.Fatalf("canonical state bytes changed: got %q want %q", actual, expected)
	}
	if !strings.Contains(string(actual), `"operations":{"10":true,"2":true}`) {
		t.Fatalf("Go map-key order was not preserved in canonical bytes: %s", actual)
	}
	hash, err := state.CanonicalHash()
	if err != nil {
		t.Fatal(err)
	}
	if view.AppHash != hex.EncodeToString(hash[:]) {
		t.Fatalf("view app hash = %s, want %x", view.AppHash, hash)
	}
}

func TestPaymentVerticalSlice(t *testing.T) {
	t.Parallel()

	seed := make([]byte, ed25519.SeedSize)
	for index := range seed {
		seed[index] = byte(index + 1)
	}
	committee := testPrivateKey(t)
	state, err := NewState("test-payment-vertical-slice", ed25519.NewKeyFromSeed(seed).Public().(ed25519.PublicKey), hex.EncodeToString(committee.PubKey().SerializeCompressed()))
	if err != nil {
		t.Fatal(err)
	}
	policy := DefaultPolicy()
	sellerKey := testPrivateKey(t)
	bidderAKey := testPrivateKey(t)
	bidderBKey := testPrivateKey(t)
	seller := actorForKey(sellerKey)
	bidderA := actorForKey(bidderAKey)
	bidderB := actorForKey(bidderBKey)

	apply := func(tx Transaction, at int64) {
		t.Helper()
		state, err = ApplyTransaction(state, tx, at, policy, seed)
		if err != nil {
			t.Fatalf("apply %s at %d: %v", tx.Type, at, err)
		}
	}
	apply(Transaction{Version: TxVersion, Type: "faucet", Actor: bidderA}, 999)
	apply(Transaction{Version: TxVersion, Type: "faucet", Actor: bidderB}, 999)

	create := testEvent(t, sellerKey, 1_000, KindCreate, createContent{
		AuctionID: "auction-1", Title: "Test item", Duration: 3, StartingBid: 100, Reserve: 150,
	})
	apply(Transaction{Version: TxVersion, Type: "event", Event: &create}, 1_000)
	markLegacyAuction(&state, "auction-1")

	noteA := onlySpendableNote(t, state, bidderA)
	bidA := testEvent(t, bidderAKey, 1_001, KindBid, bidContent{AuctionID: "auction-1", Amount: 120, Inputs: []string{noteA.ID}})
	apply(Transaction{Version: TxVersion, Type: "event", Event: &bidA}, 1_001)

	invalid := testEvent(t, bidderAKey, 1_001, KindBid, bidContent{AuctionID: "auction-1", Amount: 220, Inputs: []string{noteA.ID}})
	if _, err := ApplyTransaction(state, Transaction{Version: TxVersion, Type: "event", Event: &invalid}, 1_001, policy, seed); err == nil || !strings.Contains(err.Error(), "spent") {
		t.Fatalf("spent-note bid error = %v, want spent-input rejection", err)
	}

	noteB := onlySpendableNote(t, state, bidderB)
	bidB := testEvent(t, bidderBKey, 1_002, KindBid, bidContent{AuctionID: "auction-1", Amount: 220, Inputs: []string{noteB.ID}})
	apply(Transaction{Version: TxVersion, Type: "event", Event: &bidB}, 1_002)
	apply(Transaction{Version: TxVersion, Type: "close", AuctionID: "auction-1"}, 1_182)

	auction := state.Auctions["auction-1"]
	if auction.Winner != bidderB || auction.PaymentNoteID == "" || state.Locks[bidB.ID].Status != "paid" {
		t.Fatalf("winner settlement = %+v lock=%+v", auction, state.Locks[bidB.ID])
	}
	payment := state.Notes[auction.PaymentNoteID]
	if payment.Owner != seller || payment.Amount != 220 {
		t.Fatalf("seller payment = %+v", payment)
	}
	if err := verifyNote(state, payment); err != nil {
		t.Fatalf("seller payment signature: %v", err)
	}

	refund := testEvent(t, bidderAKey, 1_183, KindRefund, refundContent{BidID: bidA.ID})
	apply(Transaction{Version: TxVersion, Type: "event", Event: &refund}, 1_183)
	refundNote := state.Notes[state.Locks[bidA.ID].OutputNoteID]
	if refundNote.Owner != bidderA || refundNote.Amount != 120 || state.Locks[bidA.ID].Status != "refunded" {
		t.Fatalf("loser refund = %+v lock=%+v", refundNote, state.Locks[bidA.ID])
	}
	if err := verifyNote(state, refundNote); err != nil {
		t.Fatalf("loser refund signature: %v", err)
	}

	assertWallet := func(actor string, spendable, locked, refundable int64) {
		t.Helper()
		view, err := state.View(actor)
		if err != nil {
			t.Fatal(err)
		}
		if view.Wallet.Spendable != spendable || view.Wallet.Locked != locked || view.Wallet.Refundable != refundable {
			t.Fatalf("wallet %s = %+v, want spendable=%d locked=%d refundable=%d", actor[:8], view.Wallet, spendable, locked, refundable)
		}
	}
	assertWallet(seller, 220, 0, 0)
	assertWallet(bidderA, 10_000, 0, 0)
	assertWallet(bidderB, 9_780, 0, 0)
}

func TestRejectsTamperedNostrEventAndMintNote(t *testing.T) {
	t.Parallel()

	key := testPrivateKey(t)
	event := testEvent(t, key, 1_000, KindCreate, createContent{
		AuctionID: "auction-1", Title: "Test item", Duration: 3, StartingBid: 100,
	})
	event.Content = `{"auction_id":"auction-2"}`
	if _, err := VerifyNostrEvent(event); err == nil {
		t.Fatal("tampered Nostr content was accepted")
	}

	seed := make([]byte, ed25519.SeedSize)
	seed[0] = 7
	committee := testPrivateKey(t)
	state, err := NewState("test-note-signature", ed25519.NewKeyFromSeed(seed).Public().(ed25519.PublicKey), hex.EncodeToString(committee.PubKey().SerializeCompressed()))
	if err != nil {
		t.Fatal(err)
	}
	actor := actorForKey(key)
	state, err = ApplyTransaction(state, Transaction{Version: TxVersion, Type: "faucet", Actor: actor}, 1_000, DefaultPolicy(), seed)
	if err != nil {
		t.Fatal(err)
	}
	note := onlySpendableNote(t, state, actor)
	note.Amount++
	if err := verifyNote(state, note); err == nil {
		t.Fatal("tampered mint note was accepted")
	}
}

func TestCashuLockReceiptBindsBid(t *testing.T) {
	t.Parallel()

	seed := make([]byte, ed25519.SeedSize)
	seed[0] = 11
	committee := testPrivateKey(t)
	state, err := NewState("test-cashu-lock", ed25519.NewKeyFromSeed(seed).Public().(ed25519.PublicKey), hex.EncodeToString(committee.PubKey().SerializeCompressed()))
	if err != nil {
		t.Fatal(err)
	}
	seller := testPrivateKey(t)
	bidder := testPrivateKey(t)
	create := testEvent(t, seller, 1_000, KindCreate, createContent{AuctionID: "cashu-auction", Title: "Cashu item", Duration: 3, StartingBid: 100})
	state, err = ApplyTransaction(state, Transaction{Version: TxVersion, Type: "event", Event: &create}, 1_000, DefaultPolicy(), seed)
	if err != nil {
		t.Fatal(err)
	}
	markLegacyAuction(&state, "cashu-auction")
	refund := testPrivateKey(t)
	receipt := CashuLockReceipt{
		Schema: "PlebeianAuctionsPOCCashuLockV1", MintURL: CashuMintURL, AuctionID: "cashu-auction",
		Bidder: actorForKey(bidder), Amount: 120, OperationID: "cashu-lock-operation-1",
		TokenSHA256: strings.Repeat("a", 64), CommitteePublicKey: hex.EncodeToString(committee.PubKey().SerializeCompressed()),
		RefundPublicKey: hex.EncodeToString(refund.PubKey().SerializeCompressed()), Locktime: 1_003,
	}
	digest := cashuReceiptDigest(receipt)
	signature, err := schnorr.Sign(committee, digest[:])
	if err != nil {
		t.Fatal(err)
	}
	receipt.Signature = hex.EncodeToString(signature.Serialize())

	invalid := receipt
	invalid.TokenSHA256 = strings.Repeat("b", 64)
	invalidEvent := testEvent(t, bidder, 1_001, KindBid, bidContent{AuctionID: "cashu-auction", Amount: 120, CashuLock: &invalid})
	if _, err := ApplyTransaction(state, Transaction{Version: TxVersion, Type: "event", Event: &invalidEvent}, 1_001, DefaultPolicy(), seed); err == nil || !strings.Contains(err.Error(), "signature") {
		t.Fatalf("mutated Cashu receipt error = %v, want signature rejection", err)
	}

	validEvent := testEvent(t, bidder, 1_001, KindBid, bidContent{AuctionID: "cashu-auction", Amount: 120, CashuLock: &receipt})
	state, err = ApplyTransaction(state, Transaction{Version: TxVersion, Type: "event", Event: &validEvent}, 1_001, DefaultPolicy(), seed)
	if err != nil {
		t.Fatalf("valid Cashu bid: %v", err)
	}
	bid := state.Bids[validEvent.ID]
	if bid.CashuTokenSHA256 != receipt.TokenSHA256 || bid.CashuLockOperation != receipt.OperationID || len(bid.InputNoteIDs) != 0 {
		t.Fatalf("committed Cashu bid = %+v", bid)
	}
	if _, ok := state.CashuLocks[receipt.TokenSHA256]; !ok {
		t.Fatal("consensus state did not retain the verified public Cashu receipt")
	}

	secondCreate := testEvent(t, seller, 1_002, KindCreate, createContent{AuctionID: "cashu-auction-2", Title: "Second item", Duration: 3, StartingBid: 100})
	state, err = ApplyTransaction(state, Transaction{Version: TxVersion, Type: "event", Event: &secondCreate}, 1_002, DefaultPolicy(), seed)
	if err != nil {
		t.Fatal(err)
	}
	markLegacyAuction(&state, "cashu-auction-2")
	replayed := receipt
	replayed.AuctionID = "cashu-auction-2"
	replayed.OperationID = "cashu-lock-operation-2"
	replayed.Locktime = 1_005
	replayedDigest := cashuReceiptDigest(replayed)
	replayedSignature, err := schnorr.Sign(committee, replayedDigest[:])
	if err != nil {
		t.Fatal(err)
	}
	replayed.Signature = hex.EncodeToString(replayedSignature.Serialize())
	replayEvent := testEvent(t, bidder, 1_003, KindBid, bidContent{AuctionID: "cashu-auction-2", Amount: 120, CashuLock: &replayed})
	if _, err := ApplyTransaction(state, Transaction{Version: TxVersion, Type: "event", Event: &replayEvent}, 1_003, DefaultPolicy(), seed); err == nil || !strings.Contains(err.Error(), "already committed") {
		t.Fatalf("cross-auction Cashu proof replay error = %v, want global token-digest rejection", err)
	}
}

func TestFridayCustodyReservationsUseCommittedTimeAndCreateEntitlements(t *testing.T) {
	t.Parallel()
	seed := make([]byte, ed25519.SeedSize)
	seed[0] = 23
	committee := testPrivateKey(t)
	state, err := NewState("friday-reservations", ed25519.NewKeyFromSeed(seed).Public().(ed25519.PublicKey), hex.EncodeToString(committee.PubKey().SerializeCompressed()))
	if err != nil {
		t.Fatal(err)
	}
	policy := DefaultPolicy()
	seller := testPrivateKey(t)
	bidderB := testPrivateKey(t)
	bidderC := testPrivateKey(t)
	bidderD := testPrivateKey(t)

	apply := func(event SignedEvent, at int64) error {
		candidate, applyErr := ApplyTransaction(state, Transaction{Version: TxVersion, Type: "event", Event: &event}, at, policy, seed)
		if applyErr == nil {
			state = candidate
		}
		return applyErr
	}
	created := testEvent(t, seller, 900, KindCreate, createContent{
		AuctionID: "friday", Title: "Friday item", Description: "A bounded fake-money lot",
		ImageURL: "https://example.invalid/item.png", Duration: 600, StartingBid: 1_000, Reserve: 2_000,
	})
	if err := apply(created, 1_000); err != nil {
		t.Fatal(err)
	}
	auction := state.Auctions["friday"]
	if auction.CreatedAt != 1_000 || auction.OriginalEndTime != 1_600 || auction.EndTime != 1_600 || auction.MinIncrement != 100 {
		t.Fatalf("auction committed timing/policy = %+v", auction)
	}

	place := func(key *btcec.PrivateKey, eventTime, blockTime, amount int64, id, replaces string) SignedEvent {
		receipt := testReservationReceipt(t, committee, "friday", actorForKey(key), amount, id, replaces, blockTime+policy.ReceiptTTLSeconds)
		event := testEvent(t, key, eventTime, KindBid, bidContent{AuctionID: "friday", Amount: amount, Reservation: &receipt})
		if err := apply(event, blockTime); err != nil {
			t.Fatalf("place %s at %d: %v", id, blockTime, err)
		}
		return event
	}

	b1 := place(bidderB, 1_200, 1_200, 1_000, "reserve-b-1000", "")
	c1 := place(bidderC, 1_300, 1_300, 1_500, "reserve-c-1500", "")
	if state.CustodyReservations["reserve-b-1000"].Status != "release_entitled" || state.Locks[b1.ID].Status != "refundable" {
		t.Fatal("outbid B reservation was not promptly release-entitled")
	}
	place(bidderB, 1_450, 1_450, 2_000, "reserve-b-2000", "")
	if state.Auctions["friday"].EndTime != 1_630 {
		t.Fatalf("first late extension end = %d, want 1630", state.Auctions["friday"].EndTime)
	}
	if state.CustodyReservations["reserve-c-1500"].Status != "release_entitled" || state.Locks[c1.ID].Status != "refundable" {
		t.Fatal("outbid C reservation was not release-entitled")
	}
	d1 := place(bidderD, 1_600, 1_600, 2_500, "reserve-d-2500", "")
	if state.Auctions["friday"].EndTime != 1_780 {
		t.Fatalf("second late extension end = %d, want 1780", state.Auctions["friday"].EndTime)
	}
	state, err = ApplyTransaction(state, Transaction{Version: TxVersion, Type: "close", AuctionID: "friday"}, 1_780, policy, seed)
	if err != nil {
		t.Fatal(err)
	}
	closed := state.Auctions["friday"]
	if closed.Winner != actorForKey(bidderD) || state.CustodyReservations["reserve-d-2500"].Status != "payout_entitled" || state.Locks[d1.ID].Status != "winner_selected" {
		t.Fatalf("close disposition auction=%+v reservation=%+v", closed, state.CustodyReservations["reserve-d-2500"])
	}
}

func TestFridayDeadlineIncrementReplacementAndExtensionCap(t *testing.T) {
	t.Parallel()
	seed := make([]byte, ed25519.SeedSize)
	seed[0] = 29
	committee := testPrivateKey(t)
	state, err := NewState("friday-deadline", ed25519.NewKeyFromSeed(seed).Public().(ed25519.PublicKey), hex.EncodeToString(committee.PubKey().SerializeCompressed()))
	if err != nil {
		t.Fatal(err)
	}
	policy := DefaultPolicy()
	seller := testPrivateKey(t)
	create := testEvent(t, seller, 1_000, KindCreate, createContent{AuctionID: "cap", Title: "Cap", Duration: 300, StartingBid: 1_000})
	state, err = ApplyTransaction(state, Transaction{Version: TxVersion, Type: "event", Event: &create}, 1_000, policy, seed)
	if err != nil {
		t.Fatal(err)
	}

	var prior string
	for index := 0; index < 12 && state.Auctions["cap"].EndTime < 3_100; index++ {
		key := testPrivateKey(t)
		at := state.Auctions["cap"].EndTime - 1
		id := fmt.Sprintf("cap-reservation-%02d", index)
		receipt := testReservationReceipt(t, committee, "cap", actorForKey(key), int64(1_000+index*100), id, "", at+policy.ReceiptTTLSeconds)
		event := testEvent(t, key, at, KindBid, bidContent{AuctionID: "cap", Amount: int64(1_000 + index*100), Reservation: &receipt})
		state, err = ApplyTransaction(state, Transaction{Version: TxVersion, Type: "event", Event: &event}, at, policy, seed)
		if err != nil {
			t.Fatalf("cap bid %d: %v", index, err)
		}
		prior = id
	}
	if state.Auctions["cap"].EndTime != 3_100 {
		t.Fatalf("extension cap end=%d want=3100", state.Auctions["cap"].EndTime)
	}

	leader := state.Bids[state.Auctions["cap"].LeaderBidID]
	tooSmallKey := testPrivateKey(t)
	tooSmallReceipt := testReservationReceipt(t, committee, "cap", actorForKey(tooSmallKey), leader.Amount+99, "too-small", "", 3_100+policy.ReceiptTTLSeconds)
	tooSmall := testEvent(t, tooSmallKey, 3_099, KindBid, bidContent{AuctionID: "cap", Amount: leader.Amount + 99, Reservation: &tooSmallReceipt})
	if _, err := ApplyTransaction(state, Transaction{Version: TxVersion, Type: "event", Event: &tooSmall}, 3_099, policy, seed); err == nil || !strings.Contains(err.Error(), "minimum increment") {
		t.Fatalf("small increment error=%v", err)
	}

	deadlineKey := testPrivateKey(t)
	deadlineReceipt := testReservationReceipt(t, committee, "cap", actorForKey(deadlineKey), leader.Amount+100, "at-deadline", "", 3_100+policy.ReceiptTTLSeconds)
	atDeadline := testEvent(t, deadlineKey, 3_099, KindBid, bidContent{AuctionID: "cap", Amount: leader.Amount + 100, Reservation: &deadlineReceipt})
	if _, err := ApplyTransaction(state, Transaction{Version: TxVersion, Type: "event", Event: &atDeadline}, 3_100, policy, seed); err == nil || !strings.Contains(err.Error(), "late") {
		t.Fatalf("deadline bid error=%v", err)
	}
	if prior == "" {
		t.Fatal("cap loop committed no reservation")
	}
	if _, err := ApplyTransaction(state, Transaction{Version: TxVersion, Type: "close", AuctionID: "cap"}, 3_100, policy, seed); err != nil {
		t.Fatalf("close at exact deadline: %v", err)
	}
}

func TestFridayOwnRaiseInvalidBidsAndReservationReplay(t *testing.T) {
	t.Parallel()
	seed := make([]byte, ed25519.SeedSize)
	seed[0] = 31
	committee := testPrivateKey(t)
	state, err := NewState("friday-invalid", ed25519.NewKeyFromSeed(seed).Public().(ed25519.PublicKey), hex.EncodeToString(committee.PubKey().SerializeCompressed()))
	if err != nil {
		t.Fatal(err)
	}
	policy := DefaultPolicy()
	seller := testPrivateKey(t)
	bidder := testPrivateKey(t)
	other := testPrivateKey(t)
	apply := func(event SignedEvent, at int64) error {
		candidate, applyErr := ApplyTransaction(state, Transaction{Version: TxVersion, Type: "event", Event: &event}, at, policy, seed)
		if applyErr == nil {
			state = candidate
		}
		return applyErr
	}
	for _, id := range []string{"raise", "replay"} {
		create := testEvent(t, seller, 1_000, KindCreate, createContent{AuctionID: id, Title: id, Duration: 600, StartingBid: 1_000})
		if err := apply(create, 1_000); err != nil {
			t.Fatal(err)
		}
	}
	legacyFunded := testEvent(t, bidder, 1_050, KindBid, bidContent{AuctionID: "raise", Amount: 1_000, Inputs: []string{"legacy-note"}})
	if err := apply(legacyFunded, 1_050); err == nil || !strings.Contains(err.Error(), "requires a custodial reservation") {
		t.Fatalf("Friday legacy funding error=%v", err)
	}

	sellerReceipt := testReservationReceipt(t, committee, "raise", actorForKey(seller), 1_000, "seller-self", "", 1_400)
	sellerBid := testEvent(t, seller, 1_100, KindBid, bidContent{AuctionID: "raise", Amount: 1_000, Reservation: &sellerReceipt})
	if err := apply(sellerBid, 1_100); err == nil || !strings.Contains(err.Error(), "seller cannot bid") {
		t.Fatalf("seller self-bid error=%v", err)
	}

	firstReceipt := testReservationReceipt(t, committee, "raise", actorForKey(bidder), 1_000, "raise-first", "", 1_401)
	first := testEvent(t, bidder, 1_101, KindBid, bidContent{AuctionID: "raise", Amount: 1_000, Reservation: &firstReceipt})
	if err := apply(first, 1_101); err != nil {
		t.Fatal(err)
	}
	equalReceipt := testReservationReceipt(t, committee, "raise", actorForKey(other), 1_000, "equal", "", 1_402)
	equal := testEvent(t, other, 1_102, KindBid, bidContent{AuctionID: "raise", Amount: 1_000, Reservation: &equalReceipt})
	if err := apply(equal, 1_102); err == nil || !strings.Contains(err.Error(), "minimum increment") {
		t.Fatalf("equal bid error=%v", err)
	}

	wrongReplacement := testReservationReceipt(t, committee, "raise", actorForKey(bidder), 2_000, "raise-wrong", "", 1_403)
	wrongRaise := testEvent(t, bidder, 1_103, KindBid, bidContent{AuctionID: "raise", Amount: 2_000, Reservation: &wrongReplacement})
	if err := apply(wrongRaise, 1_103); err == nil || !strings.Contains(err.Error(), "replacement") {
		t.Fatalf("unbound own raise error=%v", err)
	}

	raiseReceipt := testReservationReceipt(t, committee, "raise", actorForKey(bidder), 2_000, "raise-second", "raise-first", 1_404)
	raise := testEvent(t, bidder, 1_104, KindBid, bidContent{AuctionID: "raise", Amount: 2_000, Reservation: &raiseReceipt})
	if err := apply(raise, 1_104); err != nil {
		t.Fatal(err)
	}
	if state.CustodyReservations["raise-first"].Status != "release_entitled" || state.CustodyReservations["raise-second"].Status != "reserved" {
		t.Fatalf("own raise disposition old=%+v new=%+v", state.CustodyReservations["raise-first"], state.CustodyReservations["raise-second"])
	}

	replayReceipt := testReservationReceipt(t, committee, "replay", actorForKey(other), 1_000, "raise-second", "", 1_405)
	replay := testEvent(t, other, 1_105, KindBid, bidContent{AuctionID: "replay", Amount: 1_000, Reservation: &replayReceipt})
	if err := apply(replay, 1_105); err == nil || !strings.Contains(err.Error(), "already committed") {
		t.Fatalf("cross-auction reservation replay error=%v", err)
	}
}

func TestFridayReserveUnmetAndNoBidCloseWithoutSale(t *testing.T) {
	t.Parallel()
	seed := make([]byte, ed25519.SeedSize)
	seed[0] = 37
	committee := testPrivateKey(t)
	state, err := NewState("friday-no-sale", ed25519.NewKeyFromSeed(seed).Public().(ed25519.PublicKey), hex.EncodeToString(committee.PubKey().SerializeCompressed()))
	if err != nil {
		t.Fatal(err)
	}
	policy := DefaultPolicy()
	seller := testPrivateKey(t)
	bidder := testPrivateKey(t)
	for _, id := range []string{"reserve-unmet", "no-bid"} {
		create := testEvent(t, seller, 2_000, KindCreate, createContent{AuctionID: id, Title: id, Duration: 600, StartingBid: 1_000, Reserve: 5_000})
		state, err = ApplyTransaction(state, Transaction{Version: TxVersion, Type: "event", Event: &create}, 2_000, policy, seed)
		if err != nil {
			t.Fatal(err)
		}
	}
	receipt := testReservationReceipt(t, committee, "reserve-unmet", actorForKey(bidder), 3_000, "below-reserve", "", 2_400)
	bid := testEvent(t, bidder, 2_100, KindBid, bidContent{AuctionID: "reserve-unmet", Amount: 3_000, Reservation: &receipt})
	state, err = ApplyTransaction(state, Transaction{Version: TxVersion, Type: "event", Event: &bid}, 2_100, policy, seed)
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"reserve-unmet", "no-bid"} {
		state, err = ApplyTransaction(state, Transaction{Version: TxVersion, Type: "close", AuctionID: id}, 2_600, policy, seed)
		if err != nil {
			t.Fatalf("close %s: %v", id, err)
		}
		if state.Auctions[id].Winner != "" || state.Auctions[id].Status != "closed" {
			t.Fatalf("%s unexpectedly sold: %+v", id, state.Auctions[id])
		}
	}
	if state.CustodyReservations["below-reserve"].Status != "release_entitled" || state.Locks[bid.ID].Status != "refundable" {
		t.Fatalf("reserve-unmet disposition reservation=%+v lock=%+v", state.CustodyReservations["below-reserve"], state.Locks[bid.ID])
	}
}

func TestFridayOwnRaiseVersusOutbidUsesDeterministicCommitOrder(t *testing.T) {
	t.Parallel()
	seed := make([]byte, ed25519.SeedSize)
	seed[0] = 41
	committee := testPrivateKey(t)
	state, err := NewState("friday-race", ed25519.NewKeyFromSeed(seed).Public().(ed25519.PublicKey), hex.EncodeToString(committee.PubKey().SerializeCompressed()))
	if err != nil {
		t.Fatal(err)
	}
	policy := DefaultPolicy()
	seller, leader, challenger := testPrivateKey(t), testPrivateKey(t), testPrivateKey(t)
	create := testEvent(t, seller, 3_000, KindCreate, createContent{AuctionID: "race", Title: "race", Duration: 600, StartingBid: 1_000})
	state, err = ApplyTransaction(state, Transaction{Version: TxVersion, Type: "event", Event: &create}, 3_000, policy, seed)
	if err != nil {
		t.Fatal(err)
	}
	firstReceipt := testReservationReceipt(t, committee, "race", actorForKey(leader), 1_000, "race-first", "", 3_300)
	first := testEvent(t, leader, 3_001, KindBid, bidContent{AuctionID: "race", Amount: 1_000, Reservation: &firstReceipt})
	state, err = ApplyTransaction(state, Transaction{Version: TxVersion, Type: "event", Event: &first}, 3_001, policy, seed)
	if err != nil {
		t.Fatal(err)
	}

	raiseReceipt := testReservationReceipt(t, committee, "race", actorForKey(leader), 1_500, "race-raise", "race-first", 3_302)
	raise := testEvent(t, leader, 3_002, KindBid, bidContent{AuctionID: "race", Amount: 1_500, Reservation: &raiseReceipt})
	outbidReceipt := testReservationReceipt(t, committee, "race", actorForKey(challenger), 2_000, "race-outbid", "", 3_302)
	outbid := testEvent(t, challenger, 3_002, KindBid, bidContent{AuctionID: "race", Amount: 2_000, Reservation: &outbidReceipt})

	outbidFirst, err := ApplyTransaction(state, Transaction{Version: TxVersion, Type: "event", Event: &outbid}, 3_002, policy, seed)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ApplyTransaction(outbidFirst, Transaction{Version: TxVersion, Type: "event", Event: &raise}, 3_002, policy, seed); err == nil || !(strings.Contains(err.Error(), "replacement") || strings.Contains(err.Error(), "minimum increment")) {
		t.Fatalf("stale raise after outbid error=%v", err)
	}

	raiseFirst, err := ApplyTransaction(state, Transaction{Version: TxVersion, Type: "event", Event: &raise}, 3_002, policy, seed)
	if err != nil {
		t.Fatal(err)
	}
	final, err := ApplyTransaction(raiseFirst, Transaction{Version: TxVersion, Type: "event", Event: &outbid}, 3_002, policy, seed)
	if err != nil {
		t.Fatal(err)
	}
	if final.Auctions["race"].HighBid != 2_000 || final.CustodyReservations["race-raise"].Status != "release_entitled" || final.CustodyReservations["race-outbid"].Status != "reserved" {
		t.Fatalf("raise/outbid deterministic result auction=%+v raise=%+v outbid=%+v", final.Auctions["race"], final.CustodyReservations["race-raise"], final.CustodyReservations["race-outbid"])
	}
}

func TestIntegratedThresholdFundingOwnRaiseOutbidAndGlobalProofExclusion(t *testing.T) {
	t.Parallel()
	seed := make([]byte, ed25519.SeedSize)
	seed[0] = 47
	committee := testEvenPrivateKey(t)
	state, err := NewState("integrated-threshold", ed25519.NewKeyFromSeed(seed).Public().(ed25519.PublicKey), hex.EncodeToString(committee.PubKey().SerializeCompressed()))
	if err != nil {
		t.Fatal(err)
	}
	policy := DefaultPolicy()
	seller := testPrivateKey(t)
	leader := testPrivateKey(t)
	challenger := testPrivateKey(t)
	leaderPayment := testPrivateKey(t)
	challengerPayment := testPrivateKey(t)
	sellerPayment := testPrivateKey(t)
	apply := func(event SignedEvent, at int64) error {
		candidate, applyErr := ApplyTransaction(state, Transaction{Version: TxVersion, Type: "event", Event: &event}, at, policy, seed)
		if applyErr == nil {
			state = candidate
		}
		return applyErr
	}
	missingSellerKey := testEvent(t, seller, 9_999, KindCreate, createContent{
		AuctionID: "threshold-missing-seller-key", Title: "missing", Duration: 600, StartingBid: 1_000,
		FundingMode: FundingModeThresholdSigAll,
	})
	if err := apply(missingSellerKey, 9_999); err == nil || !strings.Contains(err.Error(), "seller Coco payment key") {
		t.Fatalf("threshold auction without seller Coco payment key error=%v", err)
	}
	for _, auctionID := range []string{"integrated-a", "integrated-b"} {
		created := testEvent(t, seller, 10_000, KindCreate, createContent{
			AuctionID: auctionID, Title: auctionID, Duration: 600, StartingBid: 1_000,
			FundingMode:                FundingModeThresholdSigAll,
			SellerCocoPaymentPublicKey: hex.EncodeToString(sellerPayment.PubKey().SerializeCompressed()),
		})
		if err := apply(created, 10_000); err != nil {
			t.Fatal(err)
		}
	}
	proofA := hex.EncodeToString(testPrivateKey(t).PubKey().SerializeCompressed())
	proofB := hex.EncodeToString(testPrivateKey(t).PubKey().SerializeCompressed())
	proofC := hex.EncodeToString(testPrivateKey(t).PubKey().SerializeCompressed())
	proofD := hex.EncodeToString(testPrivateKey(t).PubKey().SerializeCompressed())

	staleReceipt := testIntegratedFundingReceipt(t, committee, leader, leaderPayment, "integrated-a", "", 1_000, 1_000, "funding-a-stale", []string{proofA}, 13_300, 10_000)
	stale := testEvent(t, leader, 10_001, KindBid, bidContent{AuctionID: "integrated-a", Amount: 1_000, IntegratedFunding: &staleReceipt})
	if err := apply(stale, 10_001); err == nil || !strings.Contains(err.Error(), "expired") {
		t.Fatalf("stale funding attestation error=%v", err)
	}

	firstReceipt := testIntegratedFundingReceipt(t, committee, leader, leaderPayment, "integrated-a", "", 1_000, 1_000, "funding-a-1", []string{proofA, proofB}, 13_300, 10_301)
	first := testEvent(t, leader, 10_001, KindBid, bidContent{AuctionID: "integrated-a", Amount: 1_000, IntegratedFunding: &firstReceipt})
	if err := apply(first, 10_001); err != nil {
		t.Fatal(err)
	}

	reusedReceipt := testIntegratedFundingReceipt(t, committee, challenger, challengerPayment, "integrated-b", "", 1_000, 1_000, "funding-b-reuse", []string{proofA}, 13_300, 10_302)
	reused := testEvent(t, challenger, 10_002, KindBid, bidContent{AuctionID: "integrated-b", Amount: 1_000, IntegratedFunding: &reusedReceipt})
	if err := apply(reused, 10_002); err == nil || !strings.Contains(err.Error(), "already allocated") {
		t.Fatalf("cross-auction proof reuse error=%v", err)
	}
	aliasedProofA := "02" + proofA[2:]
	if proofA[:2] == "02" {
		aliasedProofA = "03" + proofA[2:]
	}
	aliasedReceipt := testIntegratedFundingReceipt(t, committee, challenger, challengerPayment, "integrated-b", "", 1_000, 1_000, "funding-b-alias", []string{aliasedProofA}, 13_300, 10_302)
	aliased := testEvent(t, challenger, 10_002, KindBid, bidContent{AuctionID: "integrated-b", Amount: 1_000, IntegratedFunding: &aliasedReceipt})
	if err := apply(aliased, 10_002); err == nil || !strings.Contains(err.Error(), "already allocated") {
		t.Fatalf("cross-auction proof-Y parity alias error=%v", err)
	}
	wrongReplacementReceipt := testIntegratedFundingReceipt(t, committee, leader, leaderPayment, "integrated-a", "", 2_000, 2_000, "funding-a-wrong-replacement", []string{proofA, proofB, proofC}, 13_300, 10_303)
	wrongReplacement := testEvent(t, leader, 10_003, KindBid, bidContent{AuctionID: "integrated-a", Amount: 2_000, ReplacesBidID: first.ID, IntegratedFunding: &wrongReplacementReceipt})
	if err := apply(wrongReplacement, 10_003); err == nil || !strings.Contains(err.Error(), "does not bind") {
		t.Fatalf("replacement-bound receipt error=%v", err)
	}

	raiseReceipt := testIntegratedFundingReceipt(t, committee, leader, leaderPayment, "integrated-a", first.ID, 2_000, 2_000, "funding-a-raise", []string{proofA, proofB, proofC}, 13_300, 10_303)
	raise := testEvent(t, leader, 10_003, KindBid, bidContent{AuctionID: "integrated-a", Amount: 2_000, ReplacesBidID: first.ID, IntegratedFunding: &raiseReceipt})
	if err := apply(raise, 10_003); err != nil {
		t.Fatal(err)
	}
	if state.IntegratedFundings["funding-a-1"].Status != "superseded" || state.IntegratedProofUses[proofA[2:]] != "funding-a-raise" {
		t.Fatalf("own raise did not atomically supersede the full pool: old=%+v uses=%+v", state.IntegratedFundings["funding-a-1"], state.IntegratedProofUses)
	}

	outbidReceipt := testIntegratedFundingReceipt(t, committee, challenger, challengerPayment, "integrated-a", raise.ID, 2_500, 2_500, "funding-a-outbid", []string{proofD}, 13_300, 10_304)
	outbid := testEvent(t, challenger, 10_004, KindBid, bidContent{AuctionID: "integrated-a", Amount: 2_500, ReplacesBidID: raise.ID, IntegratedFunding: &outbidReceipt})
	if err := apply(outbid, 10_004); err != nil {
		t.Fatal(err)
	}
	if state.Bids[outbid.ID].ReplacesBidID != raise.ID || state.IntegratedFundings["funding-a-raise"].Status != "outbid_return_entitled" {
		t.Fatalf("committed displacement was not retained: bid=%+v funding=%+v", state.Bids[outbid.ID], state.IntegratedFundings["funding-a-raise"])
	}
	if displacement := state.IntegratedDisplacements[outbid.ID]; displacement.DisplacedBidID != raise.ID || displacement.ReplacementFundingID != "funding-a-outbid" || displacement.CertifiedEndTime != 10_600 {
		t.Fatalf("deterministic displacement record=%+v", displacement)
	}

	state, err = ApplyTransaction(state, Transaction{Version: TxVersion, Type: "close", AuctionID: "integrated-a"}, 10_600, policy, seed)
	if err != nil {
		t.Fatal(err)
	}
	if state.IntegratedFundings["funding-a-outbid"].Status != "payout_entitled" {
		t.Fatalf("winner funding status=%s", state.IntegratedFundings["funding-a-outbid"].Status)
	}
}

func testIntegratedFundingReceipt(
	t *testing.T,
	committee, actor, bidderPayment *btcec.PrivateKey,
	auctionID, replacesBidID string,
	bidAmount, poolAmount int64,
	operationID string,
	proofStateRefs []string,
	locktime, expiresAt int64,
) IntegratedFundingReceipt {
	t.Helper()
	refs := append([]string(nil), proofStateRefs...)
	sort.Strings(refs)
	refund := testPrivateKey(t)
	receipt := IntegratedFundingReceipt{
		Schema: "PlebeianAuctionsPOCIntegratedFundingV3", AuthNetworkID: "integrated-threshold",
		ChainID: "integrated-threshold", MintURL: CashuMintURL,
		AuctionID: auctionID, Bidder: actorForKey(actor), BidAmount: bidAmount, PoolAmount: poolAmount,
		ReplacesBidID: replacesBidID, FundingOperationID: operationID,
		AttestedAt: expiresAt - DefaultPolicy().ReceiptTTLSeconds, ExpiresAt: expiresAt,
		ProofStateRefs: refs, ActiveKeysetID: "zero-fee-keyset", InputFeePPK: 0,
		Locktime: locktime, BidderPublicKey: hex.EncodeToString(bidderPayment.PubKey().SerializeCompressed()),
		RefundPublicKey:    hex.EncodeToString(refund.PubKey().SerializeCompressed()),
		CommitteePublicKey: hex.EncodeToString(committee.PubKey().SerializeCompressed()),
		CommitteeKeysetID:  "threshold-keyset", CommitteeKeysetVersion: "1",
		DKGRunID: "dkg-run-1", PublicKeyPackageSHA256: strings.Repeat("d", 64),
		SignerRosterDigest:  strings.Repeat("e", 64),
		WinnerPackageDigest: strings.Repeat("a", 64), ReturnPackageDigest: strings.Repeat("b", 64),
		ReturnCashuSigAllDigest: strings.Repeat("c", 64),
		ParticipantPolicyDigest: strings.Repeat("f", 64),
	}
	returnDigest, _ := hex.DecodeString(receipt.ReturnCashuSigAllDigest)
	bidderSignature, err := schnorr.Sign(bidderPayment, returnDigest)
	if err != nil {
		t.Fatal(err)
	}
	receipt.BidderReturnSignature = hex.EncodeToString(bidderSignature.Serialize())
	bundleDigest := integratedFundingBundleDigest(receipt)
	receipt.BundleDigest = hex.EncodeToString(bundleDigest[:])
	actorSignature, err := schnorr.Sign(actor, bundleDigest[:])
	if err != nil {
		t.Fatal(err)
	}
	receipt.ActorFundingSignature = hex.EncodeToString(actorSignature.Serialize())
	committeeDigest := integratedFundingAdmissionSignatureDigest(receipt)
	committeeSignature, err := schnorr.Sign(committee, committeeDigest[:])
	if err != nil {
		t.Fatal(err)
	}
	receipt.CommitteeSignature = hex.EncodeToString(committeeSignature.Serialize())
	return receipt
}

type fundingAbortFixture struct {
	state     State
	seed      []byte
	actor     *btcec.PrivateKey
	committee *btcec.PrivateKey
	receipt   IntegratedFundingReceipt
	cert      FundingAbortCertificateV1
	bid       Transaction
}

func testFundingAbortFixture(t *testing.T) fundingAbortFixture {
	t.Helper()
	seed := make([]byte, ed25519.SeedSize)
	committee, actor, payment, refund, sellerPayment := testEvenPrivateKey(t), testPrivateKey(t), testPrivateKey(t), testPrivateKey(t), testPrivateKey(t)
	const originalEnd = int64(5_000)
	proofY := hex.EncodeToString(testPrivateKey(t).PubKey().SerializeCompressed())
	receipt := testIntegratedFundingReceipt(t, committee, actor, payment, "abort-auction", "", 2_500, 2_500,
		"abort-operation", []string{proofY}, originalEnd+DefaultPolicy().MaxTotalExtension+EmergencyRecoverySeconds, 2_300)
	receipt.Schema = "PlebeianAuctionsPOCIntegratedFundingV4"
	receipt.ActorFundingSignature = ""
	receipt.RefundPublicKey = hex.EncodeToString(refund.PubKey().SerializeCompressed())
	receipt.PreparedBundleDigest = strings.Repeat("4", 64)
	authorization := fridayFundingAuthorizationContentV1{
		Schema: "PLEBEIAN_FRIDAY_BROWSER_FUNDING_AUTHORIZATION_V1", AuthNetworkID: receipt.AuthNetworkID,
		ChainID: receipt.ChainID, AuctionID: receipt.AuctionID, Amount: receipt.PoolAmount, MintURL: receipt.MintURL,
		PaymentPublicKey: receipt.BidderPublicKey, RefundPublicKey: receipt.RefundPublicKey,
		FundingOperationID: receipt.FundingOperationID, BundleDigest: receipt.PreparedBundleDigest,
		ReturnPackageDigest: receipt.ReturnPackageDigest, ReturnCashuSigAllDigest: receipt.ReturnCashuSigAllDigest,
		BidderReturnSignature: receipt.BidderReturnSignature, ExpiresAt: receipt.ExpiresAt,
	}
	keyTerms, _ := json.Marshal(struct {
		Schema                  string `json:"schema"`
		Actor                   string `json:"actor"`
		AuthNetworkID           string `json:"authNetworkId"`
		ChainID                 string `json:"chainId"`
		AuctionID               string `json:"auctionId"`
		Amount                  int64  `json:"amount"`
		MintURL                 string `json:"mintUrl"`
		PaymentPublicKey        string `json:"paymentPublicKey"`
		RefundPublicKey         string `json:"refundPublicKey"`
		FundingOperationID      string `json:"fundingOperationId"`
		BundleDigest            string `json:"bundleDigest"`
		ReturnPackageDigest     string `json:"returnPackageDigest"`
		ReturnCashuSigAllDigest string `json:"returnCashuSigAllDigest"`
		BidderReturnSignature   string `json:"bidderReturnSignature"`
		ExpiresAt               int64  `json:"expiresAt"`
	}{
		authorization.Schema, actorForKey(actor), authorization.AuthNetworkID, authorization.ChainID,
		authorization.AuctionID, authorization.Amount, authorization.MintURL, authorization.PaymentPublicKey,
		authorization.RefundPublicKey, authorization.FundingOperationID, authorization.BundleDigest,
		authorization.ReturnPackageDigest, authorization.ReturnCashuSigAllDigest,
		authorization.BidderReturnSignature, authorization.ExpiresAt,
	})
	keyDigest := sha256.Sum256(append([]byte("PLEBEIAN_FRIDAY_PAYMENT_KEY_AUTHORIZATION_V1"), keyTerms...))
	paymentSignature, _ := schnorr.Sign(payment, keyDigest[:])
	refundSignature, _ := schnorr.Sign(refund, keyDigest[:])
	authorization.PaymentKeyAuthorizationSignature = hex.EncodeToString(paymentSignature.Serialize())
	authorization.RefundKeyAuthorizationSignature = hex.EncodeToString(refundSignature.Serialize())
	authorizationJSON, _ := json.Marshal(authorization)
	authorizationEvent, err := SignNostrEvent(actor, receipt.AttestedAt, 28647, [][]string{
		{"t", "plebeian-friday-funding-v1"}, {"a", receipt.AuctionID},
		{"operation", receipt.FundingOperationID}, {"payment", receipt.BidderPublicKey},
	}, string(authorizationJSON))
	if err != nil {
		t.Fatal(err)
	}
	receipt.ActorFundingAuthorization = &authorizationEvent
	bundleDigest := integratedFundingBundleDigest(receipt)
	receipt.BundleDigest = hex.EncodeToString(bundleDigest[:])
	committeeDigest := integratedFundingAdmissionSignatureDigest(receipt)
	committeeSignature, _ := schnorr.Sign(committee, committeeDigest[:])
	receipt.CommitteeSignature = hex.EncodeToString(committeeSignature.Serialize())
	pins := FundingAbortPinsV1{
		AuthNetworkID: receipt.AuthNetworkID, ChainID: receipt.ChainID, GenesisSHA256: strings.Repeat("1", 64),
		MintURL: receipt.MintURL, ActiveKeysetID: receipt.ActiveKeysetID, CommitteePublicKey: receipt.CommitteePublicKey,
		CommitteeKeysetID: receipt.CommitteeKeysetID, CommitteeKeysetVersion: receipt.CommitteeKeysetVersion,
		DKGRunID: receipt.DKGRunID, PublicKeyPackageSHA256: receipt.PublicKeyPackageSHA256,
		SignerRosterDigest: receipt.SignerRosterDigest,
	}
	state, err := NewStateWithFundingAbortPins(receipt.ChainID, ed25519.NewKeyFromSeed(seed).Public().(ed25519.PublicKey),
		receipt.CommitteePublicKey, TestMintURL, receipt.MintURL, pins)
	if err != nil {
		t.Fatal(err)
	}
	state.Height = 40
	state.Auctions[receipt.AuctionID] = Auction{
		ID: receipt.AuctionID, Seller: strings.Repeat("f", 64), Title: "Abort exclusion fixture",
		FundingMode:                FundingModeThresholdSigAll,
		SellerCocoPaymentPublicKey: hex.EncodeToString(sellerPayment.PubKey().SerializeCompressed()),
		StartingBid:                1_000, MinIncrement: 100, CreatedAt: 1_000, OriginalEndTime: originalEnd,
		EndTime: originalEnd, Status: "open",
	}
	bidContentJSON, _ := json.Marshal(bidContent{
		AuctionID: receipt.AuctionID, Amount: receipt.BidAmount, IntegratedFunding: &receipt,
	})
	bidEvent, err := SignNostrEvent(actor, 2_050, KindBid, nil, string(bidContentJSON))
	if err != nil {
		t.Fatal(err)
	}
	cert := FundingAbortCertificateV1{
		Schema: fundingAbortSchema, AuthNetworkID: pins.AuthNetworkID, ChainID: pins.ChainID,
		GenesisSHA256: pins.GenesisSHA256, AuctionID: receipt.AuctionID, OperationID: receipt.FundingOperationID,
		Actor: receipt.Bidder, MintURL: receipt.MintURL, ActiveKeysetID: receipt.ActiveKeysetID,
		Amount: receipt.PoolAmount, ProofYs: append([]string(nil), receipt.ProofStateRefs...), PoolDigest: strings.Repeat("2", 64),
		NUT11LockPublicKeys: []string{receipt.BidderPublicKey, receipt.CommitteePublicKey}, Locktime: receipt.Locktime,
		PaymentPublicKey: receipt.BidderPublicKey, RefundPublicKey: receipt.RefundPublicKey,
		CommitteePublicKey: receipt.CommitteePublicKey, ReturnPackageDigest: receipt.ReturnPackageDigest,
		ReturnCashuSigAllDigest: receipt.ReturnCashuSigAllDigest, BidderReturnSignature: receipt.BidderReturnSignature,
		FundingAuthorizationEventID: authorizationEvent.ID, AbortNotBefore: 2_000, AbortExpiresAt: 2_300,
		AbortReason: "prebroadcast_client_abandonment", CommitteeKeysetID: receipt.CommitteeKeysetID,
		CommitteeKeysetVersion: receipt.CommitteeKeysetVersion, DKGRunID: receipt.DKGRunID,
		PublicKeyPackageSHA256: receipt.PublicKeyPackageSHA256, SignerRosterDigest: receipt.SignerRosterDigest,
		ParticipantPolicyDigest: receipt.ParticipantPolicyDigest,
	}
	resignFundingAbortFixture(t, &cert, actor, committee, 2_025)
	return fundingAbortFixture{state: state, seed: seed, actor: actor, committee: committee, receipt: receipt, cert: cert,
		bid: Transaction{Version: TxVersion, Type: "event", Event: &bidEvent}}
}

func TestFrostCashuAuthorityNeedsNoLegacySeedAndRejectsLegacyIssuance(t *testing.T) {
	t.Parallel()
	fixture := testFundingAbortFixture(t)
	mintPublic, err := DeriveFrostCashuLegacyNotePublicPin(*fixture.state.FundingAbortPins)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := NewStateWithFrostFundingAbortPins(fixture.state.ChainID,
		ed25519.NewKeyFromSeed(fixture.seed).Public().(ed25519.PublicKey), fixture.state.CommitteePublicKey,
		fixture.state.MintURL, fixture.state.CashuMintURL, *fixture.state.FundingAbortPins); err == nil ||
		!strings.Contains(err.Error(), "disabled legacy-note authority pin differs") {
		t.Fatalf("FROST/Cashu accepted a shared-seed public key: %v", err)
	}
	state, err := NewStateWithFrostFundingAbortPins(fixture.state.ChainID, mintPublic,
		fixture.state.CommitteePublicKey, fixture.state.MintURL, fixture.state.CashuMintURL,
		*fixture.state.FundingAbortPins)
	if err != nil {
		t.Fatal(err)
	}
	state.Height = fixture.state.Height
	state.Auctions = fixture.state.Auctions

	accepted, err := ApplyTransaction(state, fixture.bid, 2_050, DefaultPolicy(), nil)
	if err != nil {
		t.Fatalf("V4 integrated bid without legacy seed: %v", err)
	}
	if accepted.ApplicationAuthority != ApplicationAuthorityFrostCashu ||
		accepted.IntegratedFundings[fixture.receipt.FundingOperationID].Status != "active" {
		t.Fatalf("FROST/Cashu transition = authority %q funding %+v",
			accepted.ApplicationAuthority, accepted.IntegratedFundings[fixture.receipt.FundingOperationID])
	}
	if _, err := ApplyTransaction(state, Transaction{Version: TxVersion, Type: "faucet", Actor: actorForKey(fixture.actor)},
		2_050, DefaultPolicy(), nil); err == nil || !strings.Contains(err.Error(), "legacy faucet") {
		t.Fatalf("FROST/Cashu faucet error = %v", err)
	}
	if _, err := ApplyTransaction(state, fixture.bid, 2_050, DefaultPolicy(), fixture.seed); err == nil ||
		!strings.Contains(err.Error(), "refuses a legacy mint seed") {
		t.Fatalf("FROST/Cashu supplied-seed error = %v", err)
	}
	closeTx := Transaction{Version: TxVersion, Type: "close", AuctionID: fixture.receipt.AuctionID}
	if err := ValidateForMempool(state, closeTx, DefaultPolicy(), nil); err == nil ||
		!strings.Contains(err.Error(), "has not ended") {
		t.Fatalf("early permissionless close CheckTx error = %v", err)
	}
	closeReady, err := state.Clone()
	if err != nil {
		t.Fatal(err)
	}
	closeReady.LastConsensusTime = closeReady.Auctions[fixture.receipt.AuctionID].EndTime
	if err := ValidateForMempool(closeReady, closeTx, DefaultPolicy(), nil); err != nil {
		t.Fatalf("eligible permissionless close CheckTx: %v", err)
	}
	closed, err := ApplyTransaction(closeReady, closeTx, closeReady.LastConsensusTime, DefaultPolicy(), nil)
	if err != nil {
		t.Fatalf("eligible permissionless close: %v", err)
	}
	if closed.Auctions[fixture.receipt.AuctionID].Status != "closed" ||
		closed.Auctions[fixture.receipt.AuctionID].Winner != "" ||
		closed.Auctions[fixture.receipt.AuctionID].HighBid != state.Auctions[fixture.receipt.AuctionID].HighBid {
		t.Fatalf("permissionless close changed auction outcome: %+v", closed.Auctions[fixture.receipt.AuctionID])
	}
	if _, err := DecodeTransaction([]byte(`{"version":1,"type":"close","actor":"` + actorForKey(fixture.actor) + `","auction_id":"abort-auction"}`));
		err == nil || !strings.Contains(err.Error(), "invalid close transaction shape") {
		t.Fatalf("actor-bearing close transaction error = %v", err)
	}
	aborted, err := ApplyTransaction(state, Transaction{Version: TxVersion, Type: "funding_abort", FundingAbort: &fixture.cert},
		2_025, DefaultPolicy(), nil)
	if err != nil {
		t.Fatalf("FundingAbortV1 without legacy seed: %v", err)
	}
	if aborted.FundingLifecycles[fixture.receipt.FundingOperationID].Origin != "committed_abort" ||
		aborted.FundingLifecycles[fixture.receipt.FundingOperationID].Status != "aborted_return_entitled" {
		t.Fatalf("seedless abort lifecycle = %+v", aborted.FundingLifecycles[fixture.receipt.FundingOperationID])
	}

	seller := testPrivateKey(t)
	legacyCreate := testEvent(t, seller, 2_050, KindCreate, createContent{
		AuctionID: "legacy-create", Title: "Legacy", Duration: 60, StartingBid: 100,
		FundingMode: FundingModeCustodialReservation,
	})
	legacyBid := testEvent(t, fixture.actor, 2_050, KindBid, bidContent{
		AuctionID: fixture.receipt.AuctionID, Amount: 2_500, Inputs: []string{"legacy-note"},
	})
	v3 := fixture.receipt
	v3.Schema = "PlebeianAuctionsPOCIntegratedFundingV3"
	v3Bid := testEvent(t, fixture.actor, 2_050, KindBid, bidContent{
		AuctionID: fixture.receipt.AuctionID, Amount: 2_500, IntegratedFunding: &v3,
	})
	legacyRefund := testEvent(t, fixture.actor, 2_050, KindRefund, refundContent{BidID: "legacy-bid"})
	legacyClose, err := state.Clone()
	if err != nil {
		t.Fatal(err)
	}
	auction := legacyClose.Auctions[fixture.receipt.AuctionID]
	auction.FundingMode = FundingModeCustodialReservation
	auction.EndTime = 2_000
	legacyClose.Auctions[auction.ID] = auction
	legacyClose.LastConsensusTime = 2_050
	if err := ValidateForMempool(legacyClose, Transaction{Version: TxVersion, Type: "close", AuctionID: auction.ID},
		DefaultPolicy(), nil); err == nil || !strings.Contains(err.Error(), "threshold-funded auction") {
		t.Fatalf("legacy close CheckTx error = %v", err)
	}
	legacyCases := []struct {
		name string
		from State
		tx   Transaction
		want string
	}{
		{"custodial create", state, Transaction{Version: TxVersion, Type: "event", Event: &legacyCreate}, "threshold-funded auctions"},
		{"interim note inputs", state, Transaction{Version: TxVersion, Type: "event", Event: &legacyBid}, "requires V4 integrated funding"},
		{"V3 integrated funding", state, Transaction{Version: TxVersion, Type: "event", Event: &v3Bid}, "requires V4 integrated funding"},
		{"legacy refund note", state, Transaction{Version: TxVersion, Type: "event", Event: &legacyRefund}, "committed terminal entitlement"},
		{"legacy close payout", legacyClose, Transaction{Version: TxVersion, Type: "close", AuctionID: auction.ID}, "threshold-funded auction"},
	}
	for _, test := range legacyCases {
		t.Run(test.name, func(t *testing.T) {
			if _, err := ApplyTransaction(test.from, test.tx, 2_050, DefaultPolicy(), nil); err == nil ||
				!strings.Contains(err.Error(), test.want) {
				t.Fatalf("error = %v, want %q", err, test.want)
			}
		})
	}

	corrupt, err := state.Clone()
	if err != nil {
		t.Fatal(err)
	}
	auction = corrupt.Auctions[fixture.receipt.AuctionID]
	auction.EndTime = 2_000
	auction.LeaderBidID = "legacy-leader"
	corrupt.Auctions[auction.ID] = auction
	corrupt.Bids[auction.LeaderBidID] = Bid{ID: auction.LeaderBidID, AuctionID: auction.ID, Bidder: actorForKey(fixture.actor), Amount: 2_500}
	corrupt.Locks[auction.LeaderBidID] = Lock{ID: auction.LeaderBidID, AuctionID: auction.ID, BidID: auction.LeaderBidID,
		Bidder: actorForKey(fixture.actor), Amount: 2_500, Status: "locked"}
	if _, err := ApplyTransaction(corrupt, Transaction{Version: TxVersion, Type: "close", AuctionID: auction.ID},
		2_050, DefaultPolicy(), nil); err == nil || !strings.Contains(err.Error(), "legacy test-mint authority is unavailable") {
		t.Fatalf("corrupt legacy payout path error = %v", err)
	}

	app, err := NewApplicationWithFrostFundingAbortPins(state.ChainID, DefaultPolicy(), mintPublic,
		state.CommitteePublicKey, state.MintURL, state.CashuMintURL, filepath.Join(t.TempDir(), "state.json"),
		*state.FundingAbortPins)
	if err != nil {
		t.Fatalf("FROST/Cashu application from public pins: %v", err)
	}
	if len(app.mintSeed) != 0 || app.state.ApplicationAuthority != ApplicationAuthorityFrostCashu {
		t.Fatalf("FROST/Cashu application retained legacy authority: seed=%d mode=%q", len(app.mintSeed), app.state.ApplicationAuthority)
	}
}

func resignFundingAbortFixture(t *testing.T, cert *FundingAbortCertificateV1, actor, committee *btcec.PrivateKey, createdAt int64) {
	t.Helper()
	cert.ActorAbortEvent = SignedEvent{}
	cert.CommitteeAbortSignature = ""
	terms, err := fundingAbortActorTerms(*cert)
	if err != nil {
		t.Fatal(err)
	}
	event, err := SignNostrEvent(actor, createdAt, KindFundingAbort, [][]string{
		{"t", "plebeian-friday-funding-abort-v1"}, {"a", cert.AuctionID}, {"operation", cert.OperationID},
	}, string(terms))
	if err != nil {
		t.Fatal(err)
	}
	cert.ActorAbortEvent = event
	digest, err := fundingAbortCommitteeDigest(*cert)
	if err != nil {
		t.Fatal(err)
	}
	signature, err := schnorr.Sign(committee, digest[:])
	if err != nil {
		t.Fatal(err)
	}
	cert.CommitteeAbortSignature = hex.EncodeToString(signature.Serialize())
}

func TestFundingAbortV1MutualExclusionAndRestart(t *testing.T) {
	fixture := testFundingAbortFixture(t)
	abort := Transaction{Version: TxVersion, Type: "funding_abort", FundingAbort: &fixture.cert}

	aborted, err := ApplyTransaction(fixture.state, abort, 2_050, DefaultPolicy(), fixture.seed)
	if err != nil {
		t.Fatalf("commit abort: %v", err)
	}
	record := aborted.FundingLifecycles[fixture.cert.OperationID]
	if record.Status != "aborted_return_entitled" || record.Origin != "committed_abort" ||
		record.CommittedHeight != fixture.state.Height+1 || record.AbortCertificateDigest == "" ||
		len(aborted.IntegratedFundings) != 0 || len(aborted.Locks) != 0 || len(aborted.Notes) != 0 {
		t.Fatalf("abort created effects beyond one return entitlement: %+v", record)
	}
	if _, err := ApplyTransaction(aborted, fixture.bid, 2_051, DefaultPolicy(), fixture.seed); err == nil ||
		!strings.Contains(err.Error(), "committed lifecycle origin") {
		t.Fatalf("abort-first delayed bid error=%v", err)
	}

	bidFirst, err := ApplyTransaction(fixture.state, fixture.bid, 2_050, DefaultPolicy(), fixture.seed)
	if err != nil {
		t.Fatalf("commit bid: %v", err)
	}
	if bidFirst.FundingLifecycles[fixture.cert.OperationID].Status != "active" {
		t.Fatalf("bid did not claim funding lifecycle: %+v", bidFirst.FundingLifecycles)
	}
	if _, err := ApplyTransaction(bidFirst, abort, 2_051, DefaultPolicy(), fixture.seed); err == nil ||
		!strings.Contains(err.Error(), "committed lifecycle origin") {
		t.Fatalf("bid-first abort error=%v", err)
	}

	restoredJSON, err := json.Marshal(aborted)
	if err != nil {
		t.Fatal(err)
	}
	var restored State
	if err := json.Unmarshal(restoredJSON, &restored); err != nil {
		t.Fatal(err)
	}
	if err := normalizeState(&restored, DefaultPolicy()); err != nil {
		t.Fatalf("restore V7 state: %v", err)
	}
	pinless := restored
	pinless.FundingAbortPins = nil
	if err := normalizeState(&pinless, DefaultPolicy()); err == nil || !strings.Contains(err.Error(), "lacks immutable deployment pins") {
		t.Fatalf("pinless persisted abort lifecycle error=%v", err)
	}
	crossStore := restored
	crossStore.IntegratedProofUses = map[string]string{fixture.cert.ProofYs[0][2:]: "another-operation"}
	if err := normalizeState(&crossStore, DefaultPolicy()); err == nil || !strings.Contains(err.Error(), "integrated and lifecycle funding") {
		t.Fatalf("cross-store proof owner error=%v", err)
	}
	bidJSON, err := json.Marshal(bidFirst)
	if err != nil {
		t.Fatal(err)
	}
	var restoredBid State
	if err := json.Unmarshal(bidJSON, &restoredBid); err != nil {
		t.Fatal(err)
	}
	if err := normalizeState(&restoredBid, DefaultPolicy()); err != nil {
		t.Fatalf("consistent integrated/lifecycle mirror rejected: %v", err)
	}
	brokenMirror := restoredBid
	brokenMirror.IntegratedFundings = make(map[string]IntegratedFunding, len(restoredBid.IntegratedFundings))
	for key, value := range restoredBid.IntegratedFundings {
		brokenMirror.IntegratedFundings[key] = value
	}
	funding := brokenMirror.IntegratedFundings[fixture.cert.OperationID]
	funding.Bidder = strings.Repeat("d", 64)
	brokenMirror.IntegratedFundings[fixture.cert.OperationID] = funding
	if err := normalizeState(&brokenMirror, DefaultPolicy()); err == nil || !strings.Contains(err.Error(), "mirror disagree") {
		t.Fatalf("inconsistent integrated/lifecycle mirror error=%v", err)
	}
	alias := fixture.cert
	alias.OperationID = "abort-operation-alias"
	if alias.ProofYs[0][:2] == "02" {
		alias.ProofYs = []string{"03" + alias.ProofYs[0][2:]}
	} else {
		alias.ProofYs = []string{"02" + alias.ProofYs[0][2:]}
	}
	resignFundingAbortFixture(t, &alias, fixture.actor, fixture.committee, 2_026)
	if _, err := ApplyTransaction(restored, Transaction{Version: TxVersion, Type: "funding_abort", FundingAbort: &alias}, 2_052, DefaultPolicy(), fixture.seed); err == nil ||
		!strings.Contains(err.Error(), "proof already") {
		t.Fatalf("restart/parity-alias abort error=%v", err)
	}
}

func TestFundingAbortPinsRejectLegacyV3BeforeOwnershipChecks(t *testing.T) {
	fixture := testFundingAbortFixture(t)
	legacy := fixture.receipt
	legacy.Schema = "PlebeianAuctionsPOCIntegratedFundingV3"
	content := bidContent{AuctionID: legacy.AuctionID, Amount: legacy.BidAmount, IntegratedFunding: &legacy}
	assertRejected := func(label string, state State, receipt IntegratedFundingReceipt) {
		t.Helper()
		content.IntegratedFunding = &receipt
		if err := verifyIntegratedFundingReceipt(state, receipt.Bidder, 2_050, content, receipt, DefaultPolicy()); err == nil ||
			!strings.Contains(err.Error(), "legacy integrated funding is disabled") {
			t.Fatalf("%s legacy V3 error=%v", label, err)
		}
	}

	// The legacy schema is rejected before an abort exists and irrespective of
	// whether it names the eventual operation, another operation, or the other
	// compressed-point parity alias for the same proof Y.
	assertRejected("pre-abort same operation", fixture.state, legacy)
	otherOperation := legacy
	otherOperation.FundingOperationID = "other-legacy-operation"
	assertRejected("pre-abort other operation", fixture.state, otherOperation)
	parityAlias := otherOperation
	if parityAlias.ProofStateRefs[0][:2] == "02" {
		parityAlias.ProofStateRefs = []string{"03" + parityAlias.ProofStateRefs[0][2:]}
	} else {
		parityAlias.ProofStateRefs = []string{"02" + parityAlias.ProofStateRefs[0][2:]}
	}
	assertRejected("pre-abort parity alias", fixture.state, parityAlias)

	aborted, err := ApplyTransaction(fixture.state,
		Transaction{Version: TxVersion, Type: "funding_abort", FundingAbort: &fixture.cert},
		2_050, DefaultPolicy(), fixture.seed)
	if err != nil {
		t.Fatalf("commit abort: %v", err)
	}
	encoded, err := json.Marshal(aborted)
	if err != nil {
		t.Fatal(err)
	}
	var restored State
	if err := json.Unmarshal(encoded, &restored); err != nil {
		t.Fatal(err)
	}
	if err := normalizeState(&restored, DefaultPolicy()); err != nil {
		t.Fatalf("restore aborted state: %v", err)
	}
	assertRejected("post-abort same operation", restored, legacy)
	assertRejected("post-abort other operation", restored, otherOperation)
	assertRejected("post-abort parity alias", restored, parityAlias)
}

func TestFundingAbortV1StrictPinsTimeAndShape(t *testing.T) {
	fixture := testFundingAbortFixture(t)
	abort := Transaction{Version: TxVersion, Type: "funding_abort", FundingAbort: &fixture.cert}
	raw, err := json.Marshal(abort)
	if err != nil {
		t.Fatal(err)
	}
	withUnknown := bytes.Replace(raw, []byte(`"amount":2500`), []byte(`"amount":2500,"unexpected":true`), 1)
	if _, err := DecodeTransaction(withUnknown); err == nil || !strings.Contains(err.Error(), "unknown field") {
		t.Fatalf("nested unknown field error=%v", err)
	}
	if decoded, err := DecodeTransaction(raw); err != nil || decoded.FundingAbort == nil {
		t.Fatalf("strict funding-abort decode failed: %v", err)
	}
	if _, err := ApplyTransaction(fixture.state, abort, fixture.cert.AbortNotBefore-1, DefaultPolicy(), fixture.seed); err == nil ||
		!strings.Contains(err.Error(), "validity") {
		t.Fatalf("early committed-time error=%v", err)
	}
	mutated := fixture.cert
	mutated.ActiveKeysetID = "other-keyset"
	resignFundingAbortFixture(t, &mutated, fixture.actor, fixture.committee, 2_025)
	if _, err := ApplyTransaction(fixture.state, Transaction{Version: TxVersion, Type: "funding_abort", FundingAbort: &mutated}, 2_050, DefaultPolicy(), fixture.seed); err == nil ||
		!strings.Contains(err.Error(), "deployment pins") {
		t.Fatalf("pin mismatch error=%v", err)
	}
	mutated = fixture.cert
	mutated.Amount++
	if _, err := ApplyTransaction(fixture.state, Transaction{Version: TxVersion, Type: "funding_abort", FundingAbort: &mutated}, 2_050, DefaultPolicy(), fixture.seed); err == nil ||
		!strings.Contains(err.Error(), "actor event terms") {
		t.Fatalf("mutated actor terms error=%v", err)
	}
	mutated = fixture.cert
	mutated.CommitteeAbortSignature = fixture.cert.ActorAbortEvent.Sig
	if _, err := ApplyTransaction(fixture.state, Transaction{Version: TxVersion, Type: "funding_abort", FundingAbort: &mutated}, 2_050, DefaultPolicy(), fixture.seed); err == nil ||
		!strings.Contains(err.Error(), "committee signature") {
		t.Fatalf("cross-domain committee signature error=%v", err)
	}

	legacy := fixture.state
	legacy.Schema = "PlebeianAuctionsPOCStateV6"
	legacy.FundingAbortPins = nil
	legacy.FundingLifecycles = nil
	legacy.FundingProofOwners = nil
	if err := normalizeState(&legacy, DefaultPolicy()); err != nil {
		t.Fatal(err)
	}
	if _, err := ApplyTransaction(legacy, abort, 2_050, DefaultPolicy(), fixture.seed); err == nil ||
		!strings.Contains(err.Error(), "disabled") {
		t.Fatalf("migrated pinless state did not fail closed: %v", err)
	}

	badPins := *fixture.state.FundingAbortPins
	badPins.MintURL = "http://127.0.0.1:4338"
	if _, err := NewStateWithFundingAbortPins(badPins.ChainID, ed25519.NewKeyFromSeed(fixture.seed).Public().(ed25519.PublicKey),
		badPins.CommitteePublicKey, TestMintURL, fixture.state.CashuMintURL, badPins); err == nil ||
		!strings.Contains(err.Error(), "canonical state") {
		t.Fatalf("inconsistent constructor pins error=%v", err)
	}
}

func TestPublicCashuIdentityRejectsCrossMintReceipt(t *testing.T) {
	seed := make([]byte, ed25519.SeedSize)
	committee, actor, bidderPayment := testEvenPrivateKey(t), testPrivateKey(t), testPrivateKey(t)
	const publicMint = "https://172.105.64.142"
	state, err := NewStateWithEndpoints(
		"integrated-threshold", ed25519.NewKeyFromSeed(seed).Public().(ed25519.PublicKey),
		hex.EncodeToString(committee.PubKey().SerializeCompressed()), TestMintURL, publicMint,
	)
	if err != nil {
		t.Fatalf("public HTTPS Cashu identity rejected: %v", err)
	}
	receipt := testIntegratedFundingReceipt(t, committee, actor, bidderPayment, "public-mint-auction", "", 1_000, 1_000,
		"public-mint-funding", []string{hex.EncodeToString(testPrivateKey(t).PubKey().SerializeCompressed())}, 13_300, 10_300)
	state.AuthNetworkID, state.ChainID = receipt.AuthNetworkID, receipt.ChainID
	state.Auctions[receipt.AuctionID] = Auction{ID: receipt.AuctionID, Seller: strings.Repeat("f", 64),
		FundingMode: FundingModeThresholdSigAll, OriginalEndTime: 10_000, EndTime: 10_000, Status: "open"}
	content := bidContent{AuctionID: receipt.AuctionID, Amount: receipt.BidAmount, IntegratedFunding: &receipt}
	if err := verifyIntegratedFundingReceipt(state, actorForKey(actor), receipt.AttestedAt, content, receipt, DefaultPolicy()); err == nil || !strings.Contains(err.Error(), "mint is not trusted") {
		t.Fatalf("cross-mint receipt error=%v, want exact canonical mint rejection", err)
	}
}

func TestIntegratedFundingV4NostrAuthorization(t *testing.T) {
	committee, actor, bidderPayment, refund, sellerPayment := testEvenPrivateKey(t), testPrivateKey(t), testPrivateKey(t), testPrivateKey(t), testPrivateKey(t)
	originalEnd := int64(10_000)
	locktime := originalEnd + DefaultPolicy().MaxTotalExtension + EmergencyRecoverySeconds
	receipt := testIntegratedFundingReceipt(t, committee, actor, bidderPayment, "auction-v4", "", 2_500, 2_500, "funding-v4", []string{
		hex.EncodeToString(testPrivateKey(t).PubKey().SerializeCompressed()),
	}, locktime, 9_900)
	receipt.Schema = "PlebeianAuctionsPOCIntegratedFundingV4"
	receipt.ActorFundingSignature = ""
	receipt.RefundPublicKey = hex.EncodeToString(refund.PubKey().SerializeCompressed())
	receipt.PreparedBundleDigest = strings.Repeat("4", 64)
	authorization := fridayFundingAuthorizationContentV1{
		Schema:        "PLEBEIAN_FRIDAY_BROWSER_FUNDING_AUTHORIZATION_V1",
		AuthNetworkID: receipt.AuthNetworkID, ChainID: receipt.ChainID, AuctionID: receipt.AuctionID,
		Amount: receipt.PoolAmount, MintURL: receipt.MintURL, PaymentPublicKey: receipt.BidderPublicKey,
		RefundPublicKey: receipt.RefundPublicKey, FundingOperationID: receipt.FundingOperationID,
		BundleDigest: receipt.PreparedBundleDigest, ReturnPackageDigest: receipt.ReturnPackageDigest,
		ReturnCashuSigAllDigest: receipt.ReturnCashuSigAllDigest, BidderReturnSignature: receipt.BidderReturnSignature,
		ExpiresAt: receipt.ExpiresAt,
	}
	terms, _ := json.Marshal(struct {
		Schema                  string `json:"schema"`
		Actor                   string `json:"actor"`
		AuthNetworkID           string `json:"authNetworkId"`
		ChainID                 string `json:"chainId"`
		AuctionID               string `json:"auctionId"`
		Amount                  int64  `json:"amount"`
		MintURL                 string `json:"mintUrl"`
		PaymentPublicKey        string `json:"paymentPublicKey"`
		RefundPublicKey         string `json:"refundPublicKey"`
		FundingOperationID      string `json:"fundingOperationId"`
		BundleDigest            string `json:"bundleDigest"`
		ReturnPackageDigest     string `json:"returnPackageDigest"`
		ReturnCashuSigAllDigest string `json:"returnCashuSigAllDigest"`
		BidderReturnSignature   string `json:"bidderReturnSignature"`
		ExpiresAt               int64  `json:"expiresAt"`
	}{
		authorization.Schema, actorForKey(actor), authorization.AuthNetworkID, authorization.ChainID, authorization.AuctionID,
		authorization.Amount, authorization.MintURL, authorization.PaymentPublicKey, authorization.RefundPublicKey,
		authorization.FundingOperationID, authorization.BundleDigest, authorization.ReturnPackageDigest,
		authorization.ReturnCashuSigAllDigest, authorization.BidderReturnSignature, authorization.ExpiresAt,
	})
	keyDigest := sha256.Sum256(append([]byte("PLEBEIAN_FRIDAY_PAYMENT_KEY_AUTHORIZATION_V1"), terms...))
	paymentSig, _ := schnorr.Sign(bidderPayment, keyDigest[:])
	refundSig, _ := schnorr.Sign(refund, keyDigest[:])
	authorization.PaymentKeyAuthorizationSignature = hex.EncodeToString(paymentSig.Serialize())
	authorization.RefundKeyAuthorizationSignature = hex.EncodeToString(refundSig.Serialize())
	content, _ := json.Marshal(authorization)
	event, err := SignNostrEvent(actor, receipt.AttestedAt, 28647, [][]string{
		{"t", "plebeian-friday-funding-v1"}, {"a", receipt.AuctionID},
		{"operation", receipt.FundingOperationID}, {"payment", receipt.BidderPublicKey},
	}, string(content))
	if err != nil {
		t.Fatal(err)
	}
	receipt.ActorFundingAuthorization = &event
	bundleDigest := integratedFundingBundleDigest(receipt)
	receipt.BundleDigest = hex.EncodeToString(bundleDigest[:])
	committeeDigest := integratedFundingAdmissionSignatureDigest(receipt)
	committeeSignature, _ := schnorr.Sign(committee, committeeDigest[:])
	receipt.CommitteeSignature = hex.EncodeToString(committeeSignature.Serialize())

	seed := make([]byte, ed25519.SeedSize)
	state, err := NewState("v4", ed25519.NewKeyFromSeed(seed).Public().(ed25519.PublicKey), receipt.CommitteePublicKey)
	if err != nil {
		t.Fatal(err)
	}
	state.AuthNetworkID, state.ChainID = receipt.AuthNetworkID, receipt.ChainID
	state.Auctions[receipt.AuctionID] = Auction{ID: receipt.AuctionID, Seller: strings.Repeat("f", 64),
		FundingMode: FundingModeThresholdSigAll, SellerCocoPaymentPublicKey: hex.EncodeToString(sellerPayment.PubKey().SerializeCompressed()),
		OriginalEndTime: originalEnd, EndTime: originalEnd, Status: "open"}
	contentBid := bidContent{AuctionID: receipt.AuctionID, Amount: receipt.BidAmount, IntegratedFunding: &receipt}
	if err := verifyIntegratedFundingReceipt(state, actorForKey(actor), receipt.AttestedAt, contentBid, receipt, DefaultPolicy()); err != nil {
		t.Fatalf("V4 receipt rejected: %v", err)
	}
	// A V4 package can become invalid for auction-business reasons after Coco
	// has locked its proofs.  The exact transaction must commit one return
	// entitlement rather than strand value behind an ordinary CheckTx error.
	auction := state.Auctions[receipt.AuctionID]
	auction.Status = "closed"
	state.Auctions[receipt.AuctionID] = auction
	rejectedEventID := strings.Repeat("9", 64)
	if err := applyBid(&state, actorForKey(actor), rejectedEventID, receipt.AttestedAt, contentBid, DefaultPolicy(), nil); err != nil {
		t.Fatalf("valid V4 rejected-return transition failed: %v", err)
	}
	rejected := state.IntegratedFundings[receipt.FundingOperationID]
	if rejected.Status != "rejected_return_entitled" || rejected.RejectionReason != "auction_not_open" ||
		rejected.BidID != rejectedEventID || state.Bids[rejectedEventID].ID != "" ||
		state.IntegratedProofUses[receipt.ProofStateRefs[0][2:]] != receipt.FundingOperationID {
		t.Fatalf("rejected V4 funding was not exclusively retained for return: %+v", rejected)
	}
	// A receipt may cross its short admission deadline after the browser has
	// locked the pool but before Comet commits it.  A fully authenticated package
	// must commit a return entitlement rather than fail CheckTx/DeliverTx and
	// strand the browser operation.
	expiredState, err := NewState("v4", ed25519.NewKeyFromSeed(seed).Public().(ed25519.PublicKey), receipt.CommitteePublicKey)
	if err != nil {
		t.Fatal(err)
	}
	expiredState.AuthNetworkID, expiredState.ChainID = receipt.AuthNetworkID, receipt.ChainID
	expiredState.Auctions[receipt.AuctionID] = Auction{ID: receipt.AuctionID, Seller: strings.Repeat("f", 64),
		FundingMode: FundingModeThresholdSigAll, SellerCocoPaymentPublicKey: hex.EncodeToString(sellerPayment.PubKey().SerializeCompressed()),
		OriginalEndTime: originalEnd, EndTime: originalEnd, Status: "open"}
	expiredEventID := strings.Repeat("8", 64)
	if err := applyBid(&expiredState, actorForKey(actor), expiredEventID, receipt.ExpiresAt+1, contentBid, DefaultPolicy(), nil); err != nil {
		t.Fatalf("expired authenticated V4 receipt did not commit its return entitlement: %v", err)
	}
	expiredFunding := expiredState.IntegratedFundings[receipt.FundingOperationID]
	if expiredFunding.Status != "rejected_return_entitled" || expiredFunding.RejectionReason != "funding_expired" ||
		expiredFunding.BidID != expiredEventID || expiredState.Bids[expiredEventID].ID != "" {
		t.Fatalf("expired V4 funding was not retained exactly once for return: %+v", expiredFunding)
	}
	// Receipt expiry has canonical precedence if the same committed block is
	// also beyond the auction deadline; downstream finality adapters must never
	// have to guess between two valid terminal reasons for one funding pool.
	expiredAndLateState, err := NewState("v4", ed25519.NewKeyFromSeed(seed).Public().(ed25519.PublicKey), receipt.CommitteePublicKey)
	if err != nil {
		t.Fatal(err)
	}
	expiredAndLateState.AuthNetworkID, expiredAndLateState.ChainID = receipt.AuthNetworkID, receipt.ChainID
	expiredAndLateState.Auctions[receipt.AuctionID] = Auction{ID: receipt.AuctionID, Seller: strings.Repeat("f", 64),
		FundingMode: FundingModeThresholdSigAll, SellerCocoPaymentPublicKey: hex.EncodeToString(sellerPayment.PubKey().SerializeCompressed()),
		OriginalEndTime: originalEnd, EndTime: receipt.ExpiresAt, Status: "open"}
	expiredAndLateEventID := strings.Repeat("6", 64)
	if err := applyBid(&expiredAndLateState, actorForKey(actor), expiredAndLateEventID, receipt.ExpiresAt+1, contentBid, DefaultPolicy(), nil); err != nil {
		t.Fatalf("late plus expired V4 funding did not commit one canonical return: %v", err)
	}
	expiredAndLate := expiredAndLateState.IntegratedFundings[receipt.FundingOperationID]
	if expiredAndLate.Status != "rejected_return_entitled" || expiredAndLate.RejectionReason != "funding_expired" ||
		expiredAndLate.BidID != expiredAndLateEventID || expiredAndLateState.Bids[expiredAndLateEventID].ID != "" {
		t.Fatalf("late plus expired V4 funding did not prefer canonical expiry: %+v", expiredAndLate)
	}
	// Expiry handling is not a generic escape hatch: a malformed threshold
	// attestation remains a hard error and creates no return authority.
	malformedState, err := NewState("v4", ed25519.NewKeyFromSeed(seed).Public().(ed25519.PublicKey), receipt.CommitteePublicKey)
	if err != nil {
		t.Fatal(err)
	}
	malformedState.AuthNetworkID, malformedState.ChainID = receipt.AuthNetworkID, receipt.ChainID
	malformedState.Auctions[receipt.AuctionID] = expiredState.Auctions[receipt.AuctionID]
	malformedReceipt := receipt
	malformedReceipt.CommitteeSignature = strings.Repeat("0", schnorr.SignatureSize*2)
	malformedBid := contentBid
	malformedBid.IntegratedFunding = &malformedReceipt
	if err := applyBid(&malformedState, actorForKey(actor), strings.Repeat("7", 64), receipt.ExpiresAt+1, malformedBid, DefaultPolicy(), nil); err == nil {
		t.Fatal("malformed expired V4 receipt obtained return authority")
	}
	if len(malformedState.IntegratedFundings) != 0 || len(malformedState.IntegratedProofUses) != 0 {
		t.Fatalf("malformed receipt mutated funding state: %+v", malformedState.IntegratedFundings)
	}
	mutated := receipt
	changed := *receipt.ActorFundingAuthorization
	changed.Content = strings.Replace(changed.Content, receipt.AuctionID, "other-auction", 1)
	mutated.ActorFundingAuthorization = &changed
	if err := verifyIntegratedFundingReceipt(state, actorForKey(actor), receipt.AttestedAt, contentBid, mutated, DefaultPolicy()); err == nil {
		t.Fatal("mutated V4 authorization accepted")
	}
}

func TestIntegratedFundingV3RejectsUnsignedV4Fields(t *testing.T) {
	committee, actor, bidderPayment := testEvenPrivateKey(t), testPrivateKey(t), testPrivateKey(t)
	originalEnd := int64(10_000)
	receipt := testIntegratedFundingReceipt(t, committee, actor, bidderPayment, "auction-v3", "", 2_500, 2_500, "funding-v3", []string{
		hex.EncodeToString(testPrivateKey(t).PubKey().SerializeCompressed()),
	}, originalEnd+DefaultPolicy().MaxTotalExtension+EmergencyRecoverySeconds, 9_900)
	seed := make([]byte, ed25519.SeedSize)
	state, err := NewState("v3", ed25519.NewKeyFromSeed(seed).Public().(ed25519.PublicKey), receipt.CommitteePublicKey)
	if err != nil {
		t.Fatal(err)
	}
	state.AuthNetworkID, state.ChainID = receipt.AuthNetworkID, receipt.ChainID
	state.Auctions[receipt.AuctionID] = Auction{ID: receipt.AuctionID, Seller: strings.Repeat("f", 64),
		FundingMode: FundingModeThresholdSigAll, OriginalEndTime: originalEnd, EndTime: originalEnd, Status: "open"}
	contentBid := bidContent{AuctionID: receipt.AuctionID, Amount: receipt.BidAmount, IntegratedFunding: &receipt}
	if err := verifyIntegratedFundingReceipt(state, actorForKey(actor), receipt.AttestedAt, contentBid, receipt, DefaultPolicy()); err != nil {
		t.Fatalf("ordinary V3 receipt rejected: %v", err)
	}
	mutated := receipt
	mutated.PreparedBundleDigest = strings.Repeat("4", 64)
	if err := verifyIntegratedFundingReceipt(state, actorForKey(actor), receipt.AttestedAt, contentBid, mutated, DefaultPolicy()); err == nil {
		t.Fatal("V3 receipt with unsigned prepared bundle digest accepted")
	}
	mutated = receipt
	mutated.ActorFundingAuthorization = &SignedEvent{}
	if err := verifyIntegratedFundingReceipt(state, actorForKey(actor), receipt.AttestedAt, contentBid, mutated, DefaultPolicy()); err == nil {
		t.Fatal("V3 receipt with unsigned browser authorization accepted")
	}
}

func TestIntegratedFundingV4BrowserGolden(t *testing.T) {
	encoded, err := os.ReadFile("../../cashu-wrapper/fixtures/integrated-funding-v4-browser-golden.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Receipt       IntegratedFundingReceipt `json:"receipt"`
		ReceiptDigest string                   `json:"receiptDigest"`
	}
	if err := json.Unmarshal(encoded, &fixture); err != nil {
		t.Fatal(err)
	}
	if err := verifyIntegratedFundingV4Authorization(fixture.Receipt, fixture.Receipt.Bidder); err != nil {
		t.Fatalf("Go rejected frozen V4 browser authorization: %v", err)
	}
	bundle := integratedFundingBundleDigest(fixture.Receipt)
	if got := hex.EncodeToString(bundle[:]); got != fixture.Receipt.BundleDigest {
		t.Fatalf("bundle=%s want=%s", got, fixture.Receipt.BundleDigest)
	}
	digest := integratedFundingReceiptDigest(fixture.Receipt)
	if got := hex.EncodeToString(digest[:]); got != fixture.ReceiptDigest {
		t.Fatalf("receipt=%s want=%s", got, fixture.ReceiptDigest)
	}
}

func TestIntegratedFundingAdmissionSignatureDigestGolden(t *testing.T) {
	t.Parallel()
	encoded, err := os.ReadFile("../../cashu-wrapper/fixtures/admission-signature-domain-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Schema                  string `json:"schema"`
		Domain                  string `json:"domain_utf8"`
		ReceiptDigest           string `json:"receipt_digest"`
		ParticipantPolicyDigest string `json:"participant_policy_digest"`
		SignatureDigest         string `json:"signature_digest"`
	}
	if err := json.Unmarshal(encoded, &fixture); err != nil {
		t.Fatal(err)
	}
	if fixture.Schema != "CocoDemoFrostAdmissionSignatureGoldenV1" || fixture.Domain != "COCO_DEMO_FROST_ADMISSION_SIGNATURE_V1" {
		t.Fatalf("unexpected admission signature fixture identity: %+v", fixture)
	}
	receiptBytes, err := hex.DecodeString(fixture.ReceiptDigest)
	if err != nil || len(receiptBytes) != 32 {
		t.Fatalf("invalid receipt digest fixture: %v", err)
	}
	var receiptDigest [32]byte
	copy(receiptDigest[:], receiptBytes)
	policyDigest, err := hex.DecodeString(fixture.ParticipantPolicyDigest)
	if err != nil || len(policyDigest) != 32 {
		t.Fatalf("invalid participant policy digest fixture: %v", err)
	}
	got := integratedFundingAdmissionSignatureDigestFromDigests(receiptDigest, policyDigest)
	if hex.EncodeToString(got[:]) != fixture.SignatureDigest {
		t.Fatalf("cross-language admission digest=%x want=%s", got, fixture.SignatureDigest)
	}
}

// TestExternalRustAdmissionVector is intentionally opt-in because its vector
// contains a fresh, throwaway Rust FROST signature produced by three distinct
// participant processes.  The Bun interoperability gate writes the vector,
// sets POC_RUST_ADMISSION_VECTOR, and invokes this test so the full Go
// admission policy—not merely a shared digest fixture—accepts that signature.
func TestExternalRustAdmissionVector(t *testing.T) {
	path := os.Getenv("POC_RUST_ADMISSION_VECTOR")
	if path == "" {
		t.Skip("POC_RUST_ADMISSION_VECTOR is not set")
	}
	encoded, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var vector struct {
		Schema          string                   `json:"schema"`
		Actor           string                   `json:"actor"`
		CommittedAt     int64                    `json:"committed_at"`
		OriginalEndTime int64                    `json:"original_end_time"`
		Receipt         IntegratedFundingReceipt `json:"receipt"`
	}
	if err := json.Unmarshal(encoded, &vector); err != nil {
		t.Fatal(err)
	}
	if vector.Schema != "CocoDemoRustToGoAdmissionVectorV1" || vector.CommittedAt <= 0 || vector.OriginalEndTime <= vector.CommittedAt {
		t.Fatalf("malformed external admission vector header: %+v", vector)
	}
	seed := make([]byte, ed25519.SeedSize)
	state, err := NewState("rust-admission-vector", ed25519.NewKeyFromSeed(seed).Public().(ed25519.PublicKey), vector.Receipt.CommitteePublicKey)
	if err != nil {
		t.Fatal(err)
	}
	state.AuthNetworkID = vector.Receipt.AuthNetworkID
	state.ChainID = vector.Receipt.ChainID
	state.Auctions[vector.Receipt.AuctionID] = Auction{
		ID: vector.Receipt.AuctionID, Seller: strings.Repeat("f", 64), Title: "Rust admission vector",
		FundingMode: FundingModeThresholdSigAll, StartingBid: 1, MinIncrement: DefaultPolicy().MinBidIncrement,
		CreatedAt: vector.CommittedAt - 1, OriginalEndTime: vector.OriginalEndTime,
		EndTime: vector.OriginalEndTime, Status: "open",
	}
	content := bidContent{
		AuctionID: vector.Receipt.AuctionID, Amount: vector.Receipt.BidAmount,
		ReplacesBidID: vector.Receipt.ReplacesBidID, IntegratedFunding: &vector.Receipt,
	}
	if err := verifyIntegratedFundingReceipt(state, vector.Actor, vector.CommittedAt, content, vector.Receipt, DefaultPolicy()); err != nil {
		t.Fatalf("Go rejected the exact Rust threshold admission signature: %v", err)
	}
	mutated := vector.Receipt
	if mutated.CommitteeSignature[len(mutated.CommitteeSignature)-1] == '0' {
		mutated.CommitteeSignature = mutated.CommitteeSignature[:len(mutated.CommitteeSignature)-1] + "1"
	} else {
		mutated.CommitteeSignature = mutated.CommitteeSignature[:len(mutated.CommitteeSignature)-1] + "0"
	}
	content.IntegratedFunding = &mutated
	if err := verifyIntegratedFundingReceipt(state, vector.Actor, vector.CommittedAt, content, mutated, DefaultPolicy()); err == nil {
		t.Fatal("Go accepted a mutated Rust threshold admission signature")
	}
}

func testReservationReceipt(t *testing.T, committee *btcec.PrivateKey, auctionID, bidder string, amount int64, id, replaces string, expiresAt int64) CustodyReservationReceipt {
	t.Helper()
	receipt := CustodyReservationReceipt{
		Schema: "PlebeianAuctionsPOCCustodyReservationV1", MintURL: CashuMintURL,
		AuctionID: auctionID, Bidder: bidder, Amount: amount, ReservationID: id,
		ReplacesReservationID: replaces, ExpiresAt: expiresAt,
		CommitteePublicKey: hex.EncodeToString(committee.PubKey().SerializeCompressed()),
	}
	digest := custodyReservationDigest(receipt)
	signature, err := schnorr.Sign(committee, digest[:])
	if err != nil {
		t.Fatal(err)
	}
	receipt.Signature = hex.EncodeToString(signature.Serialize())
	return receipt
}

func markLegacyAuction(state *State, id string) {
	auction := state.Auctions[id]
	auction.FundingMode = FundingModeLegacy
	state.Auctions[id] = auction
}

func testPrivateKey(t *testing.T) *btcec.PrivateKey {
	t.Helper()
	key, err := btcec.NewPrivateKey()
	if err != nil {
		t.Fatal(err)
	}
	return key
}

func testEvenPrivateKey(t *testing.T) *btcec.PrivateKey {
	t.Helper()
	for {
		key := testPrivateKey(t)
		if key.PubKey().SerializeCompressed()[0] == 0x02 {
			return key
		}
	}
}

func testEvent(t *testing.T, key *btcec.PrivateKey, createdAt int64, kind int, content any) SignedEvent {
	t.Helper()
	raw, err := json.Marshal(content)
	if err != nil {
		t.Fatal(err)
	}
	event, err := SignNostrEvent(key, createdAt, kind, nil, string(raw))
	if err != nil {
		t.Fatal(err)
	}
	return event
}

func onlySpendableNote(t *testing.T, state State, actor string) Note {
	t.Helper()
	view, err := state.View(actor)
	if err != nil {
		t.Fatal(err)
	}
	if len(view.Wallet.Notes) != 1 {
		t.Fatalf("spendable notes = %d, want 1", len(view.Wallet.Notes))
	}
	return view.Wallet.Notes[0]
}
