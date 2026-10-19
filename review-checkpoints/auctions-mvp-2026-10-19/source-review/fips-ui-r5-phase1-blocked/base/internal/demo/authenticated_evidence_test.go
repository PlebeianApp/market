package demo

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/PlebeianApp/market/services/auction-consensus/internal/auction"
	"github.com/PlebeianApp/market/services/auction-consensus/internal/bidauth"
	abci "github.com/cometbft/cometbft/abci/types"
	cmted25519 "github.com/cometbft/cometbft/crypto/ed25519"
	cmttypes "github.com/cometbft/cometbft/types"
)

type authenticatedEvidenceFixture struct {
	evidence   AuthenticatedEvidence
	session    Session
	sessionRaw []byte
	authRaw    []byte
}

func newAuthenticatedEvidenceFixture(t *testing.T) authenticatedEvidenceFixture {
	return newAuthenticatedEvidenceFixtureWithEnd(t, 102)
}

func newAuthenticatedEvidenceFixtureWithEnd(t *testing.T, baseEnd int64) authenticatedEvidenceFixture {
	t.Helper()
	operators := []string{"maxime", "hezron", "chiefmonkey", "diego"}
	validators := make([]ValidatorSpec, 4)
	privateKeys := make(map[string]cmted25519.PrivKey, 4)
	for index := range validators {
		validatorKey := cmted25519.GenPrivKeyFromSecret([]byte(fmt.Sprintf("PUBLIC TEST ONLY/auth-evidence/validator/%d", index+1)))
		nodeKey := cmted25519.GenPrivKeyFromSecret([]byte(fmt.Sprintf("PUBLIC TEST ONLY/auth-evidence/node/%d", index+1)))
		identity := publicIdentity(validatorKey.PubKey().Bytes(), nodeKey.PubKey().Bytes())
		validators[index] = ValidatorSpec{
			Slot: index + 1, Operator: operators[index], Moniker: "auth-proof-" + operators[index], Power: 1,
			ValidatorPublicKey: identity.ValidatorPublicKey, ValidatorAddress: identity.ValidatorAddress,
			NodePublicKey: identity.NodePublicKey, NodeID: identity.NodeID,
			P2PListen: "tcp://0.0.0.0:26656", P2PExternal: fmt.Sprintf("tcp://192.0.2.%d:26656", index+1),
			RPCListen: "tcp://127.0.0.1:26657",
		}
		privateKeys[identity.ValidatorAddress] = validatorKey
	}
	session, err := FinalizeSession(Session{
		SchemaVersion: SessionSchemaVersion, Profile: ProfileID,
		SessionID: "auth-proof-test", ChainID: ProfileID + "-auth-proof-test",
		GenesisTime: "1970-01-01T00:01:40Z", NetworkMode: NetworkExplicit, NetworkPacket: "public-test-auth-evidence-packet",
		Validators: validators,
	})
	if err != nil {
		t.Fatal(err)
	}
	sessionRaw, err := json.Marshal(session)
	if err != nil {
		t.Fatal(err)
	}
	sessionRaw = append(sessionRaw, '\n')
	_, sessionSHA, err := exactSessionBinding(sessionRaw)
	if err != nil {
		t.Fatal(err)
	}
	genesis := AuthenticatedGenesis{
		AuthProfile: bidauth.DemoAuthProfile, AuthNetworkID: strings.Repeat("12", 32), ChainID: session.ChainID,
		AuthenticatedBidActivationHeight: bidauth.DemoActivationHeight, AuthMaxLifetimeSeconds: bidauth.DemoMaxLifetime,
		Auction: GenesisAuction{AuctionID: "authenticated-proof-auction", SellerID: "public-test-seller", CreatedSeconds: 1, BaseEnd: baseEnd, StartingBid: 100, Reserve: 0, AdvertisedIncrement: 10},
	}
	authRaw, err := json.Marshal(genesis)
	if err != nil {
		t.Fatal(err)
	}
	authRaw = append(authRaw, '\n')
	_, authSHA, combinedSHA, err := authenticatedGenesisBinding(session, authRaw)
	if err != nil {
		t.Fatal(err)
	}
	validatorSet, err := authenticatedValidatorSet(session)
	if err != nil {
		t.Fatal(err)
	}
	cometGenesis, _, err := session.BuildGenesis()
	if err != nil {
		t.Fatal(err)
	}
	_, initialState, err := genesis.Build()
	if err != nil {
		t.Fatal(err)
	}
	initialHash, err := auction.CanonicalHash(initialState, Policy())
	if err != nil {
		t.Fatal(err)
	}
	bid := signedRuntimeBid(t, genesis)
	application, store, err := OpenAuthenticatedApplication(genesis, filepath.Join(t.TempDir(), "state.wal"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	first, err := application.FinalizeBlock(context.Background(), &abci.FinalizeBlockRequest{Height: 1, Time: time.Unix(100, 0).UTC(), Txs: [][]byte{bid}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := application.Commit(context.Background(), &abci.CommitRequest{}); err != nil {
		t.Fatal(err)
	}
	second, err := application.FinalizeBlock(context.Background(), &abci.FinalizeBlockRequest{Height: 2, Time: time.Unix(baseEnd, 0).UTC()})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := application.Commit(context.Background(), &abci.CommitRequest{}); err != nil {
		t.Fatal(err)
	}
	b1 := signedFixtureBlock(session, cometGenesis.ConsensusParams.Hash(), validatorSet, 1, time.Unix(100, 0).UTC(), cmttypes.Txs{cmttypes.Tx(bid)}, &cmttypes.Commit{}, cmttypes.BlockID{}, initialHash[:])
	id1 := blockIDForTest(t, b1)
	commit1 := signedCommitForTest(t, session, validatorSet, privateKeys, id1, 1, time.Unix(100, 500_000_000).UTC())
	b2 := signedFixtureBlock(session, cometGenesis.ConsensusParams.Hash(), validatorSet, 2, time.Unix(baseEnd, 0).UTC(), nil, commit1, id1, first.AppHash)
	id2 := blockIDForTest(t, b2)
	commit2 := signedCommitForTest(t, session, validatorSet, privateKeys, id2, 2, time.Unix(baseEnd, 500_000_000).UTC())
	b3 := signedFixtureBlock(session, cometGenesis.ConsensusParams.Hash(), validatorSet, 3, time.Unix(baseEnd+1, 0).UTC(), nil, commit2, id2, second.AppHash)
	id3 := blockIDForTest(t, b3)
	commit3 := signedCommitForTest(t, session, validatorSet, privateKeys, id3, 3, time.Unix(baseEnd+1, 500_000_000).UTC())
	summary, err := session.Validate()
	if err != nil {
		t.Fatal(err)
	}
	evidence := AuthenticatedEvidence{
		Schema: AuthenticatedEvidenceSchemaName, SchemaVersion: AuthenticatedEvidenceSchemaVersion, Complete: true,
		Session: session, SessionBase64: base64.StdEncoding.EncodeToString(sessionRaw), SessionSHA256: sessionSHA,
		PolicySHA256:               summary.PolicySHA256,
		AuthenticatedGenesisBase64: base64.StdEncoding.EncodeToString(authRaw), AuthenticatedGenesisSHA256: authSHA, CombinedGenesisSHA256: combinedSHA,
		SourceSlot: 1, SourceOperator: session.Validators[0].Operator, SourceNodeID: session.Validators[0].NodeID,
		TargetHeight: 2, Blocks: []BlockProof{blockProofForTest(t, b1, id1), blockProofForTest(t, b2, id2), blockProofForTest(t, b3, id3)},
		SuccessorCommitProto: commitProtoForTest(t, commit3), CollectedAt: "1970-01-01T00:01:44Z", Warning: "PUBLIC TEST ONLY",
	}
	return authenticatedEvidenceFixture{evidence: evidence, session: session, sessionRaw: sessionRaw, authRaw: authRaw}
}

func cloneAuthenticatedEvidence(t *testing.T, value AuthenticatedEvidence) AuthenticatedEvidence {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var clone AuthenticatedEvidence
	if err := decodeStrictJSON(raw, MaxEvidenceBytes, &clone, map[string]int{"$.blocks": MaxEvidenceHeight}); err != nil {
		t.Fatal(err)
	}
	return clone
}

func TestAuthenticatedEvidenceVerifiesReplayAndFourSlotAgreement(t *testing.T) {
	fixture := newAuthenticatedEvidenceFixture(t)
	verified, err := VerifyAuthenticatedEvidenceAgainst(fixture.evidence, fixture.sessionRaw, fixture.authRaw)
	if err != nil {
		t.Fatal(err)
	}
	if !verified.AuthenticatedReplay || !verified.NostrSignaturesVerified || verified.TargetHeight != 2 || len(verified.TargetAppHash) != 64 {
		t.Fatalf("unexpected verification: %+v", verified)
	}
	values := make([]AuthenticatedEvidence, 4)
	for index := range values {
		values[index] = cloneAuthenticatedEvidence(t, fixture.evidence)
		values[index].SourceSlot = index + 1
		values[index].SourceOperator = fixture.session.Validators[index].Operator
		values[index].SourceNodeID = fixture.session.Validators[index].NodeID
	}
	agreement, err := CompareAuthenticatedEvidence(fixture.sessionRaw, fixture.authRaw, values)
	if err != nil {
		t.Fatal(err)
	}
	if !agreement.Agreement || !agreement.AuthenticatedReplayVerified || !agreement.NostrSignaturesVerified || fmt.Sprint(agreement.ClaimedSlots) != "[1 2 3 4]" {
		t.Fatalf("unexpected agreement: %+v", agreement)
	}
}

func TestAuthenticatedEvidenceRejectsGenesisBlockAndSlotTampering(t *testing.T) {
	fixture := newAuthenticatedEvidenceFixture(t)
	changedGenesis := append([]byte(nil), fixture.authRaw...)
	changedGenesis[len(changedGenesis)-2] ^= 1
	if _, err := VerifyAuthenticatedEvidenceAgainst(fixture.evidence, fixture.sessionRaw, changedGenesis); err == nil {
		t.Fatal("accepted changed external authenticated genesis")
	}
	changedSession, err := json.MarshalIndent(fixture.session, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	changedSession = append(changedSession, '\n')
	if _, err := VerifyAuthenticatedEvidenceAgainst(fixture.evidence, changedSession, fixture.authRaw); err == nil {
		t.Fatal("accepted byte-distinct semantically identical external session")
	}
	tamperedBlock := cloneAuthenticatedEvidence(t, fixture.evidence)
	block, err := base64.StdEncoding.Strict().DecodeString(tamperedBlock.Blocks[0].BlockProto)
	if err != nil {
		t.Fatal(err)
	}
	block[len(block)-1] ^= 1
	tamperedBlock.Blocks[0].BlockProto = base64.StdEncoding.EncodeToString(block)
	if _, err := VerifyAuthenticatedEvidenceAgainst(tamperedBlock, fixture.sessionRaw, fixture.authRaw); err == nil {
		t.Fatal("accepted tampered block protobuf")
	}
	values := []AuthenticatedEvidence{fixture.evidence, fixture.evidence, fixture.evidence, fixture.evidence}
	if _, err := CompareAuthenticatedEvidence(fixture.sessionRaw, fixture.authRaw, values); err == nil {
		t.Fatal("accepted duplicate source slots")
	}
	tamperedChecksum := cloneAuthenticatedEvidence(t, fixture.evidence)
	tamperedChecksum.AuthenticatedGenesisSHA256 = strings.Repeat("0", 64)
	if _, err := VerifyAuthenticatedEvidenceAgainst(tamperedChecksum, fixture.sessionRaw, fixture.authRaw); err == nil {
		t.Fatal("accepted tampered authenticated genesis checksum")
	}
}
