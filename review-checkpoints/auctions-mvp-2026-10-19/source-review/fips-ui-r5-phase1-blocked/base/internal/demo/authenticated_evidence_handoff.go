package demo

import (
	"bytes"
	"context"
	"crypto/hmac"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"crypto/sha256"
	"crypto/sha512"
	"encoding/base64"
	"encoding/binary"
	"github.com/PlebeianApp/market/services/auction-consensus/internal/app"
	"github.com/PlebeianApp/market/services/auction-consensus/internal/auction"
	"github.com/PlebeianApp/market/services/auction-consensus/internal/bidauth"
	"github.com/btcsuite/btcd/btcec/v2"
	"github.com/btcsuite/btcd/btcec/v2/schnorr"
	abci "github.com/cometbft/cometbft/abci/types"
)

const (
	AuthenticatedHandoffSchema          = "OwnerLocalR4AuthenticatedApplicationHandoffV2"
	SignedEventExportSchema             = "OwnerLocalR4SignedEventExportV1"
	PaymentApprovalSchema               = "DemoPaymentApprovalV1"
	PaymentApprovalKind          uint16 = 28643
	MaxAuthenticatedHandoffBytes        = 2 * 1024 * 1024
)

// SignedEventExport is the exact, raw NIP-01 event export produced by
// auction-signed-event-tool. SignedEvent remains raw JSON so verification does
// not normalize or substitute any event field before the exact batch join.
type SignedEventExport struct {
	Schema        string                    `json:"schema"`
	AuthNetworkID string                    `json:"auth_network_id"`
	ChainID       string                    `json:"chain_id"`
	AuctionID     string                    `json:"auction_id"`
	Records       []SignedEventExportRecord `json:"records"`
}

type SignedEventExportRecord struct {
	CommittedEventID string          `json:"committed_event_id"`
	SignedEvent      json.RawMessage `json:"signed_event"`
}

// PaymentApprovalV1 mirrors the frozen UI payment-approval boundary. It is a
// bidder's second BIP-340 authorization over exact payment parameters. It is
// not a Cashu proof, mint response, validator authorization, or settlement.
type PaymentApprovalV1 struct {
	Schema               string `json:"schema"`
	AuthNetworkID        string `json:"authNetworkId"`
	ChainID              string `json:"chainId"`
	AuctionID            string `json:"auctionId"`
	OperationID          string `json:"operationId"`
	BidID                string `json:"bidId"`
	BidEventID           string `json:"bidEventId"`
	BidderActorID        string `json:"bidderActorId"`
	Amount               int64  `json:"amount"`
	MintURL              string `json:"mintUrl"`
	SellerP2PKXPub       string `json:"sellerP2pkXpub"`
	SellerDerivationPath string `json:"sellerDerivationPath"`
	SellerRecipient      string `json:"sellerRecipient"`
	RefundRecipient      string `json:"refundRecipient"`
	ConditionFingerprint string `json:"conditionFingerprint"`
	WinnerPackageDigest  string `json:"winnerPackageDigest"`
	RefundPackageDigest  string `json:"refundPackageDigest"`
	ApprovalCreatedAt    int64  `json:"approvalCreatedAt"`
	ApprovalEventID      string `json:"approvalEventId"`
	ApprovalSignature    string `json:"approvalSignature"`
}

type paymentApprovalContent struct {
	Schema               string `json:"schema"`
	AuthNetworkID        string `json:"auth_network_id"`
	ChainID              string `json:"chain_id"`
	AuctionID            string `json:"auction_id"`
	OperationID          string `json:"operation_id"`
	BidID                string `json:"bid_id"`
	BidEventID           string `json:"bid_event_id"`
	Amount               int64  `json:"amount"`
	MintURL              string `json:"mint_url"`
	SellerP2PKXPub       string `json:"seller_p2pk_xpub"`
	SellerDerivationPath string `json:"seller_derivation_path"`
	SellerRecipient      string `json:"seller_recipient"`
	RefundRecipient      string `json:"refund_recipient"`
	ConditionFingerprint string `json:"condition_fingerprint"`
	WinnerPackageDigest  string `json:"winner_package_digest"`
	RefundPackageDigest  string `json:"refund_package_digest"`
}

