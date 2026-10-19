package demo

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	abci "github.com/cometbft/cometbft/abci/types"
	cmtproto "github.com/cometbft/cometbft/api/cometbft/types/v1"
	cmted25519 "github.com/cometbft/cometbft/crypto/ed25519"
	cmttypes "github.com/cometbft/cometbft/types"
)

const (
	AuthenticatedEvidenceSchemaName    = "OwnerLocalR4AuthenticatedConsensusEvidenceV1"
	AuthenticatedEvidenceSchemaVersion = 1
	AuthenticatedAgreementSchemaName   = "OwnerLocalR4AuthenticatedEvidenceAgreementV1"
)

// AuthenticatedEvidence contains the public consensus material needed to
// verify a DEMO_AUTH_V1 application state through TargetHeight. The exact
// session and authenticated-genesis inputs are embedded as base64 so the
// proof remains self-contained without normalizing either approved byte set.
type AuthenticatedEvidence struct {
	Schema                     string       `json:"schema"`
	SchemaVersion              int          `json:"schema_version"`
	Complete                   bool         `json:"complete"`
	IncompleteReason           string       `json:"incomplete_reason"`
	Session                    Session      `json:"session"`
	SessionBase64              string       `json:"session_base64"`
	SessionSHA256              string       `json:"session_sha256"`
	PolicySHA256               string       `json:"policy_sha256"`
	AuthenticatedGenesisBase64 string       `json:"authenticated_genesis_base64"`
	AuthenticatedGenesisSHA256 string       `json:"authenticated_genesis_sha256"`
	CombinedGenesisSHA256      string       `json:"combined_genesis_sha256"`
	SourceSlot                 int          `json:"source_slot"`
	SourceOperator             string       `json:"source_operator"`
	SourceNodeID               string       `json:"source_node_id"`
	TargetHeight               int64        `json:"target_height"`
	Blocks                     []BlockProof `json:"blocks"`
	SuccessorCommitProto       string       `json:"successor_commit_proto_base64"`
	CollectedAt                string       `json:"collected_at"`
	Warning                    string       `json:"warning"`
}

func exactSessionBinding(raw []byte) (Session, string, error) {
	if len(raw) == 0 || len(raw) > MaxSessionBytes {
		return Session{}, "", errors.New("session is empty or exceeds bounds")
	}
	var session Session
	if err := DecodeStrictJSON(raw, MaxSessionBytes, &session); err != nil {
		return Session{}, "", err
	}
	if _, err := session.Validate(); err != nil {
		return Session{}, "", err
	}
	sum := sha256.Sum256(raw)
	return session, hex.EncodeToString(sum[:]), nil
}

type AuthenticatedEvidenceVerification struct {
	Schema                  string `json:"schema"`
	SessionID               string `json:"session_id"`
	ChainID                 string `json:"chain_id"`
	AuthNetworkID           string `json:"auth_network_id"`
	AuctionID               string `json:"auction_id"`
	AuthenticatedGenesisSHA string `json:"authenticated_genesis_sha256"`
	CombinedGenesisSHA      string `json:"combined_genesis_sha256"`
	SourceSlot              int    `json:"source_slot"`
	TargetHeight            int64  `json:"target_height"`
	TargetBlockID           string `json:"target_block_id"`
	TargetAppHash           string `json:"target_app_hash"`
	SuccessorHeight         int64  `json:"successor_height"`
	SuccessorBlockID        string `json:"successor_block_id"`
	CommitSignatures        int    `json:"successor_commit_signatures"`
	AuthenticatedReplay     bool   `json:"authenticated_replay"`
	NostrSignaturesVerified bool   `json:"nostr_signatures_verified"`
}

