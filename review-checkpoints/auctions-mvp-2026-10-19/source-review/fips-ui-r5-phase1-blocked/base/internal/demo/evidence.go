package demo

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/PlebeianApp/market/services/auction-consensus/internal/app"
	"github.com/PlebeianApp/market/services/auction-consensus/internal/auction"
	cmtproto "github.com/cometbft/cometbft/api/cometbft/types/v1"
	cmted25519 "github.com/cometbft/cometbft/crypto/ed25519"
	rpchttp "github.com/cometbft/cometbft/rpc/client/http"
	coretypes "github.com/cometbft/cometbft/rpc/core/types"
	jsonrpcclient "github.com/cometbft/cometbft/rpc/jsonrpc/client"
	cmttypes "github.com/cometbft/cometbft/types"
)

const (
	SyntheticSeller = "synthetic:ASSERTED_UNAUTHENTICATED:seller"
	SyntheticBidder = "synthetic:ASSERTED_UNAUTHENTICATED:bidder"
	EvidenceSchema  = 2
)

var ErrEvidenceIncomplete = errors.New("portable evidence is incomplete")

type RPC interface {
	Status(context.Context) (*coretypes.ResultStatus, error)
	Block(context.Context, *int64) (*coretypes.ResultBlock, error)
	Commit(context.Context, *int64) (*coretypes.ResultCommit, error)
	BroadcastTxCommit(context.Context, cmttypes.Tx) (*coretypes.ResultBroadcastTxCommit, error)
}

type DriveResult struct {
	SessionID    string `json:"session_id"`
	CreateHeight int64  `json:"create_height"`
	BidHeight    int64  `json:"bid_height"`
	TargetHeight int64  `json:"target_height"`
}

// Evidence carries all consensus material needed for offline verification.
// Source fields are collector claims matched to Session, not cryptographic
// proof that four physical computers produced four files.
type Evidence struct {
	SchemaVersion        int          `json:"schema_version"`
	Complete             bool         `json:"complete"`
	IncompleteReason     string       `json:"incomplete_reason"`
	Session              Session      `json:"session"`
	PolicySHA256         string       `json:"policy_sha256"`
	SourceSlot           int          `json:"source_slot"`
	SourceOperator       string       `json:"source_operator"`
	SourceNodeID         string       `json:"source_node_id"`
	TargetHeight         int64        `json:"target_height"`
	Blocks               []BlockProof `json:"blocks"`
	SuccessorCommitProto string       `json:"successor_commit_proto_base64"`
	CollectedAt          string       `json:"collected_at"`
	Warning              string       `json:"warning"`
}

type BlockProof struct {
	Height     int64           `json:"height"`
	BlockID    PortableBlockID `json:"block_id"`
	BlockProto string          `json:"block_proto_base64"`
}

type PortableBlockID struct {
	HashHex        string `json:"hash_hex"`
	PartSetTotal   uint32 `json:"part_set_total"`
	PartSetHashHex string `json:"part_set_hash_hex"`
}

type EvidenceVerification struct {
	SessionID        string `json:"session_id"`
	ChainID          string `json:"chain_id"`
	TargetHeight     int64  `json:"target_height"`
	TargetBlockID    string `json:"target_block_id"`
	TargetAppHash    string `json:"target_app_hash"`
	SuccessorHeight  int64  `json:"successor_height"`
	SuccessorBlockID string `json:"successor_block_id"`
	CommitSignatures int    `json:"successor_commit_signatures"`
}

type EvidenceAgreement struct {
	Agreement                   bool   `json:"agreement"`
	SessionID                   string `json:"session_id"`
	ChainID                     string `json:"chain_id"`
	TargetHeight                int64  `json:"target_height"`
	TargetBlockID               string `json:"target_block_id"`
	TargetAppHash               string `json:"target_app_hash"`
	ClaimedSlots                []int  `json:"claimed_slots"`
	CollectorProvenanceVerified bool   `json:"collector_provenance_verified"`
	Warning                     string `json:"warning"`
}