type AuthenticatedApplicationHandoff struct {
	Schema                         string `json:"schema"`
	Ready                          bool   `json:"ready"`
	SessionID                      string `json:"session_id"`
	AuthNetworkID                  string `json:"auth_network_id"`
	ChainID                        string `json:"chain_id"`
	AuctionID                      string `json:"auction_id"`
	ClosureHeight                  int64  `json:"closure_height"`
	ClosureAppHash                 string `json:"closure_app_hash"`
	ClaimedSlots                   []int  `json:"claimed_slots"`
	SuccessorCommitVerified        bool   `json:"successor_commit_verified"`
	AuthenticatedReplayVerified    bool   `json:"authenticated_replay_verified"`
	RawSignedEventsVerified        int    `json:"raw_signed_events_verified"`
	BidderPaymentApprovalsVerified int    `json:"bidder_payment_approvals_verified"`
	CanonicalBatchHistorySHA256    string `json:"canonical_batch_history_sha256"`
	VerifiedApprovalSetSHA256      string `json:"verified_approval_set_sha256"`
	ApprovalLifetimePolicyVerified bool   `json:"approval_lifetime_policy_verified"`
	CollectorIndependenceProven    bool   `json:"collector_independence_proven"`
	PaymentExecutionVerified       bool   `json:"payment_execution_verified"`
	SettlementVerified             bool   `json:"settlement_verified"`
	Warning                        string `json:"warning"`
}

type committedBidAtHeight struct {
	entry       app.CommittedBidEntry
	pbtsSeconds int64
}

// VerifyAuthenticatedApplicationHandoff verifies an offline, immutable
// application handoff. Storage V2 is deliberately outside this boundary: the
// caller supplies frozen files/fixtures and receives no persistence claim.
func VerifyAuthenticatedApplicationHandoff(approvedSessionRaw, approvedAuthGenesisRaw []byte, evidences []AuthenticatedEvidence, batches []app.CommittedAuctionBatchV2, signedExport SignedEventExport, acceptedSellerP2PKXPub string, approvals []PaymentApprovalV1) (AuthenticatedApplicationHandoff, error) {
	agreement, err := CompareAuthenticatedEvidence(approvedSessionRaw, approvedAuthGenesisRaw, evidences)
	if err != nil {
		return AuthenticatedApplicationHandoff{}, fmt.Errorf("four-slot authenticated evidence: %w", err)
	}
	var genesis AuthenticatedGenesis
	if err := DecodeStrictJSON(approvedAuthGenesisRaw, MaxAuthenticatedGenesisBytes, &genesis); err != nil {
		return AuthenticatedApplicationHandoff{}, fmt.Errorf("authenticated genesis: %w", err)
	}
	profile, _, err := genesis.Build()
	if err != nil {
		return AuthenticatedApplicationHandoff{}, fmt.Errorf("authenticated genesis: %w", err)
	}
	bids, closure, err := verifyHandoffBatches(agreement, batches)
	if err != nil {
		return AuthenticatedApplicationHandoff{}, err
	}
	if err := verifyHandoffBatchesAgainstReplay(genesis, evidences[0], batches); err != nil {
		return AuthenticatedApplicationHandoff{}, err
	}
	signedEvents, err := verifySignedEventExport(agreement, profile, bids, signedExport)
	if err != nil {
		return AuthenticatedApplicationHandoff{}, err
	}
	if err := verifyPaymentApprovals(agreement, evidences[0].Session, bids, signedEvents, acceptedSellerP2PKXPub, approvals); err != nil {
		return AuthenticatedApplicationHandoff{}, err
	}
	batchCommitment, err := canonicalBatchHistorySHA256(batches)
	if err != nil {
		return AuthenticatedApplicationHandoff{}, err
	}
	approvalCommitment, err := canonicalApprovalSetSHA256(approvals)
	if err != nil {
		return AuthenticatedApplicationHandoff{}, err
	}
	return AuthenticatedApplicationHandoff{
		Schema: AuthenticatedHandoffSchema, Ready: false, SessionID: agreement.SessionID,
		AuthNetworkID: agreement.AuthNetworkID, ChainID: agreement.ChainID, AuctionID: agreement.AuctionID,
		ClosureHeight: closure.Height, ClosureAppHash: closure.AppHash, ClaimedSlots: append([]int(nil), agreement.ClaimedSlots...),
		SuccessorCommitVerified: true, AuthenticatedReplayVerified: agreement.AuthenticatedReplayVerified,
		RawSignedEventsVerified: len(bids), BidderPaymentApprovalsVerified: len(approvals),
		CanonicalBatchHistorySHA256: batchCommitment, VerifiedApprovalSetSHA256: approvalCommitment,
		ApprovalLifetimePolicyVerified: false,
		CollectorIndependenceProven:    false, PaymentExecutionVerified: false, SettlementVerified: false,
		Warning: "offline authenticated handoff only; approval lifetime policy is absent so payment continuation is not ready; collector independence, Cashu execution, mint behavior, validator payment authorization, and settlement are not proven",
	}, nil
}