type AuthenticatedEvidenceAgreement struct {
	Schema                      string `json:"schema"`
	Agreement                   bool   `json:"agreement"`
	SessionID                   string `json:"session_id"`
	ChainID                     string `json:"chain_id"`
	AuthNetworkID               string `json:"auth_network_id"`
	AuctionID                   string `json:"auction_id"`
	AuthenticatedGenesisSHA256  string `json:"authenticated_genesis_sha256"`
	CombinedGenesisSHA256       string `json:"combined_genesis_sha256"`
	TargetHeight                int64  `json:"target_height"`
	TargetBlockID               string `json:"target_block_id"`
	TargetAppHash               string `json:"target_app_hash"`
	ClaimedSlots                []int  `json:"claimed_slots"`
	CollectorProvenanceVerified bool   `json:"collector_provenance_verified"`
	AuthenticatedReplayVerified bool   `json:"authenticated_run_verified"`
	NostrSignaturesVerified     bool   `json:"nostr_signatures_verified"`
	Warning                     string `json:"warning"`
}

func validateAuthenticatedNetworkAction(session Session, slot int, packetID, acknowledgement string) (ValidatorSpec, error) {
	if _, err := session.Validate(); err != nil {
		return ValidatorSpec{}, err
	}
	if session.NetworkMode != NetworkExplicit {
		return ValidatorSpec{}, errors.New("session network remains off")
	}
	if packetID == "" || packetID != session.NetworkPacket {
		return ValidatorSpec{}, errors.New("network packet acknowledgement does not match session")
	}
	if acknowledgement != AuthenticatedRunAcknowledgement {
		return ValidatorSpec{}, errors.New("exact one-shot DEMO_AUTH_V1 acknowledgement is required")
	}
	return session.Validator(slot)
}

func authenticatedGenesisBinding(session Session, raw []byte) (AuthenticatedGenesis, string, string, error) {
	if len(raw) == 0 || len(raw) > MaxAuthenticatedGenesisBytes {
		return AuthenticatedGenesis{}, "", "", errors.New("authenticated genesis is empty or exceeds bounds")
	}
	var genesis AuthenticatedGenesis
	if err := DecodeStrictJSON(raw, MaxAuthenticatedGenesisBytes, &genesis); err != nil {
		return AuthenticatedGenesis{}, "", "", err
	}
	if _, _, err := genesis.Build(); err != nil {
		return AuthenticatedGenesis{}, "", "", err
	}
	if genesis.ChainID != session.ChainID {
		return AuthenticatedGenesis{}, "", "", errors.New("authenticated genesis chain ID does not match session")
	}
	_, combined, err := combinedAuthenticatedGenesis(session, genesis)
	if err != nil {
		return AuthenticatedGenesis{}, "", "", err
	}
	sum := sha256.Sum256(raw)
	return genesis, hex.EncodeToString(sum[:]), combined, nil
}

