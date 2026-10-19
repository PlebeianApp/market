package demo

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/PlebeianApp/market/services/auction-consensus/internal/app"
	"github.com/PlebeianApp/market/services/auction-consensus/internal/bidauth"
	"github.com/btcsuite/btcd/btcec/v2"
	"github.com/btcsuite/btcd/btcec/v2/schnorr"
	abci "github.com/cometbft/cometbft/abci/types"
)

type authenticatedHandoffFixture struct {
	sessionRaw []byte
	authRaw    []byte
	evidences  []AuthenticatedEvidence
	batches    []app.CommittedAuctionBatchV2
	exported   SignedEventExport
	approvals  []PaymentApprovalV1
}

const testSellerXPub = "xpub661MyMwAqRbcEtUEgdXRTY6dJQG9fRgs7C5QomqETKMYBJVtSGpRqyHSmhWy8snovPd5oWZgQ14zUquxbxu7Z1umuXbN5VDpUL1QobD5xUY"

func newAuthenticatedHandoffFixture(t *testing.T) authenticatedHandoffFixture {
	t.Helper()
	evidenceFixture := newAuthenticatedEvidenceFixtureWithEnd(t, 500)
	var genesis AuthenticatedGenesis
	if err := DecodeStrictJSON(evidenceFixture.authRaw, MaxAuthenticatedGenesisBytes, &genesis); err != nil {
		t.Fatal(err)
	}
	profile, _, err := genesis.Build()
	if err != nil {
		t.Fatal(err)
	}
	wire := signedRuntimeBid(t, genesis)
	application, store, err := OpenAuthenticatedApplication(genesis, filepath.Join(t.TempDir(), "state.wal"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := application.FinalizeBlock(context.Background(), &abci.FinalizeBlockRequest{Height: 1, Time: time.Unix(100, 0).UTC(), Txs: [][]byte{wire}}); err != nil {
		t.Fatal(err)
	}
	if _, err := application.Commit(context.Background(), &abci.CommitRequest{}); err != nil {
		t.Fatal(err)
	}
	if _, err := application.FinalizeBlock(context.Background(), &abci.FinalizeBlockRequest{Height: 2, Time: time.Unix(500, 0).UTC()}); err != nil {
		t.Fatal(err)
	}
	if _, err := application.Commit(context.Background(), &abci.CommitRequest{}); err != nil {
		t.Fatal(err)
	}
	batches := store.CommittedBatches()
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	signed, err := bidauth.DecodeWire(wire, profile)
	if err != nil {
		t.Fatal(err)
	}
	rawSigned, err := bidauth.EncodeBridgeJSON(signed, profile)
	if err != nil {
		t.Fatal(err)
	}
	eventID := hex.EncodeToString(signed.ID[:])
	exported := SignedEventExport{
		Schema: SignedEventExportSchema, AuthNetworkID: profile.NetworkHex(), ChainID: profile.ChainID,
		AuctionID: genesis.Auction.AuctionID,
		Records:   []SignedEventExportRecord{{CommittedEventID: eventID, SignedEvent: rawSigned}},
	}
	actorID := hex.EncodeToString(signed.Event.PublicKey[:])
	const sellerPath = "m/1/2/3/4/1"
	const sellerRecipient = "0351646c50019651bb5f5ceadaf2911df64f7172f20041e9c9846ab2a8b823c7e9"
	approval := PaymentApprovalV1{
		Schema: PaymentApprovalSchema, AuthNetworkID: profile.NetworkHex(), ChainID: profile.ChainID,
		AuctionID: genesis.Auction.AuctionID, OperationID: "runner-convergence-operation", BidID: "runner-convergence-bid",
		BidEventID: eventID, BidderActorID: actorID, Amount: genesis.Auction.StartingBid,
		MintURL: "https://mint.invalid", SellerP2PKXPub: testSellerXPub, SellerDerivationPath: sellerPath,
		SellerRecipient: sellerRecipient, RefundRecipient: actorID,
		ConditionFingerprint: strings.Repeat("a", 64), WinnerPackageDigest: strings.Repeat("b", 64), RefundPackageDigest: strings.Repeat("c", 64),
		ApprovalCreatedAt: signed.Event.CreatedAt,
	}
	approval = signPaymentApproval(t, approval)
	evidences := make([]AuthenticatedEvidence, 4)
	for index := range evidences {
		evidences[index] = cloneAuthenticatedEvidence(t, evidenceFixture.evidence)
		evidences[index].SourceSlot = index + 1
		evidences[index].SourceOperator = evidenceFixture.session.Validators[index].Operator
		evidences[index].SourceNodeID = evidenceFixture.session.Validators[index].NodeID
	}
	return authenticatedHandoffFixture{
		sessionRaw: evidenceFixture.sessionRaw, authRaw: evidenceFixture.authRaw, evidences: evidences,
		batches: batches, exported: exported, approvals: []PaymentApprovalV1{approval},
	}
}

func signPaymentApproval(t *testing.T, approval PaymentApprovalV1) PaymentApprovalV1 {
	t.Helper()
	content, err := json.Marshal(paymentApprovalContent{
		Schema: PaymentApprovalSchema, AuthNetworkID: approval.AuthNetworkID, ChainID: approval.ChainID,
		AuctionID: approval.AuctionID, OperationID: approval.OperationID, BidID: approval.BidID,
		BidEventID: approval.BidEventID, Amount: approval.Amount, MintURL: approval.MintURL,
		SellerP2PKXPub: approval.SellerP2PKXPub, SellerDerivationPath: approval.SellerDerivationPath,
		SellerRecipient: approval.SellerRecipient, RefundRecipient: approval.RefundRecipient,
		ConditionFingerprint: approval.ConditionFingerprint, WinnerPackageDigest: approval.WinnerPackageDigest,
		RefundPackageDigest: approval.RefundPackageDigest,
	})
	if err != nil {
		t.Fatal(err)
	}
	var publicKey [32]byte
	if _, err := hex.Decode(publicKey[:], []byte(approval.BidderActorID)); err != nil {
		t.Fatal(err)
	}
	approvalEvent := bidauth.UnsignedEvent{
		PublicKey: publicKey, CreatedAt: approval.ApprovalCreatedAt, Kind: PaymentApprovalKind,
		Tags: [][]string{{"protocol", "plebeian-auction-fake-ecash-payment"}, {"version", "1"}, {"environment", approval.AuthNetworkID}, {"bid_event", approval.BidEventID}}, Content: string(content),
	}
	approvalID, err := bidauth.ComputeEventID(approvalEvent, bidauth.EventLimitsForProfile())
	if err != nil {
		t.Fatal(err)
	}
	bidderPrivate, _ := btcec.PrivKeyFromBytes(bytes.Repeat([]byte{0x31}, 32))
	approvalSignature, err := schnorr.Sign(bidderPrivate, approvalID[:])
	if err != nil {
		t.Fatal(err)
	}
	approval.ApprovalEventID = hex.EncodeToString(approvalID[:])
	approval.ApprovalSignature = hex.EncodeToString(approvalSignature.Serialize())
	return approval
}

func newPaymentApprovalV2Fixture(t *testing.T) PaymentApprovalV2 {
	t.Helper()
	actorPrivate, actorPublic := btcec.PrivKeyFromBytes(bytes.Repeat([]byte{0x31}, 32))
	_, mainPublic := btcec.PrivKeyFromBytes(bytes.Repeat([]byte{0x41}, 32))
	_, refundPublic := btcec.PrivKeyFromBytes(bytes.Repeat([]byte{0x51}, 32))
	approval := PaymentApprovalV2{
		Schema: PaymentApprovalSchemaV2, AuthNetworkID: strings.Repeat("a", 64), ChainID: "chain-test",
		AuctionID: "auction-target", OperationID: "operation-target", BidID: "bid-target",
		BidEventID: strings.Repeat("b", 64), BidderActorID: hex.EncodeToString(schnorr.SerializePubKey(actorPublic)),
		BidderCashuPublicKey: hex.EncodeToString(mainPublic.SerializeCompressed()),
		RefundCashuPublicKey: hex.EncodeToString(refundPublic.SerializeCompressed()),
		RefundKeyVersion:     PaymentApprovalRefundKeyVersionV2, Amount: 2100, MintURL: "https://mint.invalid",
		SellerP2PKXPub: testSellerXPub, SellerDerivationPath: "m/1/2/3/4/1",
		SellerRecipientPublicKey: "0351646c50019651bb5f5ceadaf2911df64f7172f20041e9c9846ab2a8b823c7e9",
		ConditionFingerprint:     strings.Repeat("c", 64), WinnerPackageDigest: strings.Repeat("d", 64),
		RefundPackageDigest: strings.Repeat("e", 64), CloseTime: 200, SettlementWindowSeconds: 60,
		ValidUntil: 250, Locktime: 320, ApprovalLifetimePolicyVersion: PaymentApprovalLifetimePolicyV2,
		ApprovalCreatedAt: 100,
	}
	return signPaymentApprovalV2(t, approval, actorPrivate)
}

func signPaymentApprovalV2(t *testing.T, approval PaymentApprovalV2, privateKey *btcec.PrivateKey) PaymentApprovalV2 {
	t.Helper()
	content, err := marshalCanonicalUTF8JSON(paymentApprovalV2Content(approval))
	if err != nil {
		t.Fatal(err)
	}
	var publicKey [32]byte
	if _, err := hex.Decode(publicKey[:], []byte(approval.BidderActorID)); err != nil {
		t.Fatal(err)
	}
	event := bidauth.UnsignedEvent{
		PublicKey: publicKey, CreatedAt: approval.ApprovalCreatedAt, Kind: PaymentApprovalKind,
		Tags:    [][]string{{"protocol", "plebeian-auction-fake-ecash-payment"}, {"version", "2"}, {"environment", approval.AuthNetworkID}, {"bid_event", approval.BidEventID}},
		Content: string(content),
	}
	eventID, err := bidauth.ComputeEventID(event, bidauth.EventLimitsForProfile())
	if err != nil {
		t.Fatal(err)
	}
	signature, err := schnorr.Sign(privateKey, eventID[:])
	if err != nil {
		t.Fatal(err)
	}
	approval.ApprovalEventID = hex.EncodeToString(eventID[:])
	approval.ApprovalSignature = hex.EncodeToString(signature.Serialize())
	return approval
}

func TestPaymentApprovalV2EnvelopeAndLifetime(t *testing.T) {
	approval := newPaymentApprovalV2Fixture(t)
	digest, err := verifyPaymentApprovalV2Envelope(approval, testSellerXPub, map[string]struct{}{})
	if err != nil {
		t.Fatal(err)
	}
	if !lowerHexExact(digest, 32) {
		t.Fatalf("approval V2 digest is invalid: %q", digest)
	}
	if err := VerifyPaymentApprovalLifetimeV2(approval, 110, 120); err != nil {
		t.Fatalf("exact terminal-bound lifetime was rejected: %v", err)
	}
	for name, times := range map[string][2]int64{
		"bundle before approval":  {99, 120},
		"admission before bundle": {120, 119},
		"admission after close":   {110, 201},
	} {
		t.Run(name, func(t *testing.T) {
			if err := VerifyPaymentApprovalLifetimeV2(approval, times[0], times[1]); err == nil {
				t.Fatal("accepted invalid terminal-bound lifetime")
			}
		})
	}

	actorPrivate, _ := btcec.PrivKeyFromBytes(bytes.Repeat([]byte{0x31}, 32))
	tests := map[string]func(PaymentApprovalV2) PaymentApprovalV2{
		"V1 cannot enter V2": func(value PaymentApprovalV2) PaymentApprovalV2 { value.Schema = PaymentApprovalSchema; return value },
		"MAIN REFUND alias": func(value PaymentApprovalV2) PaymentApprovalV2 {
			value.RefundCashuPublicKey = value.BidderCashuPublicKey
			return signPaymentApprovalV2(t, value, actorPrivate)
		},
		"non-origin mint URL": func(value PaymentApprovalV2) PaymentApprovalV2 {
			value.MintURL += "/"
			return signPaymentApprovalV2(t, value, actorPrivate)
		},
		"noncanonical path": func(value PaymentApprovalV2) PaymentApprovalV2 {
			value.SellerDerivationPath = "m/01/2/3/4/1"
			return signPaymentApprovalV2(t, value, actorPrivate)
		},
		"signature drift": func(value PaymentApprovalV2) PaymentApprovalV2 { value.Amount++; return value },
		"intrinsic lifetime": func(value PaymentApprovalV2) PaymentApprovalV2 {
			value.Locktime = 319
			return signPaymentApprovalV2(t, value, actorPrivate)
		},
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			if _, err := verifyPaymentApprovalV2Envelope(mutate(approval), testSellerXPub, map[string]struct{}{}); err == nil {
				t.Fatal("accepted invalid payment approval V2")
			}
		})
	}
}