func verifyHandoffBatchesAgainstReplay(genesis AuthenticatedGenesis, evidence AuthenticatedEvidence, supplied []app.CommittedAuctionBatchV2) error {
	replayRoot, err := os.MkdirTemp("", "auction-auth-handoff-replay.")
	if err != nil {
		return err
	}
	defer os.RemoveAll(replayRoot)
	application, store, err := OpenAuthenticatedApplication(genesis, filepath.Join(replayRoot, "state.wal"))
	if err != nil {
		return fmt.Errorf("open handoff replay: %w", err)
	}
	defer store.Close()
	genesisRaw, err := json.Marshal(genesis)
	if err != nil {
		return err
	}
	if _, err := application.InitChain(context.Background(), &abci.InitChainRequest{InitialHeight: 1, AppStateBytes: genesisRaw}); err != nil {
		return fmt.Errorf("handoff InitChain replay: %w", err)
	}
	for index := int64(0); index < evidence.TargetHeight; index++ {
		block, err := decodeBlockProof(evidence.Blocks[index])
		if err != nil {
			return fmt.Errorf("handoff block %d: %w", index+1, err)
		}
		txs := make([][]byte, len(block.Data.Txs))
		for txIndex := range block.Data.Txs {
			txs[txIndex] = []byte(block.Data.Txs[txIndex])
		}
		response, err := application.FinalizeBlock(context.Background(), &abci.FinalizeBlockRequest{Height: index + 1, Time: block.Time, Txs: txs})
		if err != nil {
			return fmt.Errorf("handoff replay height %d: %w", index+1, err)
		}
		for txIndex, result := range response.TxResults {
			if result == nil || result.Code != 0 {
				return fmt.Errorf("handoff replay height %d transaction %d rejected", index+1, txIndex)
			}
		}
		if _, err := application.Commit(context.Background(), &abci.CommitRequest{}); err != nil {
			return fmt.Errorf("handoff replay commit height %d: %w", index+1, err)
		}
	}
	replayed := store.CommittedBatches()
	if len(replayed) != len(supplied) {
		return errors.New("authenticated replay outbox length does not match supplied batches")
	}
	for index := range replayed {
		actual, err := replayed[index].CanonicalBytes()
		if err != nil {
			return err
		}
		candidate, err := supplied[index].CanonicalBytes()
		if err != nil {
			return err
		}
		if !bytes.Equal(actual, candidate) {
			return fmt.Errorf("supplied committed batch height %d does not match authenticated replay outbox", index+1)
		}
	}
	return nil
}