// CollectAuthenticatedEvidence collects blocks 1..H+1 and the canonical H+1
// commit from a single loopback RPC. It self-verifies the result with the
// authenticated application before returning it.
func CollectAuthenticatedEvidence(ctx context.Context, rpc RPC, sessionRaw, authGenesisRaw []byte, slot int, packetID, acknowledgement string, target int64, now time.Time) (AuthenticatedEvidence, error) {
	if target < 1 || target >= MaxEvidenceHeight {
		return AuthenticatedEvidence{}, fmt.Errorf("target height %d outside 1..%d (one signed successor is mandatory)", target, MaxEvidenceHeight-1)
	}
	session, sessionSHA, err := exactSessionBinding(sessionRaw)
	if err != nil {
		return AuthenticatedEvidence{}, err
	}
	summary, err := session.Validate()
	if err != nil {
		return AuthenticatedEvidence{}, err
	}
	validator, err := validateAuthenticatedNetworkAction(session, slot, packetID, acknowledgement)
	if err != nil {
		return AuthenticatedEvidence{}, err
	}
	_, authSHA, combinedSHA, err := authenticatedGenesisBinding(session, authGenesisRaw)
	if err != nil {
		return AuthenticatedEvidence{}, err
	}
	evidence := AuthenticatedEvidence{
		Schema: AuthenticatedEvidenceSchemaName, SchemaVersion: AuthenticatedEvidenceSchemaVersion,
		Session: session, SessionBase64: base64.StdEncoding.EncodeToString(sessionRaw), SessionSHA256: sessionSHA,
		PolicySHA256:               summary.PolicySHA256,
		AuthenticatedGenesisBase64: base64.StdEncoding.EncodeToString(authGenesisRaw),
		AuthenticatedGenesisSHA256: authSHA, CombinedGenesisSHA256: combinedSHA,
		SourceSlot: slot, SourceOperator: validator.Operator, SourceNodeID: validator.NodeID,
		TargetHeight: target, CollectedAt: now.UTC().Format(time.RFC3339Nano),
		Warning: "public authenticated consensus proof; source-slot provenance is a collector claim and does not prove an independent physical failure domain",
	}
	status, err := rpc.Status(ctx)
	if err != nil {
		return AuthenticatedEvidence{}, fmt.Errorf("status: %w", err)
	}
	if status == nil || status.NodeInfo.Network != session.ChainID {
		return AuthenticatedEvidence{}, errors.New("RPC status chain id does not match session")
	}
	if string(status.NodeInfo.DefaultNodeID) != strings.ToLower(validator.NodeID) {
		return AuthenticatedEvidence{}, errors.New("RPC status node id does not match requested slot")
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
			return AuthenticatedEvidence{}, fmt.Errorf("block %d: %w", height, err)
		}
		if result == nil || result.Block == nil || result.Block.Height != height {
			return AuthenticatedEvidence{}, fmt.Errorf("block response does not contain exact height %d", height)
		}
		if err := validateRPCBlockID(result.BlockID, result.Block); err != nil {
			return AuthenticatedEvidence{}, fmt.Errorf("block %d: %w", height, err)
		}
		for _, transaction := range result.Block.Data.Txs {
			totalTransactions++
			totalTransactionBytes += int64(len(transaction))
			if totalTransactions > MaxEvidenceTxs || totalTransactionBytes > MaxEvidenceTxBytes {
				return AuthenticatedEvidence{}, errors.New("evidence transaction bounds exceeded")
			}
		}
		protoBlock, err := result.Block.ToProto()
		if err != nil {
			return AuthenticatedEvidence{}, fmt.Errorf("encode block %d: %w", height, err)
		}
		raw, err := protoBlock.Marshal()
		if err != nil {
			return AuthenticatedEvidence{}, fmt.Errorf("marshal block %d: %w", height, err)
		}
		totalProtoBytes += int64(len(raw))
		if totalProtoBytes > MaxEvidenceProtoBytes {
			return AuthenticatedEvidence{}, errors.New("evidence protobuf bounds exceeded")
		}
		evidence.Blocks = append(evidence.Blocks, BlockProof{Height: height, BlockID: portableBlockID(result.BlockID), BlockProto: base64.StdEncoding.EncodeToString(raw)})
	}
	commitResult, err := rpc.Commit(ctx, &successor)
	if err != nil {
		return AuthenticatedEvidence{}, fmt.Errorf("commit at successor height %d: %w", successor, err)
	}
	if commitResult == nil || !commitResult.CanonicalCommit {
		evidence.IncompleteReason = fmt.Sprintf("height %d commit is not canonical yet; CometBFT canonicalizes it in block %d", successor, canonicalAt)
		return evidence, fmt.Errorf("%w: %s", ErrEvidenceIncomplete, evidence.IncompleteReason)
	}
	if commitResult.Commit == nil || commitResult.Header == nil {
		return AuthenticatedEvidence{}, errors.New("canonical successor commit response is missing its header or commit")
	}
	lastBlock, err := decodeBlockProof(evidence.Blocks[len(evidence.Blocks)-1])
	if err != nil {
		return AuthenticatedEvidence{}, err
	}
	lastID, err := evidence.Blocks[len(evidence.Blocks)-1].BlockID.decode()
	if err != nil {
		return AuthenticatedEvidence{}, err
	}
	if !bytes.Equal(commitResult.Header.Hash(), lastBlock.Hash()) || !commitResult.Commit.BlockID.Equals(lastID) {
		return AuthenticatedEvidence{}, errors.New("successor commit does not match collected successor block")
	}
	commitRaw, err := commitResult.Commit.ToProto().Marshal()
	if err != nil {
		return AuthenticatedEvidence{}, fmt.Errorf("marshal successor commit: %w", err)
	}
	if totalProtoBytes+int64(len(commitRaw)) > MaxEvidenceProtoBytes {
		return AuthenticatedEvidence{}, errors.New("evidence protobuf bounds exceeded")
	}
	evidence.SuccessorCommitProto = base64.StdEncoding.EncodeToString(commitRaw)
	evidence.Complete = true
	if _, err := VerifyAuthenticatedEvidenceAgainst(evidence, sessionRaw, authGenesisRaw); err != nil {
		return AuthenticatedEvidence{}, fmt.Errorf("verify collected authenticated evidence: %w", err)
	}
	return evidence, nil
}