func TestPaymentApprovalV2SetAndStrictCodec(t *testing.T) {
	first := newPaymentApprovalV2Fixture(t)
	actorPrivate, _ := btcec.PrivKeyFromBytes(bytes.Repeat([]byte{0x31}, 32))
	second := first
	second.OperationID = "operation-z"
	second.BidID = "bid-z"
	second.BidEventID = strings.Repeat("f", 64)
	second = signPaymentApprovalV2(t, second, actorPrivate)

	forward, err := verifiedPaymentApprovalSetSHA256V2([]PaymentApprovalV2{first, second}, testSellerXPub, map[string]struct{}{})
	if err != nil {
		t.Fatal(err)
	}
	reverse, err := verifiedPaymentApprovalSetSHA256V2([]PaymentApprovalV2{second, first}, testSellerXPub, map[string]struct{}{})
	if err != nil || forward != reverse || !lowerHexExact(forward, 32) {
		t.Fatalf("approval V2 set order was not canonical: forward=%s reverse=%s err=%v", forward, reverse, err)
	}
	if _, err := verifiedPaymentApprovalSetSHA256V2([]PaymentApprovalV2{first, first}, testSellerXPub, map[string]struct{}{}); err == nil {
		t.Fatal("accepted duplicate ApprovalV2 identity/digest")
	}
	raw, err := marshalCanonicalUTF8JSON([]PaymentApprovalV2{first})
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := DecodePaymentApprovalsV2(raw)
	if err != nil || len(decoded) != 1 || decoded[0].ApprovalEventID != first.ApprovalEventID {
		t.Fatalf("strict ApprovalV2 codec drifted: value=%#v err=%v", decoded, err)
	}
	for _, malformed := range []string{"null", `[{"schema":"DemoPaymentApprovalV2","schema":"DemoPaymentApprovalV2"}]`, `[{"schema":"DemoPaymentApprovalV2","extra":true}]`} {
		if _, err := DecodePaymentApprovalsV2([]byte(malformed)); err == nil {
			t.Fatalf("strict ApprovalV2 codec accepted %s", malformed)
		}
	}
}