func verifyHandoffBatches(agreement AuthenticatedEvidenceAgreement, batches []app.CommittedAuctionBatchV2) ([]committedBidAtHeight, app.CommittedAutomaticCloseEntry, error) {
	if int64(len(batches)) != agreement.TargetHeight {
		return nil, app.CommittedAutomaticCloseEntry{}, fmt.Errorf("committed batch history count %d does not cover exact heights 1..%d", len(batches), agreement.TargetHeight)
	}
	bids := make([]committedBidAtHeight, 0)
	seenOperations := make(map[string]struct{})
	seenBids := make(map[string]struct{})
	seenEvents := make(map[string]struct{})
	var closure app.CommittedAutomaticCloseEntry
	closureCount := 0
	for index, batch := range batches {
		height := int64(index + 1)
		if err := batch.Validate(); err != nil {
			return nil, app.CommittedAutomaticCloseEntry{}, fmt.Errorf("committed batch height %d: %w", height, err)
		}
		if batch.Height != height || batch.AuthNetworkID != agreement.AuthNetworkID || batch.ChainID != agreement.ChainID {
			return nil, app.CommittedAutomaticCloseEntry{}, fmt.Errorf("committed batch height %d domain or sequence mismatch", height)
		}
		if height == agreement.TargetHeight && batch.AppHash != agreement.TargetAppHash {
			return nil, app.CommittedAutomaticCloseEntry{}, errors.New("target committed batch app hash does not match four-slot evidence")
		}
		for _, entry := range batch.Bids {
			if entry.AuctionID != agreement.AuctionID {
				continue
			}
			if _, exists := seenOperations[entry.OperationID]; exists {
				return nil, app.CommittedAutomaticCloseEntry{}, fmt.Errorf("conflicting committed operation %q", entry.OperationID)
			}
			if _, exists := seenBids[entry.BidID]; exists {
				return nil, app.CommittedAutomaticCloseEntry{}, fmt.Errorf("conflicting committed bid %q", entry.BidID)
			}
			if _, exists := seenEvents[entry.EventID]; exists {
				return nil, app.CommittedAutomaticCloseEntry{}, fmt.Errorf("conflicting committed event %q", entry.EventID)
			}
			seenOperations[entry.OperationID], seenBids[entry.BidID], seenEvents[entry.EventID] = struct{}{}, struct{}{}, struct{}{}
			bids = append(bids, committedBidAtHeight{entry: entry, pbtsSeconds: batch.PBTSSeconds})
		}
		for _, candidate := range batch.Closures {
			if candidate.AuctionID != agreement.AuctionID {
				continue
			}
			closureCount++
			closure = candidate
		}
	}
	if closureCount != 1 {
		return nil, app.CommittedAutomaticCloseEntry{}, fmt.Errorf("closure count %d, want exactly one", closureCount)
	}
	if closure.Height != agreement.TargetHeight || closure.AppHash != agreement.TargetAppHash {
		return nil, app.CommittedAutomaticCloseEntry{}, errors.New("closure does not exact-join the authenticated evidence target")
	}
	return bids, closure, nil
}

func verifySignedEventExport(agreement AuthenticatedEvidenceAgreement, profile bidauth.Profile, bids []committedBidAtHeight, exported SignedEventExport) (map[string]bidauth.SignedEvent, error) {
	if exported.Schema != SignedEventExportSchema || exported.AuthNetworkID != agreement.AuthNetworkID || exported.ChainID != agreement.ChainID || exported.AuctionID != agreement.AuctionID {
		return nil, errors.New("signed-event export schema or domain mismatch")
	}
	if len(exported.Records) != len(bids) {
		return nil, fmt.Errorf("signed-event export count %d does not equal committed bid count %d", len(exported.Records), len(bids))
	}
	verifiedEvents := make(map[string]bidauth.SignedEvent, len(bids))
	for index, committed := range bids {
		record := exported.Records[index]
		if record.CommittedEventID != committed.entry.EventID || !lowerHexExact(record.CommittedEventID, 32) {
			return nil, fmt.Errorf("signed-event record %d does not exact-join committed event", index+1)
		}
		signed, err := bidauth.DecodeBridgeJSON(record.SignedEvent, profile)
		if err != nil {
			return nil, fmt.Errorf("signed-event record %d: %w", index+1, err)
		}
		verified, err := bidauth.VerifyProfileBid(signed, profile, committed.pbtsSeconds, Policy(), bidauth.BTCECBIP340Verifier{})
		if err != nil {
			return nil, fmt.Errorf("signed-event record %d: %w", index+1, err)
		}
		command, err := auction.DecodeCommand(verified.CanonicalCommand(), Policy())
		if err != nil {
			return nil, fmt.Errorf("signed-event record %d command: %w", index+1, err)
		}
		verifiedEventID := verified.EventID()
		if hex.EncodeToString(verifiedEventID[:]) != committed.entry.EventID || verified.ActorID() != committed.entry.ActorID || command.OperationID != committed.entry.OperationID || command.AuctionID != committed.entry.AuctionID || command.BidID != committed.entry.BidID || command.Amount != committed.entry.Amount {
			return nil, fmt.Errorf("signed-event record %d conflicts with committed bid", index+1)
		}
		verifiedEvents[committed.entry.EventID] = signed
	}
	return verifiedEvents, nil
}