func ValidateNetworkAction(session Session, slot int, packetID, acknowledgement string) (ValidatorSpec, error) {
	if _, err := session.Validate(); err != nil {
		return ValidatorSpec{}, err
	}
	if session.NetworkMode != NetworkExplicit {
		return ValidatorSpec{}, errors.New("session network remains off")
	}
	if packetID == "" || packetID != session.NetworkPacket {
		return ValidatorSpec{}, errors.New("network packet acknowledgement does not match session")
	}
	if acknowledgement != RunAcknowledgement {
		return ValidatorSpec{}, errors.New("exact one-shot synthetic demo acknowledgement is required")
	}
	return session.Validator(slot)
}

func DemoTransactions(session Session) (create, bid []byte, err error) {
	policy := Policy()
	prefix := session.SessionID
	createPayload, err := auction.EncodeCommand(auction.Command{
		Version: auction.CommandVersion, Kind: auction.CommandCreate,
		OperationID: "demo-create-" + prefix, AuctionID: "demo-auction-" + prefix,
		BaseEnd:     math.MaxInt64 - policy.MaxTotalExtensionSeconds,
		StartingBid: 100, Reserve: 0, AdvertisedIncrement: 10,
	}, policy)
	if err != nil {
		return nil, nil, err
	}
	create, err = app.EncodeEnvelope(SyntheticSeller, createPayload, policy)
	if err != nil {
		return nil, nil, err
	}
	bidPayload, err := auction.EncodeCommand(auction.Command{
		Version: auction.CommandVersion, Kind: auction.CommandBid,
		OperationID: "demo-bid-" + prefix, AuctionID: "demo-auction-" + prefix,
		BidID: "demo-bid-" + prefix, Amount: 125,
		Reservations: []auction.ReservationInput{{ReservationID: "demo-reservation-" + prefix, Amount: 125}},
	}, policy)
	if err != nil {
		return nil, nil, err
	}
	bid, err = app.EncodeEnvelope(SyntheticBidder, bidPayload, policy)
	if err != nil {
		return nil, nil, err
	}
	return create, bid, nil
}

// Drive submits exactly one synthetic create followed by one synthetic bid.
func Drive(ctx context.Context, rpc RPC, session Session) (DriveResult, error) {
	create, bid, err := DemoTransactions(session)
	if err != nil {
		return DriveResult{}, err
	}
	createResult, err := rpc.BroadcastTxCommit(ctx, cmttypes.Tx(create))
	if err != nil {
		return DriveResult{}, fmt.Errorf("broadcast create: %w", err)
	}
	if err := validateBroadcast("create", createResult); err != nil {
		return DriveResult{}, err
	}
	bidResult, err := rpc.BroadcastTxCommit(ctx, cmttypes.Tx(bid))
	if err != nil {
		return DriveResult{}, fmt.Errorf("broadcast bid: %w", err)
	}
	if err := validateBroadcast("bid", bidResult); err != nil {
		return DriveResult{}, err
	}
	if bidResult.Height < createResult.Height {
		return DriveResult{}, errors.New("bid committed before create")
	}
	return DriveResult{SessionID: session.SessionID, CreateHeight: createResult.Height, BidHeight: bidResult.Height, TargetHeight: bidResult.Height}, nil
}

func validateBroadcast(name string, result *coretypes.ResultBroadcastTxCommit) error {
	if result == nil {
		return fmt.Errorf("%s broadcast returned nil", name)
	}
	if result.CheckTx.Code != 0 || result.TxResult.Code != 0 || result.Height < 1 {
		return fmt.Errorf("%s broadcast rejected at height %d: check=%d/%q deliver=%d/%q", name, result.Height, result.CheckTx.Code, result.CheckTx.Log, result.TxResult.Code, result.TxResult.Log)
	}
	return nil
}