func authenticatedValidatorSet(session Session) (*cmttypes.ValidatorSet, error) {
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

// VerifyAuthenticatedEvidenceAgainst anchors a proof to separately approved
// session and authenticated-genesis bytes, verifies the complete CometBFT
// chain and commits, then replays blocks 1..H through the real authenticated
// application (including BIP-340 verification) and joins its post-H AppHash
// to the signed H+1 header.
func VerifyAuthenticatedEvidenceAgainst(evidence AuthenticatedEvidence, approvedSessionRaw, approvedAuthGenesisRaw []byte) (AuthenticatedEvidenceVerification, error) {
	if evidence.Schema != AuthenticatedEvidenceSchemaName || evidence.SchemaVersion != AuthenticatedEvidenceSchemaVersion {
		return AuthenticatedEvidenceVerification{}, errors.New("authenticated evidence schema mismatch")
	}
	if !evidence.Complete || evidence.IncompleteReason != "" {
		return AuthenticatedEvidenceVerification{}, ErrEvidenceIncomplete
	}
	if evidence.TargetHeight < 1 || evidence.TargetHeight >= MaxEvidenceHeight {
		return AuthenticatedEvidenceVerification{}, errors.New("invalid target height")
	}
	approved, approvedSessionSHA, err := exactSessionBinding(approvedSessionRaw)
	if err != nil {
		return AuthenticatedEvidenceVerification{}, fmt.Errorf("approved session: %w", err)
	}
	approvedSummary, err := approved.Validate()
	if err != nil {
		return AuthenticatedEvidenceVerification{}, fmt.Errorf("approved session: %w", err)
	}
	embeddedSessionRaw, err := base64.StdEncoding.Strict().DecodeString(evidence.SessionBase64)
	if err != nil {
		return AuthenticatedEvidenceVerification{}, fmt.Errorf("session base64: %w", err)
	}
	if !bytes.Equal(embeddedSessionRaw, approvedSessionRaw) || evidence.SessionSHA256 != approvedSessionSHA {
		return AuthenticatedEvidenceVerification{}, errors.New("embedded session does not match externally approved bytes")
	}
	embeddedExactSession, embeddedSessionSHA, err := exactSessionBinding(embeddedSessionRaw)
	if err != nil || embeddedSessionSHA != evidence.SessionSHA256 {
		return AuthenticatedEvidenceVerification{}, errors.New("embedded session checksum or encoding mismatch")
	}
	embeddedSession, err := json.Marshal(evidence.Session)
	if err != nil {
		return AuthenticatedEvidenceVerification{}, err
	}
	approvedSession, err := json.Marshal(embeddedExactSession)
	if err != nil {
		return AuthenticatedEvidenceVerification{}, err
	}
	if !bytes.Equal(embeddedSession, approvedSession) || evidence.PolicySHA256 != approvedSummary.PolicySHA256 {
		return AuthenticatedEvidenceVerification{}, errors.New("evidence session or policy does not match externally approved session")
	}
	embeddedAuthRaw, err := base64.StdEncoding.Strict().DecodeString(evidence.AuthenticatedGenesisBase64)
	if err != nil {
		return AuthenticatedEvidenceVerification{}, fmt.Errorf("authenticated genesis base64: %w", err)
	}
	if !bytes.Equal(embeddedAuthRaw, approvedAuthGenesisRaw) {
		return AuthenticatedEvidenceVerification{}, errors.New("embedded authenticated genesis does not match externally approved bytes")
	}
	genesis, authSHA, combinedSHA, err := authenticatedGenesisBinding(approved, embeddedAuthRaw)
	if err != nil {
		return AuthenticatedEvidenceVerification{}, err
	}
	if evidence.AuthenticatedGenesisSHA256 != authSHA || evidence.CombinedGenesisSHA256 != combinedSHA {
		return AuthenticatedEvidenceVerification{}, errors.New("authenticated or combined genesis checksum mismatch")
	}
	source, err := approved.Validator(evidence.SourceSlot)
	if err != nil {
		return AuthenticatedEvidenceVerification{}, err
	}
	if evidence.SourceOperator != source.Operator || strings.ToLower(evidence.SourceNodeID) != strings.ToLower(source.NodeID) {
		return AuthenticatedEvidenceVerification{}, errors.New("collector claim does not match its session slot")
	}
	collectedAt, err := time.Parse(time.RFC3339Nano, evidence.CollectedAt)
	if err != nil || evidence.CollectedAt != collectedAt.UTC().Format(time.RFC3339Nano) {
		return AuthenticatedEvidenceVerification{}, errors.New("collected_at is not canonical UTC RFC3339Nano")
	}
	successor := evidence.TargetHeight + 1
	if int64(len(evidence.Blocks)) != successor {
		return AuthenticatedEvidenceVerification{}, fmt.Errorf("blocks count %d, want exact heights 1..%d", len(evidence.Blocks), successor)
	}
	validatorSet, err := authenticatedValidatorSet(approved)
	if err != nil {
		return AuthenticatedEvidenceVerification{}, err
	}
	cometGenesis, _, err := approved.BuildGenesis()
	if err != nil {
		return AuthenticatedEvidenceVerification{}, err
	}
	validatorHash, consensusHash := validatorSet.Hash(), cometGenesis.ConsensusParams.Hash()

	replayRoot, err := os.MkdirTemp("", "auction-auth-evidence-replay.")
	if err != nil {
		return AuthenticatedEvidenceVerification{}, err
	}
	defer os.RemoveAll(replayRoot)
	application, store, err := OpenAuthenticatedApplication(genesis, filepath.Join(replayRoot, "state.wal"))
	if err != nil {
		return AuthenticatedEvidenceVerification{}, fmt.Errorf("open authenticated replay: %w", err)
	}
	defer store.Close()
	genesisForABCI, err := json.Marshal(genesis)
	if err != nil {
		return AuthenticatedEvidenceVerification{}, err
	}
	initialized, err := application.InitChain(context.Background(), &abci.InitChainRequest{InitialHeight: 1, AppStateBytes: genesisForABCI})
	if err != nil {
		return AuthenticatedEvidenceVerification{}, fmt.Errorf("authenticated InitChain replay: %w", err)
	}
	currentAppHash := append([]byte(nil), initialized.AppHash...)
	totalTransactions, totalTransactionBytes, totalProtoBytes := 0, int64(0), int64(0)
	var previousBlock *cmttypes.Block
	var previousID, targetID, successorID cmttypes.BlockID
	var targetAppHash []byte
	var successorBlock *cmttypes.Block
	for index, proof := range evidence.Blocks {
		height := int64(index + 1)
		if proof.Height != height {
			return AuthenticatedEvidenceVerification{}, fmt.Errorf("block proof %d claims height %d", index, proof.Height)
		}
		raw, err := base64.StdEncoding.Strict().DecodeString(proof.BlockProto)
		if err != nil {
			return AuthenticatedEvidenceVerification{}, fmt.Errorf("block %d base64: %w", height, err)
		}
		totalProtoBytes += int64(len(raw))
		if totalProtoBytes > MaxEvidenceProtoBytes {
			return AuthenticatedEvidenceVerification{}, errors.New("evidence protobuf bounds exceeded")
		}
		block, err := decodeBlockProof(proof)
		if err != nil {
			return AuthenticatedEvidenceVerification{}, err
		}
		blockID, err := proof.BlockID.decode()
		if err != nil {
			return AuthenticatedEvidenceVerification{}, fmt.Errorf("block %d id: %w", height, err)
		}
		if err := block.ValidateBasic(); err != nil {
			return AuthenticatedEvidenceVerification{}, fmt.Errorf("block %d basic validation: %w", height, err)
		}
		if block.Height != height || block.ChainID != approved.ChainID {
			return AuthenticatedEvidenceVerification{}, fmt.Errorf("block %d height or chain mismatch", height)
		}
		if !bytes.Equal(blockID.Hash, block.Hash()) || !bytes.Equal(block.ValidatorsHash, validatorHash) || !bytes.Equal(block.NextValidatorsHash, validatorHash) || !bytes.Equal(block.ConsensusHash, consensusHash) {
			return AuthenticatedEvidenceVerification{}, fmt.Errorf("block %d header binding mismatch", height)
		}
		if _, validator := validatorSet.GetByAddress(block.ProposerAddress); validator == nil {
			return AuthenticatedEvidenceVerification{}, fmt.Errorf("block %d proposer is outside session validator set", height)
		}
		if !bytes.Equal(block.AppHash, currentAppHash) {
			return AuthenticatedEvidenceVerification{}, fmt.Errorf("block %d header app hash does not match authenticated replayed post-%d state", height, height-1)
		}
		if height == 1 {
			if !block.LastBlockID.IsNil() || block.LastCommit.Height != 0 || block.LastCommit.Round != 0 || !block.LastCommit.BlockID.IsNil() || len(block.LastCommit.Signatures) != 0 {
				return AuthenticatedEvidenceVerification{}, errors.New("block 1 does not contain the canonical empty genesis predecessor")
			}
			if block.Time.Before(cometGenesis.GenesisTime) {
				return AuthenticatedEvidenceVerification{}, errors.New("block 1 precedes genesis time")
			}
		} else {
			if !block.LastBlockID.Equals(previousID) || !block.LastCommit.BlockID.Equals(previousID) || block.LastCommit.Height != height-1 {
				return AuthenticatedEvidenceVerification{}, fmt.Errorf("block %d predecessor link mismatch", height)
			}
			if !block.Time.After(previousBlock.Time) {
				return AuthenticatedEvidenceVerification{}, fmt.Errorf("block %d time is not after predecessor", height)
			}
			if err := validatorSet.VerifyCommit(approved.ChainID, previousID, height-1, block.LastCommit); err != nil {
				return AuthenticatedEvidenceVerification{}, fmt.Errorf("block %d predecessor commit: %w", height, err)
			}
		}
		for _, transaction := range block.Data.Txs {
			totalTransactions++
			totalTransactionBytes += int64(len(transaction))
			if totalTransactions > MaxEvidenceTxs || totalTransactionBytes > MaxEvidenceTxBytes {
				return AuthenticatedEvidenceVerification{}, errors.New("evidence transaction bounds exceeded")
			}
		}
		if height <= evidence.TargetHeight {
			txs := make([][]byte, len(block.Data.Txs))
			for index := range block.Data.Txs {
				txs[index] = []byte(block.Data.Txs[index])
			}
			response, err := application.FinalizeBlock(context.Background(), &abci.FinalizeBlockRequest{Height: height, Time: block.Time, Txs: txs})
			if err != nil {
				return AuthenticatedEvidenceVerification{}, fmt.Errorf("authenticated replay height %d: %w", height, err)
			}
			if len(response.TxResults) != len(block.Data.Txs) {
				return AuthenticatedEvidenceVerification{}, fmt.Errorf("authenticated replay height %d transaction result count mismatch", height)
			}
			for txIndex, result := range response.TxResults {
				if result == nil || result.Code != 0 {
					return AuthenticatedEvidenceVerification{}, fmt.Errorf("authenticated replay height %d transaction %d rejected", height, txIndex)
				}
			}
			if _, err := application.Commit(context.Background(), &abci.CommitRequest{}); err != nil {
				return AuthenticatedEvidenceVerification{}, fmt.Errorf("authenticated replay commit height %d: %w", height, err)
			}
			currentAppHash = append(currentAppHash[:0], response.AppHash...)
			if height == evidence.TargetHeight {
				targetID, targetAppHash = blockID, append([]byte(nil), currentAppHash...)
			}
		} else {
			successorBlock, successorID = block, blockID
		}
		previousBlock, previousID = block, blockID
	}
	if successorBlock == nil || !bytes.Equal(successorBlock.AppHash, targetAppHash) {
		return AuthenticatedEvidenceVerification{}, errors.New("successor header does not authenticate post-target application state")
	}
	commitRaw, err := base64.StdEncoding.Strict().DecodeString(evidence.SuccessorCommitProto)
	if err != nil {
		return AuthenticatedEvidenceVerification{}, fmt.Errorf("successor commit base64: %w", err)
	}
	totalProtoBytes += int64(len(commitRaw))
	if totalProtoBytes > MaxEvidenceProtoBytes {
		return AuthenticatedEvidenceVerification{}, errors.New("evidence protobuf bounds exceeded")
	}
	var protoCommit cmtproto.Commit
	if err := protoCommit.Unmarshal(commitRaw); err != nil {
		return AuthenticatedEvidenceVerification{}, fmt.Errorf("successor commit protobuf: %w", err)
	}
	commit, err := cmttypes.CommitFromProto(&protoCommit)
	if err != nil {
		return AuthenticatedEvidenceVerification{}, fmt.Errorf("successor commit: %w", err)
	}
	if commit.Height != successor || !commit.BlockID.Equals(successorID) {
		return AuthenticatedEvidenceVerification{}, errors.New("successor commit does not match successor block")
	}
	if err := validatorSet.VerifyCommit(approved.ChainID, successorID, successor, commit); err != nil {
		return AuthenticatedEvidenceVerification{}, fmt.Errorf("successor commit quorum: %w", err)
	}
	signatures := 0
	for _, signature := range commit.Signatures {
		if signature.BlockIDFlag == cmttypes.BlockIDFlagCommit && len(signature.Signature) > 0 {
			signatures++
		}
	}
	profile, _, err := genesis.Build()
	if err != nil {
		return AuthenticatedEvidenceVerification{}, err
	}
	return AuthenticatedEvidenceVerification{
		Schema: "OwnerLocalR4AuthenticatedEvidenceVerificationV1", SessionID: approved.SessionID, ChainID: approved.ChainID,
		AuthNetworkID: profile.NetworkHex(), AuctionID: genesis.Auction.AuctionID,
		AuthenticatedGenesisSHA: authSHA, CombinedGenesisSHA: combinedSHA, SourceSlot: evidence.SourceSlot,
		TargetHeight: evidence.TargetHeight, TargetBlockID: strings.ToLower(hex.EncodeToString(targetID.Hash)), TargetAppHash: strings.ToLower(hex.EncodeToString(targetAppHash)),
		SuccessorHeight: successor, SuccessorBlockID: strings.ToLower(hex.EncodeToString(successorID.Hash)), CommitSignatures: signatures,
		AuthenticatedReplay: true, NostrSignaturesVerified: true,
	}, nil
}

func WriteAuthenticatedEvidence(path string, evidence AuthenticatedEvidence) error {
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
		writeErr = errors.New("short authenticated evidence write")
	}
	if syncErr := file.Sync(); writeErr == nil {
		writeErr = syncErr
	}
	if closeErr := file.Close(); writeErr == nil {
		writeErr = closeErr
	}
	return writeErr
}