func verifyPaymentApprovals(agreement AuthenticatedEvidenceAgreement, session Session, bids []committedBidAtHeight, signedEvents map[string]bidauth.SignedEvent, acceptedSellerP2PKXPub string, approvals []PaymentApprovalV1) error {
	if len(approvals) != len(bids) {
		return fmt.Errorf("payment approval count %d does not equal committed bid count %d", len(approvals), len(bids))
	}
	validatorIdentities, err := normalizedValidatorIdentities(session)
	if err != nil {
		return err
	}
	byOperation := make(map[string]PaymentApprovalV1, len(approvals))
	seenEvents := make(map[string]struct{}, len(approvals))
	for index, approval := range approvals {
		if _, exists := byOperation[approval.OperationID]; exists {
			return fmt.Errorf("payment approval %d conflicts on operation %q", index+1, approval.OperationID)
		}
		if _, exists := seenEvents[approval.ApprovalEventID]; exists {
			return fmt.Errorf("payment approval %d duplicates approval event", index+1)
		}
		if err := verifyPaymentApprovalSignature(approval, acceptedSellerP2PKXPub, validatorIdentities); err != nil {
			return fmt.Errorf("payment approval %d: %w", index+1, err)
		}
		byOperation[approval.OperationID], seenEvents[approval.ApprovalEventID] = approval, struct{}{}
	}
	for _, committed := range bids {
		approval, exists := byOperation[committed.entry.OperationID]
		if !exists {
			return fmt.Errorf("payment approval missing for operation %q", committed.entry.OperationID)
		}
		if approval.AuthNetworkID != agreement.AuthNetworkID || approval.ChainID != agreement.ChainID || approval.AuctionID != agreement.AuctionID || approval.BidID != committed.entry.BidID || approval.BidEventID != committed.entry.EventID || approval.BidderActorID != committed.entry.ActorID || approval.Amount != committed.entry.Amount {
			return fmt.Errorf("payment approval conflicts with committed operation %q", committed.entry.OperationID)
		}
		signed, exists := signedEvents[committed.entry.EventID]
		if !exists || approval.ApprovalCreatedAt != signed.Event.CreatedAt {
			return fmt.Errorf("payment approval timestamp conflicts with raw signed event for operation %q", committed.entry.OperationID)
		}
	}
	return nil
}