func CollectEvidence(ctx context.Context, rpc RPC, session Session, slot int, target int64, now time.Time) (Evidence, error) {
	if target < 1 || target >= MaxEvidenceHeight {
		return Evidence{}, fmt.Errorf("target height %d outside 1..%d (one signed successor is mandatory)", target, MaxEvidenceHeight-1)
	}
	summary, err := session.Validate()
	if err != nil {
		return Evidence{}, err
	}
	validator, err := session.Validator(slot)
	if err != nil {
		return Evidence{}, err
	}
	evidence := Evidence{
		SchemaVersion: EvidenceSchema, Session: session, PolicySHA256: summary.PolicySHA256,
		SourceSlot: slot, SourceOperator: validator.Operator, SourceNodeID: validator.NodeID,
		TargetHeight: target, CollectedAt: now.UTC().Format(time.RFC3339Nano),
		Warning: "synthetic ASSERTED_UNAUTHENTICATED memory-only proof; collector provenance and physical failure domains are not verified",
	}
	status, err := rpc.Status(ctx)
	if err != nil {
		return Evidence{}, fmt.Errorf("status: %w", err)
	}
	if status == nil || status.NodeInfo.Network != session.ChainID {
		return Evidence{}, errors.New("RPC status chain id does not match session")
	}
	if string(status.NodeInfo.DefaultNodeID) != strings.ToLower(validator.NodeID) {
		return Evidence{}, errors.New("RPC status node id does not match requested slot")
	}
	successor := target + 1
	canonicalAt := successor + 1
	if status.SyncInfo.LatestBlockHeight < canonicalAt {
		evidence.IncompleteReason = fmt.Sprintf("latest height %d is below height %d required to canonicalize the height %d commit", status.SyncInfo.LatestBlockHeight, canonicalAt, successor)
		return evidence, fmt.Errorf("%w: %s", ErrEvidenceIncomplete, evidence.IncompleteReason)
	}
	evidence.Blocks = make([]BlockProof, 0, successor)
	totalTransactions, totalTransactionBytes, totalProtoBytes := 0, int64(0), int64(0)
	for height := int64(1); height <= successor; height++ {
		result, err := rpc.Block(ctx, &height)
		if err != nil {
			return Evidence{}, fmt.Errorf("block %d: %w", height, err)
		}
		if result == nil || result.Block == nil || result.Block.Height != height {
			return Evidence{}, fmt.Errorf("block response does not contain exact height %d", height)
		}
		if err := validateRPCBlockID(result.BlockID, result.Block); err != nil {
			return Evidence{}, fmt.Errorf("block %d: %w", height, err)
		}
		for _, transaction := range result.Block.Data.Txs {
			totalTransactions++
			totalTransactionBytes += int64(len(transaction))
			if totalTransactions > MaxEvidenceTxs || totalTransactionBytes > MaxEvidenceTxBytes {
				return Evidence{}, errors.New("evidence transaction bounds exceeded")
			}
		}
		protoBlock, err := result.Block.ToProto()
		if err != nil {
			return Evidence{}, fmt.Errorf("encode block %d: %w", height, err)
		}
		raw, err := protoBlock.Marshal()
		if err != nil {
			return Evidence{}, fmt.Errorf("marshal block %d: %w", height, err)
		}
		totalProtoBytes += int64(len(raw))
		if totalProtoBytes > MaxEvidenceProtoBytes {
			return Evidence{}, errors.New("evidence protobuf bounds exceeded")
		}
		evidence.Blocks = append(evidence.Blocks, BlockProof{Height: height, BlockID: portableBlockID(result.BlockID), BlockProto: base64.StdEncoding.EncodeToString(raw)})
	}
	commitResult, err := rpc.Commit(ctx, &successor)
	if err != nil {
		return Evidence{}, fmt.Errorf("commit at successor height %d: %w", successor, err)
	}
	if commitResult == nil || !commitResult.CanonicalCommit {
		evidence.IncompleteReason = fmt.Sprintf("height %d commit is not canonical yet; CometBFT canonicalizes it in block %d", successor, canonicalAt)
		return evidence, fmt.Errorf("%w: %s", ErrEvidenceIncomplete, evidence.IncompleteReason)
	}
	if commitResult.Commit == nil || commitResult.Header == nil {
		return Evidence{}, errors.New("canonical successor commit response is missing its header or commit")
	}
	lastBlock, err := decodeBlockProof(evidence.Blocks[len(evidence.Blocks)-1])
	if err != nil {
		return Evidence{}, err
	}
	lastID, err := evidence.Blocks[len(evidence.Blocks)-1].BlockID.decode()
	if err != nil {
		return Evidence{}, err
	}
	if !bytes.Equal(commitResult.Header.Hash(), lastBlock.Hash()) || !commitResult.Commit.BlockID.Equals(lastID) {
		return Evidence{}, errors.New("successor commit does not match collected successor block")
	}
	commitRaw, err := commitResult.Commit.ToProto().Marshal()
	if err != nil {
		return Evidence{}, fmt.Errorf("marshal successor commit: %w", err)
	}
	if totalProtoBytes+int64(len(commitRaw)) > MaxEvidenceProtoBytes {
		return Evidence{}, errors.New("evidence protobuf bounds exceeded")
	}
	evidence.SuccessorCommitProto = base64.StdEncoding.EncodeToString(commitRaw)
	evidence.Complete = true
	if _, err := VerifyEvidence(evidence); err != nil {
		return Evidence{}, fmt.Errorf("verify collected evidence: %w", err)
	}
	return evidence, nil
}