func TestAuthenticatedApplicationHandoffVerifiesExactOfflineBoundary(t *testing.T) {
	fixture := newAuthenticatedHandoffFixture(t)
	receipt, err := VerifyAuthenticatedApplicationHandoff(fixture.sessionRaw, fixture.authRaw, fixture.evidences, fixture.batches, fixture.exported, testSellerXPub, fixture.approvals)
	if err != nil {
		t.Fatal(err)
	}
	if receipt.Ready || receipt.ApprovalLifetimePolicyVerified || receipt.ClosureHeight != 2 || receipt.RawSignedEventsVerified != 1 || receipt.BidderPaymentApprovalsVerified != 1 || !receipt.SuccessorCommitVerified || !receipt.AuthenticatedReplayVerified {
		t.Fatalf("unexpected handoff receipt: %+v", receipt)
	}
	if !lowerHexExact(receipt.CanonicalBatchHistorySHA256, 32) || !lowerHexExact(receipt.VerifiedApprovalSetSHA256, 32) {
		t.Fatalf("handoff commitments missing: %+v", receipt)
	}
	if receipt.PaymentExecutionVerified || receipt.SettlementVerified || receipt.CollectorIndependenceProven {
		t.Fatalf("offline receipt overclaimed external behavior: %+v", receipt)
	}
}