func verifyPaymentApprovalSignature(approval PaymentApprovalV1, acceptedSellerP2PKXPub string, validatorIdentities map[string]struct{}) error {
	if approval.Schema != PaymentApprovalSchema || approval.ApprovalCreatedAt < 1 || approval.Amount < 1 || !lowerHexExact(approval.AuthNetworkID, 32) || !lowerHexExact(approval.BidEventID, 32) || !lowerHexExact(approval.BidderActorID, 32) || !lowerHexExact(approval.ConditionFingerprint, 32) || !lowerHexExact(approval.WinnerPackageDigest, 32) || !lowerHexExact(approval.RefundPackageDigest, 32) || !lowerHexExact(approval.ApprovalEventID, 32) || !lowerHexExact(approval.ApprovalSignature, 64) {
		return errors.New("payment approval has invalid schema, integer, or hexadecimal field")
	}
	for _, value := range []string{approval.ChainID, approval.AuctionID, approval.OperationID, approval.BidID, approval.MintURL, approval.SellerP2PKXPub, approval.SellerDerivationPath, approval.SellerRecipient, approval.RefundRecipient} {
		if value == "" || strings.TrimSpace(value) != value {
			return errors.New("payment approval has empty or non-canonical string")
		}
	}
	if acceptedSellerP2PKXPub == "" || strings.TrimSpace(acceptedSellerP2PKXPub) != acceptedSellerP2PKXPub || approval.SellerP2PKXPub != acceptedSellerP2PKXPub {
		return errors.New("payment approval seller xpub does not match accepted authority")
	}
	if approval.RefundRecipient != approval.BidderActorID {
		return errors.New("payment approval conflates bidder refund and seller recipient identities")
	}
	bidderIdentity, err := normalizeSecpIdentity(approval.BidderActorID)
	if err != nil {
		return errors.New("payment approval bidder identity is invalid")
	}
	sellerIdentity, err := normalizeSecpIdentity(approval.SellerRecipient)
	if err != nil {
		return errors.New("payment approval seller recipient is invalid")
	}
	if sellerIdentity == bidderIdentity {
		return errors.New("payment approval seller recipient aliases bidder identity")
	}
	if _, exists := validatorIdentities[sellerIdentity]; exists {
		return errors.New("payment approval seller recipient aliases validator identity")
	}
	sellerRootIdentity, err := sellerXPubRootIdentity(approval.SellerP2PKXPub)
	if err != nil {
		return fmt.Errorf("payment approval seller xpub: %w", err)
	}
	if sellerRootIdentity == bidderIdentity {
		return errors.New("payment approval seller xpub aliases bidder identity")
	}
	if _, exists := validatorIdentities[sellerRootIdentity]; exists {
		return errors.New("payment approval seller xpub aliases validator identity")
	}
	derived, err := deriveSellerChildPublicKey(approval.SellerP2PKXPub, approval.SellerDerivationPath)
	if err != nil {
		return fmt.Errorf("payment approval seller derivation: %w", err)
	}
	if approval.SellerRecipient != derived {
		return errors.New("payment approval seller recipient does not match xpub/path derivation")
	}
	content, err := marshalCanonicalUTF8JSON(paymentApprovalContent{
		Schema: PaymentApprovalSchema, AuthNetworkID: approval.AuthNetworkID, ChainID: approval.ChainID,
		AuctionID: approval.AuctionID, OperationID: approval.OperationID, BidID: approval.BidID,
		BidEventID: approval.BidEventID, Amount: approval.Amount, MintURL: approval.MintURL,
		SellerP2PKXPub: approval.SellerP2PKXPub, SellerDerivationPath: approval.SellerDerivationPath,
		SellerRecipient: approval.SellerRecipient, RefundRecipient: approval.RefundRecipient,
		ConditionFingerprint: approval.ConditionFingerprint, WinnerPackageDigest: approval.WinnerPackageDigest,
		RefundPackageDigest: approval.RefundPackageDigest,
	})
	if err != nil {
		return err
	}
	var publicKey, eventID [32]byte
	var signature [64]byte
	if _, err := hex.Decode(publicKey[:], []byte(approval.BidderActorID)); err != nil {
		return err
	}
	if _, err := hex.Decode(eventID[:], []byte(approval.ApprovalEventID)); err != nil {
		return err
	}
	if _, err := hex.Decode(signature[:], []byte(approval.ApprovalSignature)); err != nil {
		return err
	}
	signed := bidauth.SignedEvent{
		Event: bidauth.UnsignedEvent{PublicKey: publicKey, CreatedAt: approval.ApprovalCreatedAt, Kind: PaymentApprovalKind, Tags: [][]string{{"protocol", "plebeian-auction-fake-ecash-payment"}, {"version", "1"}, {"environment", approval.AuthNetworkID}, {"bid_event", approval.BidEventID}}, Content: string(content)},
		ID:    eventID, Signature: signature,
	}
	if _, err := bidauth.VerifyEvent(signed, bidauth.EventLimitsForProfile(), bidauth.BTCECBIP340Verifier{}); err != nil {
		return fmt.Errorf("payment approval event: %w", err)
	}
	return nil
}

func canonicalBatchHistorySHA256(batches []app.CommittedAuctionBatchV2) (string, error) {
	var canonical bytes.Buffer
	canonical.WriteByte('[')
	for index, batch := range batches {
		if err := batch.Validate(); err != nil {
			return "", err
		}
		raw, err := marshalCanonicalUTF8JSON(batch)
		if err != nil {
			return "", err
		}
		if index > 0 {
			canonical.WriteByte(',')
		}
		canonical.Write(raw)
	}
	canonical.WriteByte(']')
	sum := sha256.Sum256(canonical.Bytes())
	return hex.EncodeToString(sum[:]), nil
}

func canonicalApprovalSetSHA256(approvals []PaymentApprovalV1) (string, error) {
	if approvals == nil {
		return "", errors.New("payment approval set must be an array")
	}
	ordered := append(make([]PaymentApprovalV1, 0, len(approvals)), approvals...)
	sort.Slice(ordered, func(left, right int) bool {
		leftKey := [4]string{ordered[left].AuthNetworkID, ordered[left].ChainID, ordered[left].AuctionID, ordered[left].OperationID}
		rightKey := [4]string{ordered[right].AuthNetworkID, ordered[right].ChainID, ordered[right].AuctionID, ordered[right].OperationID}
		for index := range leftKey {
			if leftKey[index] != rightKey[index] {
				return leftKey[index] < rightKey[index]
			}
		}
		return false
	})
	raw, err := marshalCanonicalUTF8JSON(ordered)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:]), nil
}