func validateRPCBlockID(blockID cmttypes.BlockID, block *cmttypes.Block) error {
	if blockID.IsNil() || !blockID.IsComplete() {
		return errors.New("RPC block id is nil or incomplete")
	}
	if err := blockID.ValidateBasic(); err != nil {
		return fmt.Errorf("RPC block id: %w", err)
	}
	if !bytes.Equal(blockID.Hash, block.Hash()) {
		return errors.New("RPC block id hash does not match block hash")
	}
	return nil
}

func portableBlockID(blockID cmttypes.BlockID) PortableBlockID {
	return PortableBlockID{HashHex: strings.ToUpper(hex.EncodeToString(blockID.Hash)), PartSetTotal: blockID.PartSetHeader.Total, PartSetHashHex: strings.ToUpper(hex.EncodeToString(blockID.PartSetHeader.Hash))}
}

func (portable PortableBlockID) decode() (cmttypes.BlockID, error) {
	hash, err := decodeCanonicalHex("block hash", portable.HashHex)
	if err != nil {
		return cmttypes.BlockID{}, err
	}
	partHash, err := decodeCanonicalHex("part-set hash", portable.PartSetHashHex)
	if err != nil {
		return cmttypes.BlockID{}, err
	}
	blockID := cmttypes.BlockID{Hash: hash, PartSetHeader: cmttypes.PartSetHeader{Total: portable.PartSetTotal, Hash: partHash}}
	if !blockID.IsComplete() {
		return cmttypes.BlockID{}, errors.New("portable block id is incomplete")
	}
	if err := blockID.ValidateBasic(); err != nil {
		return cmttypes.BlockID{}, err
	}
	return blockID, nil
}

func decodeCanonicalHex(name, value string) ([]byte, error) {
	if value == "" || value != strings.ToUpper(value) {
		return nil, fmt.Errorf("%s is empty or noncanonical", name)
	}
	raw, err := hex.DecodeString(value)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", name, err)
	}
	return raw, nil
}

func decodeBlockProof(proof BlockProof) (*cmttypes.Block, error) {
	raw, err := base64.StdEncoding.Strict().DecodeString(proof.BlockProto)
	if err != nil {
		return nil, fmt.Errorf("block %d base64: %w", proof.Height, err)
	}
	if int64(len(raw)) > MaxEvidenceProtoBytes {
		return nil, fmt.Errorf("block %d protobuf exceeds bounds", proof.Height)
	}
	var protoBlock cmtproto.Block
	if err := protoBlock.Unmarshal(raw); err != nil {
		return nil, fmt.Errorf("block %d protobuf: %w", proof.Height, err)
	}
	block, err := cmttypes.BlockFromProto(&protoBlock)
	if err != nil {
		return nil, fmt.Errorf("block %d: %w", proof.Height, err)
	}
	return block, nil
}

func validatorSetFromSession(session Session) (*cmttypes.ValidatorSet, error) {
	validators := make([]*cmttypes.Validator, 0, len(session.Validators))
	for _, spec := range session.Validators {
		publicKey, err := decodePublicKey(spec.ValidatorPublicKey)
		if err != nil {
			return nil, err
		}
		validator := cmttypes.NewValidator(cmted25519.PubKey(publicKey), spec.Power)
		expectedAddress, err := hex.DecodeString(spec.ValidatorAddress)
		if err != nil || !bytes.Equal(validator.Address, expectedAddress) {
			return nil, fmt.Errorf("validator address mismatch for slot %d", spec.Slot)
		}
		validators = append(validators, validator)
	}
	return cmttypes.NewValidatorSet(validators), nil
}