func TestPaymentApprovalAuthorityAliasesAndDerivationFailClosed(t *testing.T) {
	t.Run("unaccepted seller xpub", func(t *testing.T) {
		fixture := newAuthenticatedHandoffFixture(t)
		_, err := VerifyAuthenticatedApplicationHandoff(fixture.sessionRaw, fixture.authRaw, fixture.evidences, fixture.batches, fixture.exported, "unaccepted-xpub", fixture.approvals)
		if err == nil || !strings.Contains(err.Error(), "does not match accepted authority") {
			t.Fatalf("unaccepted seller xpub was not rejected: %v", err)
		}
	})
	t.Run("approval timestamp differs from raw bid", func(t *testing.T) {
		fixture := newAuthenticatedHandoffFixture(t)
		fixture.approvals[0].ApprovalCreatedAt++
		fixture.approvals[0] = signPaymentApproval(t, fixture.approvals[0])
		_, err := VerifyAuthenticatedApplicationHandoff(fixture.sessionRaw, fixture.authRaw, fixture.evidences, fixture.batches, fixture.exported, testSellerXPub, fixture.approvals)
		if err == nil || !strings.Contains(err.Error(), "timestamp conflicts with raw signed event") {
			t.Fatalf("approval timestamp drift was not rejected: %v", err)
		}
	})
	t.Run("compressed bidder alias", func(t *testing.T) {
		fixture := newAuthenticatedHandoffFixture(t)
		fixture.approvals[0].SellerRecipient = "02" + fixture.approvals[0].BidderActorID
		fixture.approvals[0] = signPaymentApproval(t, fixture.approvals[0])
		_, err := VerifyAuthenticatedApplicationHandoff(fixture.sessionRaw, fixture.authRaw, fixture.evidences, fixture.batches, fixture.exported, testSellerXPub, fixture.approvals)
		if err == nil || !strings.Contains(err.Error(), "aliases bidder identity") {
			t.Fatalf("bidder alias was not rejected by role: %v", err)
		}
	})
	t.Run("compressed validator alias", func(t *testing.T) {
		fixture := newAuthenticatedHandoffFixture(t)
		var session Session
		if err := DecodeStrictJSON(fixture.sessionRaw, MaxSessionBytes, &session); err != nil {
			t.Fatal(err)
		}
		alias := ""
		for _, validator := range session.Validators {
			raw, err := base64.StdEncoding.DecodeString(validator.ValidatorPublicKey)
			if err != nil {
				t.Fatal(err)
			}
			for _, prefix := range []string{"02", "03"} {
				candidate := prefix + hex.EncodeToString(raw)
				if _, err := btcec.ParsePubKey(mustDecodeHex(t, candidate)); err == nil {
					alias = candidate
					break
				}
			}
			if alias != "" {
				break
			}
		}
		if alias == "" {
			t.Skip("fixture validator x coordinates are not secp256k1 points")
		}
		fixture.approvals[0].SellerRecipient = alias
		fixture.approvals[0] = signPaymentApproval(t, fixture.approvals[0])
		_, err := VerifyAuthenticatedApplicationHandoff(fixture.sessionRaw, fixture.authRaw, fixture.evidences, fixture.batches, fixture.exported, testSellerXPub, fixture.approvals)
		if err == nil || !strings.Contains(err.Error(), "aliases validator identity") {
			t.Fatalf("validator alias was not rejected by role: %v", err)
		}
	})
	t.Run("wrong seller derivation", func(t *testing.T) {
		fixture := newAuthenticatedHandoffFixture(t)
		fixture.approvals[0].SellerDerivationPath = "m/1/2/3/4/2"
		fixture.approvals[0] = signPaymentApproval(t, fixture.approvals[0])
		_, err := VerifyAuthenticatedApplicationHandoff(fixture.sessionRaw, fixture.authRaw, fixture.evidences, fixture.batches, fixture.exported, testSellerXPub, fixture.approvals)
		if err == nil || !strings.Contains(err.Error(), "does not match xpub/path derivation") {
			t.Fatalf("wrong seller derivation was not rejected: %v", err)
		}
	})
}