// marshalCanonicalUTF8JSON is the shared handoff JSON encoding contract. It
// emits UTF-8 JSON without HTML escaping, retains encoding/json's deterministic
// struct field order, and explicitly retains its U+2028/U+2029 escaping. The
// TypeScript peer mirrors these rules before hashing or signing.
func marshalCanonicalUTF8JSON(value any) ([]byte, error) {
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return nil, err
	}
	raw := buffer.Bytes()
	if len(raw) == 0 || raw[len(raw)-1] != '\n' {
		return nil, errors.New("canonical JSON encoder omitted record terminator")
	}
	return append([]byte(nil), raw[:len(raw)-1]...), nil
}

func normalizedValidatorIdentities(session Session) (map[string]struct{}, error) {
	identities := make(map[string]struct{}, len(session.Validators))
	for index, validator := range session.Validators {
		raw, err := base64.StdEncoding.DecodeString(validator.ValidatorPublicKey)
		if err != nil || len(raw) != 32 {
			return nil, fmt.Errorf("validator %d public identity is invalid", index+1)
		}
		identity := hex.EncodeToString(raw)
		if _, exists := identities[identity]; exists {
			return nil, errors.New("validator public identities are not distinct")
		}
		identities[identity] = struct{}{}
	}
	return identities, nil
}

// normalizeSecpIdentity compares BIP340 x-only and SEC compressed encodings by
// their curve-validated x coordinate. This prevents 02/03 aliases from
// bypassing cross-role separation checks.
func normalizeSecpIdentity(value string) (string, error) {
	if strings.ToLower(value) != value {
		return "", errors.New("identity is not lowercase")
	}
	raw, err := hex.DecodeString(value)
	if err != nil {
		return "", err
	}
	switch len(raw) {
	case 32:
		publicKey, err := schnorr.ParsePubKey(raw)
		if err != nil {
			return "", err
		}
		return hex.EncodeToString(schnorr.SerializePubKey(publicKey)), nil
	case 33:
		if raw[0] != 0x02 && raw[0] != 0x03 {
			return "", errors.New("compressed identity has invalid prefix")
		}
		publicKey, err := btcec.ParsePubKey(raw)
		if err != nil {
			return "", err
		}
		return hex.EncodeToString(schnorr.SerializePubKey(publicKey)), nil
	default:
		return "", errors.New("identity is neither x-only nor compressed")
	}
}

func decodeBase58Check(value string) ([]byte, error) {
	const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
	if value == "" || strings.TrimSpace(value) != value {
		return nil, errors.New("xpub is empty or non-canonical")
	}
	number := new(big.Int)
	base := big.NewInt(58)
	for _, character := range value {
		index := strings.IndexRune(alphabet, character)
		if index < 0 {
			return nil, errors.New("xpub is not base58")
		}
		number.Mul(number, base)
		number.Add(number, big.NewInt(int64(index)))
	}
	decoded := number.Bytes()
	leading := 0
	for leading < len(value) && value[leading] == '1' {
		leading++
	}
	decoded = append(make([]byte, leading), decoded...)
	if len(decoded) != 82 {
		return nil, fmt.Errorf("xpub decoded length %d, want 82", len(decoded))
	}
	first := sha256.Sum256(decoded[:78])
	second := sha256.Sum256(first[:])
	if !bytes.Equal(decoded[78:], second[:4]) {
		return nil, errors.New("xpub checksum mismatch")
	}
	return decoded[:78], nil
}