func LoadAuthenticatedEvidence(path string) (AuthenticatedEvidence, error) {
	raw, err := ReadFileBounded(path, MaxEvidenceBytes)
	if err != nil {
		return AuthenticatedEvidence{}, err
	}
	var evidence AuthenticatedEvidence
	if err := decodeStrictJSON(raw, MaxEvidenceBytes, &evidence, map[string]int{"$.blocks": MaxEvidenceHeight}); err != nil {
		return AuthenticatedEvidence{}, err
	}
	return evidence, nil
}

func CompareAuthenticatedEvidence(approvedSessionRaw, approvedAuthGenesisRaw []byte, values []AuthenticatedEvidence) (AuthenticatedEvidenceAgreement, error) {
	if len(values) != 4 {
		return AuthenticatedEvidenceAgreement{}, fmt.Errorf("evidence count %d, want exactly 4", len(values))
	}
	verifications := make([]AuthenticatedEvidenceVerification, len(values))
	for index, value := range values {
		verification, err := VerifyAuthenticatedEvidenceAgainst(value, approvedSessionRaw, approvedAuthGenesisRaw)
		if err != nil {
			return AuthenticatedEvidenceAgreement{}, fmt.Errorf("evidence %d: %w", index+1, err)
		}
		verifications[index] = verification
	}
	first := verifications[0]
	slots := make(map[int]struct{}, 4)
	for index, value := range values {
		comparison := verifications[index]
		comparison.SourceSlot = first.SourceSlot
		expected := first
		expected.SourceSlot = first.SourceSlot
		if comparison != expected {
			return AuthenticatedEvidenceAgreement{}, fmt.Errorf("evidence %d does not agree on the verified proof result", index+1)
		}
		if _, exists := slots[value.SourceSlot]; exists {
			return AuthenticatedEvidenceAgreement{}, fmt.Errorf("evidence %d duplicates claimed source slot %d", index+1, value.SourceSlot)
		}
		slots[value.SourceSlot] = struct{}{}
	}
	claimed := make([]int, 0, len(slots))
	for slot := range slots {
		claimed = append(claimed, slot)
	}
	sort.Ints(claimed)
	if len(claimed) != 4 || claimed[0] != 1 || claimed[1] != 2 || claimed[2] != 3 || claimed[3] != 4 {
		return AuthenticatedEvidenceAgreement{}, errors.New("evidence does not contain exact claimed slots 1..4")
	}
	return AuthenticatedEvidenceAgreement{
		Schema: AuthenticatedAgreementSchemaName, Agreement: true,
		SessionID: first.SessionID, ChainID: first.ChainID, AuthNetworkID: first.AuthNetworkID, AuctionID: first.AuctionID,
		AuthenticatedGenesisSHA256: first.AuthenticatedGenesisSHA, CombinedGenesisSHA256: first.CombinedGenesisSHA,
		TargetHeight: first.TargetHeight, TargetBlockID: first.TargetBlockID, TargetAppHash: first.TargetAppHash,
		ClaimedSlots: claimed, CollectorProvenanceVerified: false, AuthenticatedReplayVerified: true, NostrSignaturesVerified: true,
		Warning: "cryptographic proof agreement does not prove four independent physical collectors; source-slot provenance remains a bounded collector claim",
	}, nil
}