// VerifyEvidence independently verifies the frozen session, complete linked
// chain, all prior commits, successor commit, and memory-only application replay.
// Header.AppHash at H+1 is the authenticated post-H state.
func VerifyEvidence(evidence Evidence) (EvidenceVerification, error) {
	if evidence.SchemaVersion != EvidenceSchema {
		return EvidenceVerification{}, fmt.Errorf("evidence schema_version %d, want %d", evidence.SchemaVersion, EvidenceSchema)
	}
	if !evidence.Complete || evidence.IncompleteReason != "" {
		return EvidenceVerification{}, ErrEvidenceIncomplete
	}
	if evidence.TargetHeight < 1 || evidence.TargetHeight >= MaxEvidenceHeight {
		return EvidenceVerification{}, errors.New("invalid target height")
	}
	summary, err := evidence.Session.Validate()
	if err != nil {
		return EvidenceVerification{}, fmt.Errorf("session: %w", err)
	}
	if evidence.PolicySHA256 != summary.PolicySHA256 {
		return EvidenceVerification{}, errors.New("policy checksum does not match frozen session profile")
	}
	source, err := evidence.Session.Validator(evidence.SourceSlot)
	if err != nil {
		return EvidenceVerification{}, err
	}
	if evidence.SourceOperator != source.Operator || strings.ToLower(evidence.SourceNodeID) != strings.ToLower(source.NodeID) {
		return EvidenceVerification{}, errors.New("collector claim does not match its session slot")
	}
	collectedAt, err := time.Parse(time.RFC3339Nano, evidence.CollectedAt)
	if err != nil || evidence.CollectedAt != collectedAt.UTC().Format(time.RFC3339Nano) {
		return EvidenceVerification{}, errors.New("collected_at is not canonical UTC RFC3339Nano")
	}
	successor := evidence.TargetHeight + 1
	if int64(len(evidence.Blocks)) != successor {
		return EvidenceVerification{}, fmt.Errorf("blocks count %d, want exact heights 1..%d", len(evidence.Blocks), successor)
	}
	validatorSet, err := validatorSetFromSession(evidence.Session)
	if err != nil {
		return EvidenceVerification{}, err
	}
	genesis, _, err := evidence.Session.BuildGenesis()
	if err != nil {
		return EvidenceVerification{}, err
	}
	validatorHash, consensusHash := validatorSet.Hash(), genesis.ConsensusParams.Hash()
	policy := Policy()
	limits, err := Limits()
	if err != nil {
		return EvidenceVerification{}, err
	}
	state := auction.NewState()
	initialAppHash, err := auction.CanonicalHash(state, policy)
	if err != nil {
		return EvidenceVerification{}, fmt.Errorf("canonical InitChain state: %w", err)
	}
	currentAppHash := append([]byte(nil), initialAppHash[:]...)
	totalTransactions, totalTransactionBytes, totalProtoBytes := 0, int64(0), int64(0)
	var previousBlock *cmttypes.Block
	var previousID, targetID, successorID cmttypes.BlockID
	var targetAppHash []byte
	var successorBlock *cmttypes.Block
	for index, proof := range evidence.Blocks {
		height := int64(index + 1)
		if proof.Height != height {
			return EvidenceVerification{}, fmt.Errorf("block proof %d claims height %d", index, proof.Height)
		}
		raw, err := base64.StdEncoding.Strict().DecodeString(proof.BlockProto)
		if err != nil {
			return EvidenceVerification{}, fmt.Errorf("block %d base64: %w", height, err)
		}
		totalProtoBytes += int64(len(raw))
		if totalProtoBytes > MaxEvidenceProtoBytes {
			return EvidenceVerification{}, errors.New("evidence protobuf bounds exceeded")
		}
		block, err := decodeBlockProof(proof)
		if err != nil {
			return EvidenceVerification{}, err
		}
		blockID, err := proof.BlockID.decode()
		if err != nil {
			return EvidenceVerification{}, fmt.Errorf("block %d id: %w", height, err)
		}
		if err := block.ValidateBasic(); err != nil {
			return EvidenceVerification{}, fmt.Errorf("block %d basic validation: %w", height, err)
		}
		if block.Height != height || block.ChainID != evidence.Session.ChainID {
			return EvidenceVerification{}, fmt.Errorf("block %d height or chain mismatch", height)
		}
		if !bytes.Equal(blockID.Hash, block.Hash()) {
			return EvidenceVerification{}, fmt.Errorf("block %d id hash mismatch", height)
		}
		if !bytes.Equal(block.ValidatorsHash, validatorHash) || !bytes.Equal(block.NextValidatorsHash, validatorHash) {
			return EvidenceVerification{}, fmt.Errorf("block %d validator hash mismatch", height)
		}
		if !bytes.Equal(block.ConsensusHash, consensusHash) {
			return EvidenceVerification{}, fmt.Errorf("block %d consensus hash mismatch", height)
		}
		if _, validator := validatorSet.GetByAddress(block.ProposerAddress); validator == nil {
			return EvidenceVerification{}, fmt.Errorf("block %d proposer is outside session validator set", height)
		}
		if !bytes.Equal(block.AppHash, currentAppHash) {
			return EvidenceVerification{}, fmt.Errorf("block %d header app hash does not match replayed post-%d state", height, height-1)
		}
		if height == 1 {
			if !block.LastBlockID.IsNil() || block.LastCommit.Height != 0 || block.LastCommit.Round != 0 || !block.LastCommit.BlockID.IsNil() || len(block.LastCommit.Signatures) != 0 {
				return EvidenceVerification{}, errors.New("block 1 does not contain the canonical empty genesis predecessor")
			}
			if block.Time.Before(genesis.GenesisTime) {
				return EvidenceVerification{}, errors.New("block 1 precedes genesis time")
			}
		} else {
			if !block.LastBlockID.Equals(previousID) || !block.LastCommit.BlockID.Equals(previousID) || block.LastCommit.Height != height-1 {
				return EvidenceVerification{}, fmt.Errorf("block %d predecessor link mismatch", height)
			}
			if !block.Time.After(previousBlock.Time) {
				return EvidenceVerification{}, fmt.Errorf("block %d time is not after predecessor", height)
			}
			if err := validatorSet.VerifyCommit(evidence.Session.ChainID, previousID, height-1, block.LastCommit); err != nil {
				return EvidenceVerification{}, fmt.Errorf("block %d predecessor commit: %w", height, err)
			}
		}
		for _, transaction := range block.Data.Txs {
			totalTransactions++
			totalTransactionBytes += int64(len(transaction))
			if totalTransactions > MaxEvidenceTxs || totalTransactionBytes > MaxEvidenceTxBytes {
				return EvidenceVerification{}, errors.New("evidence transaction bounds exceeded")
			}
		}
		if height <= evidence.TargetHeight {
			var nextHash [32]byte
			state, nextHash, err = AdvanceOracle(state, height, block.Time, block.Data.Txs, policy, limits)
			if err != nil {
				return EvidenceVerification{}, fmt.Errorf("frozen oracle height %d: %w", height, err)
			}
			currentAppHash = append(currentAppHash[:0], nextHash[:]...)
			if height == evidence.TargetHeight {
				targetID, targetAppHash = blockID, append([]byte(nil), currentAppHash...)
			}
		} else {
			successorBlock, successorID = block, blockID
		}
		previousBlock, previousID = block, blockID
	}
	if successorBlock == nil || !bytes.Equal(successorBlock.AppHash, targetAppHash) {
		return EvidenceVerification{}, errors.New("successor header does not authenticate post-target application state")
	}
	commitRaw, err := base64.StdEncoding.Strict().DecodeString(evidence.SuccessorCommitProto)
	if err != nil {
		return EvidenceVerification{}, fmt.Errorf("successor commit base64: %w", err)
	}
	totalProtoBytes += int64(len(commitRaw))
	if totalProtoBytes > MaxEvidenceProtoBytes {
		return EvidenceVerification{}, errors.New("evidence protobuf bounds exceeded")
	}
	var protoCommit cmtproto.Commit
	if err := protoCommit.Unmarshal(commitRaw); err != nil {
		return EvidenceVerification{}, fmt.Errorf("successor commit protobuf: %w", err)
	}
	commit, err := cmttypes.CommitFromProto(&protoCommit)
	if err != nil {
		return EvidenceVerification{}, fmt.Errorf("successor commit: %w", err)
	}
	if commit.Height != successor || !commit.BlockID.Equals(successorID) {
		return EvidenceVerification{}, errors.New("successor commit does not match successor block")
	}
	if err := validatorSet.VerifyCommit(evidence.Session.ChainID, successorID, successor, commit); err != nil {
		return EvidenceVerification{}, fmt.Errorf("successor commit quorum: %w", err)
	}
	signatures := 0
	for _, signature := range commit.Signatures {
		if signature.BlockIDFlag == cmttypes.BlockIDFlagCommit && len(signature.Signature) > 0 {
			signatures++
		}
	}
	return EvidenceVerification{
		SessionID: evidence.Session.SessionID, ChainID: evidence.Session.ChainID, TargetHeight: evidence.TargetHeight,
		TargetBlockID: strings.ToUpper(hex.EncodeToString(targetID.Hash)), TargetAppHash: strings.ToUpper(hex.EncodeToString(targetAppHash)),
		SuccessorHeight: successor, SuccessorBlockID: strings.ToUpper(hex.EncodeToString(successorID.Hash)), CommitSignatures: signatures,
	}, nil
}