func mustDecodeHex(t *testing.T, value string) []byte {
	t.Helper()
	raw, err := hex.DecodeString(value)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestAuthenticatedHandoffCommitmentsMatchFrozenCrossRuntimeVectors(t *testing.T) {
	encoded, err := marshalCanonicalUTF8JSON(struct {
		Value string `json:"value"`
	}{Value: "&<>\"\\\u2028\u2029"})
	if err != nil {
		t.Fatal(err)
	}
	if string(encoded) != `{"value":"&<>\"\\\u2028\u2029"}` {
		t.Fatalf("canonical JSON escaping drifted: %s", encoded)
	}
	var highSurrogate, lowSurrogate, validPair struct {
		Value string `json:"value"`
	}
	if err := json.Unmarshal([]byte(`{"value":"\ud800"}`), &highSurrogate); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(`{"value":"\udc00"}`), &lowSurrogate); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(`{"value":"\ud83d\ude00"}`), &validPair); err != nil {
		t.Fatal(err)
	}
	replacement := struct {
		Value string `json:"value"`
	}{Value: "\ufffd"}
	replacementEncoded, err := marshalCanonicalUTF8JSON(replacement)
	if err != nil {
		t.Fatal(err)
	}
	for name, value := range map[string]any{"high": highSurrogate, "low": lowSurrogate} {
		got, encodeErr := marshalCanonicalUTF8JSON(value)
		if encodeErr != nil {
			t.Fatal(encodeErr)
		}
		if !bytes.Equal(got, replacementEncoded) {
			t.Fatalf("%s lone surrogate did not canonicalize as U+FFFD: %q != %q", name, got, replacementEncoded)
		}
	}
	pairEncoded, err := marshalCanonicalUTF8JSON(validPair)
	if err != nil {
		t.Fatal(err)
	}
	if validPair.Value != "😀" || bytes.Equal(pairEncoded, replacementEncoded) {
		t.Fatalf("valid surrogate pair did not remain its scalar: value=%q encoded=%q", validPair.Value, pairEncoded)
	}

	batchDigest, err := canonicalBatchHistorySHA256([]app.CommittedAuctionBatchV2{{
		Schema: app.CommittedAuctionBatchSchema, AuthProfile: bidauth.DemoAuthProfile,
		AuthNetworkID: strings.Repeat("a", 64), ChainID: "chain", Height: 1, PBTSSeconds: 10,
		AppHash: strings.Repeat("b", 64), Bids: []app.CommittedBidEntry{},
		Closures: []app.CommittedAutomaticCloseEntry{{
			AuthNetworkID: strings.Repeat("a", 64), ChainID: "chain", AuctionID: "auction",
			Height: 1, PBTSSeconds: 10, EffectiveEnd: 10, AppHash: strings.Repeat("b", 64), CloseOutcome: "no_bids",
		}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if batchDigest != "ec2e8619dc571e6e194062c28ba29622b8e2250856fa59e654458bebeebebd5d" {
		t.Fatalf("cross-runtime batch commitment drifted: %s", batchDigest)
	}
	emptyApprovalDigest, err := canonicalApprovalSetSHA256([]PaymentApprovalV1{})
	if err != nil {
		t.Fatal(err)
	}
	if emptyApprovalDigest != "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945" {
		t.Fatalf("empty approval set for no-bid history encoded other than []: %s", emptyApprovalDigest)
	}
	if _, err := canonicalApprovalSetSHA256(nil); err == nil {
		t.Fatal("accepted a null top-level approval set")
	}
	decodedEmptyApprovals, err := DecodePaymentApprovals([]byte(`[]`))
	if err != nil || decodedEmptyApprovals == nil || len(decodedEmptyApprovals) != 0 {
		t.Fatalf("explicit empty approval array was not retained: value=%#v err=%v", decodedEmptyApprovals, err)
	}
	if _, err := DecodePaymentApprovals([]byte(`null`)); err == nil {
		t.Fatal("decoded a null top-level approval set")
	}
	approvalDigest, err := canonicalApprovalSetSHA256([]PaymentApprovalV1{{
		Schema: PaymentApprovalSchema, AuthNetworkID: strings.Repeat("a", 64), ChainID: "chain", AuctionID: "auction",
		OperationID: "operation", BidID: "bid", BidEventID: strings.Repeat("b", 64), BidderActorID: strings.Repeat("c", 64),
		Amount: 13, MintURL: "https://mint.invalid", SellerP2PKXPub: "xpub", SellerDerivationPath: "m/1/2/3/4/5",
		SellerRecipient: "02" + strings.Repeat("d", 64), RefundRecipient: strings.Repeat("c", 64), ConditionFingerprint: strings.Repeat("e", 64),
		WinnerPackageDigest: strings.Repeat("f", 64), RefundPackageDigest: strings.Repeat("1", 64), ApprovalCreatedAt: 10,
		ApprovalEventID: strings.Repeat("2", 64), ApprovalSignature: strings.Repeat("3", 128),
	}})
	if err != nil {
		t.Fatal(err)
	}
	if approvalDigest != "2fa364730573ff4f5bf85ab13deed30d4f6a452c0ab290bf54f98f7045ad9d7a" {
		t.Fatalf("cross-runtime approval commitment drifted: %s", approvalDigest)
	}

	networkID := strings.Repeat("a", 64)
	appHash := strings.Repeat("b", 64)
	actor1, event1 := strings.Repeat("c", 64), strings.Repeat("d", 64)
	actor2, event2 := strings.Repeat("e", 64), strings.Repeat("f", 64)
	chainID := `Chain&<>"\Case-Z_!`
	winnerAuction, noBidsAuction, reserveAuction := "auction-&-winner", "auction-<-no_bids", "auction->-reserve"
	complexBatchDigest, err := canonicalBatchHistorySHA256([]app.CommittedAuctionBatchV2{{
		Schema: app.CommittedAuctionBatchSchema, AuthProfile: bidauth.DemoAuthProfile,
		AuthNetworkID: networkID, ChainID: chainID, Height: 1, PBTSSeconds: 10, AppHash: appHash,
		Bids: []app.CommittedBidEntry{
			{ActorID: actor1, OperationID: `Op-Z&<>"\!`, AuctionID: winnerAuction, BidID: `Bid-Z"\<>`, EventID: event1, Amount: 13},
			{ActorID: actor2, OperationID: "op/a?Case", AuctionID: reserveAuction, BidID: "bid_2", EventID: event2, Amount: 7},
		},
		Closures: []app.CommittedAutomaticCloseEntry{
			{AuthNetworkID: networkID, ChainID: chainID, AuctionID: winnerAuction, Height: 1, PBTSSeconds: 10, EffectiveEnd: 10, AppHash: appHash, CloseOutcome: "winner", WinnerBidID: `Bid-Z"\<>`, WinnerActorID: actor1, WinnerOperationID: `Op-Z&<>"\!`, Amount: 13},
			{AuthNetworkID: networkID, ChainID: chainID, AuctionID: noBidsAuction, Height: 1, PBTSSeconds: 10, EffectiveEnd: 10, AppHash: appHash, CloseOutcome: "no_bids"},
			{AuthNetworkID: networkID, ChainID: chainID, AuctionID: reserveAuction, Height: 1, PBTSSeconds: 10, EffectiveEnd: 10, AppHash: appHash, CloseOutcome: "reserve_not_met"},
		},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if complexBatchDigest != "eb1f649a897e3978fefe0e4fbc0f89f9e993cd99325db6c173d699ef83f37aac" {
		t.Fatalf("complex cross-runtime batch commitment drifted: %s", complexBatchDigest)
	}

	approval := func(index int, operationID, bidID, eventID, actorID string) PaymentApprovalV1 {
		digit := func(offset int, length int) string { return strings.Repeat(string(rune('0'+index+offset)), length) }
		return PaymentApprovalV1{
			Schema: PaymentApprovalSchema, AuthNetworkID: networkID, ChainID: chainID, AuctionID: winnerAuction,
			OperationID: operationID, BidID: bidID, BidEventID: eventID, BidderActorID: actorID, Amount: int64(10 + index),
			MintURL: `https://mint.invalid/a?x=&<>"\`, SellerP2PKXPub: `xpub&<>"\Case`, SellerDerivationPath: fmt.Sprintf("m/1/2/3/4/%d", index),
			SellerRecipient: "02" + strings.Repeat(fmt.Sprintf("%d", index), 64), RefundRecipient: actorID,
			ConditionFingerprint: digit(1, 64), WinnerPackageDigest: digit(2, 64), RefundPackageDigest: digit(3, 64),
			ApprovalCreatedAt: int64(10 + index), ApprovalEventID: digit(4, 64), ApprovalSignature: digit(5, 128),
		}
	}
	complexApprovalDigest, err := canonicalApprovalSetSHA256([]PaymentApprovalV1{
		approval(3, "op/case", "bid/3", strings.Repeat("3", 64), strings.Repeat("6", 64)),
		approval(1, `Op-Z&<>"\!`, `Bid-Z"\<>`, event1, actor1),
		approval(2, "op!case", "bid!2", strings.Repeat("2", 64), strings.Repeat("5", 64)),
	})
	if err != nil {
		t.Fatal(err)
	}
	if complexApprovalDigest != "94b358f062a9a2ff39289b00cd4cb94c04e77dd6151ffbf8c4986264d5b4b533" {
		t.Fatalf("complex cross-runtime approval commitment drifted: %s", complexApprovalDigest)
	}
}

func TestAuthenticatedApplicationHandoffFailsClosedOnMissingOrConflictingInputs(t *testing.T) {
	tests := map[string]func(*authenticatedHandoffFixture){
		"missing closure": func(value *authenticatedHandoffFixture) { value.batches[1].Closures = nil },
		"conflicting closure": func(value *authenticatedHandoffFixture) {
			value.batches[1].Closures = append(value.batches[1].Closures, value.batches[1].Closures[0])
		},
		"committed outbox differs from replay": func(value *authenticatedHandoffFixture) { value.batches[0].Bids[0].Amount++ },
		"missing raw signed event":             func(value *authenticatedHandoffFixture) { value.exported.Records = nil },
		"conflicting raw signed event": func(value *authenticatedHandoffFixture) {
			value.exported.Records[0].CommittedEventID = strings.Repeat("f", 64)
		},
		"missing payment approval":     func(value *authenticatedHandoffFixture) { value.approvals = nil },
		"conflicting payment approval": func(value *authenticatedHandoffFixture) { value.approvals[0].Amount++ },
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			fixture := newAuthenticatedHandoffFixture(t)
			mutate(&fixture)
			if _, err := VerifyAuthenticatedApplicationHandoff(fixture.sessionRaw, fixture.authRaw, fixture.evidences, fixture.batches, fixture.exported, testSellerXPub, fixture.approvals); err == nil {
				t.Fatal("accepted incomplete or conflicting handoff")
			}
		})
	}
}