func parseSellerDerivationPath(path string) ([]uint32, error) {
	if path == "" || strings.TrimSpace(path) != path {
		return nil, errors.New("seller derivation path is empty or non-canonical")
	}
	body := path
	if strings.HasPrefix(body, "m/") || strings.HasPrefix(body, "M/") {
		body = body[2:]
	} else if body[0] < '0' || body[0] > '9' {
		return nil, errors.New("seller derivation path is malformed")
	}
	segments := strings.Split(body, "/")
	if len(segments) != 5 {
		return nil, errors.New("seller derivation path must contain five levels")
	}
	indices := make([]uint32, len(segments))
	for index, segment := range segments {
		if segment == "" || strings.ContainsAny(segment, "'hH") {
			return nil, errors.New("seller derivation path contains a hardened or empty level")
		}
		for _, character := range segment {
			if character < '0' || character > '9' {
				return nil, errors.New("seller derivation path contains a non-decimal level")
			}
		}
		parsed, err := strconv.ParseUint(segment, 10, 31)
		if err != nil {
			return nil, errors.New("seller derivation path level is out of range")
		}
		indices[index] = uint32(parsed)
	}
	return indices, nil
}

func deriveSellerChildPublicKey(xpub, path string) (string, error) {
	payload, err := decodeBase58Check(xpub)
	if err != nil {
		return "", err
	}
	version := binary.BigEndian.Uint32(payload[:4])
	if version != 0x0488b21e && version != 0x043587cf {
		return "", errors.New("seller extended key is not an xpub or tpub")
	}
	chainCode := append([]byte(nil), payload[13:45]...)
	publicKey := append([]byte(nil), payload[45:78]...)
	if _, err := btcec.ParsePubKey(publicKey); err != nil {
		return "", errors.New("seller xpub public key is invalid")
	}
	indices, err := parseSellerDerivationPath(path)
	if err != nil {
		return "", err
	}
	for _, index := range indices {
		data := make([]byte, 37)
		copy(data, publicKey)
		binary.BigEndian.PutUint32(data[33:], index)
		mac := hmac.New(sha512.New, chainCode)
		_, _ = mac.Write(data)
		digest := mac.Sum(nil)
		var tweak btcec.ModNScalar
		if tweak.SetByteSlice(digest[:32]) || tweak.IsZero() {
			return "", errors.New("seller child tweak is invalid")
		}
		parent, err := btcec.ParsePubKey(publicKey)
		if err != nil {
			return "", errors.New("seller parent public key is invalid")
		}
		var parentPoint, tweakPoint, childPoint btcec.JacobianPoint
		parent.AsJacobian(&parentPoint)
		btcec.ScalarBaseMultNonConst(&tweak, &tweakPoint)
		btcec.AddNonConst(&parentPoint, &tweakPoint, &childPoint)
		if childPoint.Z.IsZero() {
			return "", errors.New("seller child point is at infinity")
		}
		publicKey = btcec.JacobianToByteSlice(childPoint)
		chainCode = append(chainCode[:0], digest[32:]...)
	}
	return hex.EncodeToString(publicKey), nil
}

func sellerXPubRootIdentity(xpub string) (string, error) {
	payload, err := decodeBase58Check(xpub)
	if err != nil {
		return "", err
	}
	version := binary.BigEndian.Uint32(payload[:4])
	if version != 0x0488b21e && version != 0x043587cf {
		return "", errors.New("seller extended key is not an xpub or tpub")
	}
	return normalizeSecpIdentity(hex.EncodeToString(payload[45:78]))
}

func lowerHexExact(value string, bytes int) bool {
	if len(value) != bytes*2 || strings.ToLower(value) != value {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}

func DecodeAuthenticatedHandoffBatches(raw []byte) ([]app.CommittedAuctionBatchV2, error) {
	var batches []app.CommittedAuctionBatchV2
	if err := decodeStrictJSON(raw, MaxAuthenticatedHandoffBytes, &batches, map[string]int{"$": MaxEvidenceHeight}); err != nil {
		return nil, err
	}
	return batches, nil
}

func DecodeSignedEventExport(raw []byte) (SignedEventExport, error) {
	var exported SignedEventExport
	if err := DecodeStrictJSON(raw, MaxAuthenticatedHandoffBytes, &exported); err != nil {
		return SignedEventExport{}, err
	}
	return exported, nil
}

func DecodePaymentApprovals(raw []byte) ([]PaymentApprovalV1, error) {
	var approvals []PaymentApprovalV1
	if err := DecodeStrictJSON(raw, MaxAuthenticatedHandoffBytes, &approvals); err != nil {
		return nil, err
	}
	if approvals == nil {
		return nil, errors.New("payment approval set must be an array")
	}
	return approvals, nil
}