// AdvanceOracle replays exactly one block through the frozen Phase 1 validator.
func AdvanceOracle(state auction.State, blockHeight int64, blockTime time.Time, transactions cmttypes.Txs, policy auction.Policy, limits app.AdapterLimits) (auction.State, [32]byte, error) {
	consensusSeconds := blockTime.Unix()
	advanced, err := auction.AdvanceConsensusTime(state, blockHeight, consensusSeconds, policy)
	if err != nil {
		return auction.State{}, [32]byte{}, fmt.Errorf("advance consensus time: %w", err)
	}
	proposal := auction.Proposal{ConsensusSeconds: consensusSeconds, Entries: make([]auction.ProposalEntry, 0, len(transactions))}
	for index, transaction := range transactions {
		envelope, err := app.DecodeEnvelope(transaction, policy, limits)
		if err != nil {
			return auction.State{}, [32]byte{}, fmt.Errorf("transaction %d: %w", index, err)
		}
		proposal.Entries = append(proposal.Entries, auction.ProposalEntry{ActorID: envelope.ActorID, Payload: envelope.Payload})
	}
	validated, err := auction.ValidateProposal(advanced.State, proposal, policy)
	if err != nil {
		return auction.State{}, [32]byte{}, err
	}
	hash, err := auction.CanonicalHash(validated.State, policy)
	if err != nil {
		return auction.State{}, [32]byte{}, err
	}
	return validated.State, hash, nil
}

func WriteEvidence(path string, evidence Evidence) error {
	if len(evidence.Blocks) > MaxEvidenceHeight {
		return fmt.Errorf("evidence blocks count %d exceeds %d", len(evidence.Blocks), MaxEvidenceHeight)
	}
	raw, err := json.MarshalIndent(evidence, "", "  ")
	if err != nil {
		return err
	}
	if int64(len(raw)+1) > MaxEvidenceBytes {
		return fmt.Errorf("evidence JSON length %d exceeds %d", len(raw)+1, MaxEvidenceBytes)
	}
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	written, writeErr := file.Write(append(raw, '\n'))
	if writeErr == nil && written != len(raw)+1 {
		writeErr = errors.New("short evidence write")
	}
	if closeErr := file.Close(); writeErr == nil {
		writeErr = closeErr
	}
	return writeErr
}

func LoadEvidence(path string) (Evidence, error) {
	raw, err := ReadFileBounded(path, MaxEvidenceBytes)
	if err != nil {
		return Evidence{}, err
	}
	var evidence Evidence
	if err := DecodeEvidenceJSON(raw, &evidence); err != nil {
		return Evidence{}, err
	}
	return evidence, nil
}

func CompareEvidence(approved Session, values []Evidence) (EvidenceAgreement, error) {
	if len(values) != 4 {
		return EvidenceAgreement{}, fmt.Errorf("evidence count %d, want exactly 4", len(values))
	}
	approvedSummary, err := approved.Validate()
	if err != nil {
		return EvidenceAgreement{}, fmt.Errorf("approved session: %w", err)
	}
	approvedRaw, err := json.Marshal(approved)
	if err != nil {
		return EvidenceAgreement{}, err
	}
	// Anchor trust before decoding any block or commit proof. An internally
	// consistent proof under an attacker-selected validator set is insufficient.
	for index, value := range values {
		embeddedRaw, err := json.Marshal(value.Session)
		if err != nil {
			return EvidenceAgreement{}, err
		}
		if !bytes.Equal(embeddedRaw, approvedRaw) {
			return EvidenceAgreement{}, fmt.Errorf("evidence %d session does not match the externally approved session", index)
		}
		if value.PolicySHA256 != approvedSummary.PolicySHA256 || value.Session.GenesisSHA256 != approved.GenesisSHA256 {
			return EvidenceAgreement{}, fmt.Errorf("evidence %d policy or genesis binding does not match the externally approved session", index)
		}
	}
	verifications := make([]EvidenceVerification, len(values))
	for index, value := range values {
		verification, err := VerifyEvidence(value)
		if err != nil {
			return EvidenceAgreement{}, fmt.Errorf("evidence %d: %w", index, err)
		}
		verifications[index] = verification
	}
	first := verifications[0]
	slots := make(map[int]struct{}, 4)
	for index, value := range values {
		if verifications[index] != first {
			return EvidenceAgreement{}, fmt.Errorf("evidence %d does not agree on the verified proof result", index)
		}
		if _, exists := slots[value.SourceSlot]; exists {
			return EvidenceAgreement{}, fmt.Errorf("evidence %d duplicates claimed source slot %d", index, value.SourceSlot)
		}
		slots[value.SourceSlot] = struct{}{}
	}
	claimed := make([]int, 0, len(slots))
	for slot := range slots {
		claimed = append(claimed, slot)
	}
	sort.Ints(claimed)
	return EvidenceAgreement{
		Agreement: true, SessionID: first.SessionID, ChainID: first.ChainID, TargetHeight: first.TargetHeight,
		TargetBlockID: first.TargetBlockID, TargetAppHash: first.TargetAppHash, ClaimedSlots: claimed,
		CollectorProvenanceVerified: false,
		Warning:                     "proof agreement does not prove that four physical computers independently collected the files",
	}, nil
}

type HTTPRPC struct {
	Client    *rpchttp.HTTP
	transport *http.Transport
}

func NewHTTPRPC(tcpAddress string, timeout time.Duration) (*HTTPRPC, error) {
	if timeout <= 0 || timeout > MaxDemoDuration {
		return nil, fmt.Errorf("RPC timeout must be within (0,%s]", MaxDemoDuration)
	}
	if _, err := validateTCPAddress("rpc_listen", tcpAddress, true, false); err != nil {
		return nil, err
	}
	parsed, err := url.Parse(tcpAddress)
	if err != nil {
		return nil, err
	}
	remote := "http://" + parsed.Host
	httpClient, err := jsonrpcclient.DefaultHTTPClient(remote)
	if err != nil {
		return nil, err
	}
	transport, ok := httpClient.Transport.(*http.Transport)
	if !ok {
		return nil, fmt.Errorf("unexpected HTTP transport %T", httpClient.Transport)
	}
	httpClient.Timeout = timeout
	client, err := rpchttp.NewWithClient(remote, httpClient)
	if err != nil {
		transport.CloseIdleConnections()
		return nil, err
	}
	return &HTTPRPC{Client: client, transport: transport}, nil
}

func (client *HTTPRPC) Close() {
	if client != nil && client.transport != nil {
		client.transport.CloseIdleConnections()
	}
}

func normalizeLoopback(address string) (string, error) {
	parsed, err := url.Parse(address)
	if err != nil {
		return "", err
	}
	host, port, err := net.SplitHostPort(parsed.Host)
	if err != nil {
		return "", err
	}
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsLoopback() {
		return "", errors.New("RPC is not loopback-only")
	}
	return net.JoinHostPort(ip.String(), port), nil
}
