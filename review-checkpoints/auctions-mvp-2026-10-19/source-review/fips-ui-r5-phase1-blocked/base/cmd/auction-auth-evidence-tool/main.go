package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/PlebeianApp/market/services/auction-consensus/internal/demo"
)

var (
	revision  = "development"
	buildTime = "unknown"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "auction-auth-evidence-tool:", err)
		os.Exit(1)
	}
}

func run(arguments []string) error {
	if len(arguments) == 0 {
		return usageError()
	}
	switch arguments[0] {
	case "version":
		return printJSON(map[string]string{"revision": revision, "build_time": buildTime})
	case "collect":
		return collect(arguments[1:])
	case "validate":
		return validate(arguments[1:])
	case "compare":
		return compare(arguments[1:])
	case "handoff":
		return handoff(arguments[1:])
	default:
		return usageError()
	}
}

func usageError() error {
	return errors.New("usage: auction-auth-evidence-tool {version|collect|validate|compare|handoff}")
}

func loadApproved(sessionPath, authGenesisPath string) ([]byte, []byte, error) {
	if sessionPath == "" || authGenesisPath == "" {
		return nil, nil, errors.New("--session and --auth-genesis are required")
	}
	if _, err := demo.LoadSession(sessionPath); err != nil {
		return nil, nil, fmt.Errorf("session: %w", err)
	}
	sessionRaw, err := demo.ReadFileBounded(sessionPath, demo.MaxSessionBytes)
	if err != nil {
		return nil, nil, fmt.Errorf("session bytes: %w", err)
	}
	if _, err := demo.LoadAuthenticatedGenesis(authGenesisPath); err != nil {
		return nil, nil, fmt.Errorf("authenticated genesis: %w", err)
	}
	raw, err := demo.ReadFileBounded(authGenesisPath, demo.MaxAuthenticatedGenesisBytes)
	if err != nil {
		return nil, nil, fmt.Errorf("authenticated genesis bytes: %w", err)
	}
	return sessionRaw, raw, nil
}

func collect(arguments []string) error {
	flags := flag.NewFlagSet("collect", flag.ContinueOnError)
	sessionPath := flags.String("session", "", "finalized explicit-network session JSON")
	authGenesisPath := flags.String("auth-genesis", "", "exact public DEMO_AUTH_V1 genesis JSON")
	slot := flags.Int("slot", 0, "source slot 1..4")
	packet := flags.String("network-packet-id", "", "exact approved session packet id")
	acknowledgement := flags.String("acknowledgement", "", "exact DEMO_AUTH_V1 one-shot acknowledgement")
	rpcAddress := flags.String("rpc", "", "exact IP-loopback tcp:// RPC address")
	targetHeight := flags.Int64("target-height", 0, "committed closure target height")
	output := flags.String("out", "", "fresh authenticated evidence JSON path")
	timeout := flags.Duration("timeout", 30*time.Second, "bounded loopback RPC timeout")
	if err := flags.Parse(arguments); err != nil {
		return err
	}
	if flags.NArg() != 0 || *output == "" || *rpcAddress == "" || *slot < 1 || *slot > 4 || *targetHeight < 1 {
		return errors.New("collect requires --session, --auth-genesis, --slot 1..4, --network-packet-id, --acknowledgement, --rpc, --target-height, --out, and optional --timeout")
	}
	sessionRaw, authRaw, err := loadApproved(*sessionPath, *authGenesisPath)
	if err != nil {
		return err
	}
	rpc, err := demo.NewHTTPRPC(*rpcAddress, *timeout)
	if err != nil {
		return err
	}
	defer rpc.Close()
	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()
	evidence, err := demo.CollectAuthenticatedEvidence(ctx, rpc.Client, sessionRaw, authRaw, *slot, *packet, *acknowledgement, *targetHeight, time.Now())
	if err != nil {
		return err
	}
	if err := demo.WriteAuthenticatedEvidence(*output, evidence); err != nil {
		return err
	}
	verification, err := demo.VerifyAuthenticatedEvidenceAgainst(evidence, sessionRaw, authRaw)
	if err != nil {
		return err
	}
	return printJSON(map[string]any{
		"schema": "OwnerLocalR4AuthenticatedEvidenceCollectionReceiptV1", "collected": true,
		"source_slot": verification.SourceSlot, "target_height": verification.TargetHeight,
		"target_block_id": verification.TargetBlockID, "target_app_hash": verification.TargetAppHash,
		"successor_height": verification.SuccessorHeight, "nostr_signatures_verified": verification.NostrSignaturesVerified,
		"evidence_sha256": fileSHA256(*output),
	})
}

func validate(arguments []string) error {
	flags := flag.NewFlagSet("validate", flag.ContinueOnError)
	sessionPath := flags.String("session", "", "externally approved finalized session JSON")
	authGenesisPath := flags.String("auth-genesis", "", "externally approved exact public DEMO_AUTH_V1 genesis JSON")
	slot := flags.Int("slot", 0, "expected source slot 1..4")
	targetHeight := flags.Int64("target-height", 0, "expected committed closure target height")
	evidencePath := flags.String("evidence", "", "authenticated evidence JSON")
	if err := flags.Parse(arguments); err != nil {
		return err
	}
	if flags.NArg() != 0 || *evidencePath == "" || *slot < 1 || *slot > 4 || *targetHeight < 1 {
		return errors.New("validate requires --session, --auth-genesis, --slot 1..4, --target-height, and --evidence")
	}
	sessionRaw, authRaw, err := loadApproved(*sessionPath, *authGenesisPath)
	if err != nil {
		return err
	}
	evidence, err := demo.LoadAuthenticatedEvidence(*evidencePath)
	if err != nil {
		return err
	}
	if evidence.SourceSlot != *slot || evidence.TargetHeight != *targetHeight {
		return errors.New("evidence slot or target height does not match the required values")
	}
	verification, err := demo.VerifyAuthenticatedEvidenceAgainst(evidence, sessionRaw, authRaw)
	if err != nil {
		return err
	}
	return printJSON(verification)
}

func compare(arguments []string) error {
	flags := flag.NewFlagSet("compare", flag.ContinueOnError)
	sessionPath := flags.String("session", "", "externally approved finalized session JSON")
	authGenesisPath := flags.String("auth-genesis", "", "externally approved exact public DEMO_AUTH_V1 genesis JSON")
	evidence1 := flags.String("evidence-1", "", "slot-1 authenticated evidence JSON")
	evidence2 := flags.String("evidence-2", "", "slot-2 authenticated evidence JSON")
	evidence3 := flags.String("evidence-3", "", "slot-3 authenticated evidence JSON")
	evidence4 := flags.String("evidence-4", "", "slot-4 authenticated evidence JSON")
	output := flags.String("out", "", "fresh four-way agreement JSON path")
	if err := flags.Parse(arguments); err != nil {
		return err
	}
	paths := []string{*evidence1, *evidence2, *evidence3, *evidence4}
	if flags.NArg() != 0 || *output == "" {
		return errors.New("compare requires --session, --auth-genesis, --evidence-1, --evidence-2, --evidence-3, --evidence-4, and --out")
	}
	for _, path := range paths {
		if strings.TrimSpace(path) == "" {
			return errors.New("all four evidence paths are required")
		}
	}
	sessionRaw, authRaw, err := loadApproved(*sessionPath, *authGenesisPath)
	if err != nil {
		return err
	}
	values := make([]demo.AuthenticatedEvidence, 0, 4)
	for index, path := range paths {
		value, err := demo.LoadAuthenticatedEvidence(path)
		if err != nil {
			return fmt.Errorf("evidence %d: %w", index+1, err)
		}
		values = append(values, value)
	}
	agreement, err := demo.CompareAuthenticatedEvidence(sessionRaw, authRaw, values)
	if err != nil {
		return err
	}
	raw, err := json.MarshalIndent(agreement, "", "  ")
	if err != nil {
		return err
	}
	if err := writeExclusive(*output, append(raw, '\n'), 0o600); err != nil {
		return err
	}
	return printJSON(map[string]any{
		"schema": "OwnerLocalR4AuthenticatedEvidenceComparisonReceiptV1", "agreement": true,
		"target_height": agreement.TargetHeight, "target_block_id": agreement.TargetBlockID,
		"target_app_hash": agreement.TargetAppHash, "claimed_slots": agreement.ClaimedSlots,
		"nostr_signatures_verified": agreement.NostrSignaturesVerified, "agreement_sha256": fileSHA256(*output),
	})
}

func handoff(arguments []string) error {
	flags := flag.NewFlagSet("handoff", flag.ContinueOnError)
	sessionPath := flags.String("session", "", "externally approved finalized session JSON")
	authGenesisPath := flags.String("auth-genesis", "", "externally approved exact public DEMO_AUTH_V1 genesis JSON")
	evidence1 := flags.String("evidence-1", "", "slot-1 authenticated evidence JSON")
	evidence2 := flags.String("evidence-2", "", "slot-2 authenticated evidence JSON")
	evidence3 := flags.String("evidence-3", "", "slot-3 authenticated evidence JSON")
	evidence4 := flags.String("evidence-4", "", "slot-4 authenticated evidence JSON")
	batchesPath := flags.String("batches", "", "exact CommittedAuctionBatchV2 history JSON array")
	signedEventsPath := flags.String("signed-events", "", "exact OwnerLocalR4SignedEventExportV1 JSON")
	approvalsPath := flags.String("payment-approvals", "", "exact DemoPaymentApprovalV1 JSON array")
	sellerP2PKXPub := flags.String("seller-p2pk-xpub", "", "independently accepted seller public extended key")
	output := flags.String("out", "", "fresh authenticated application handoff receipt path")
	if err := flags.Parse(arguments); err != nil {
		return err
	}
	paths := []string{*evidence1, *evidence2, *evidence3, *evidence4, *batchesPath, *signedEventsPath, *approvalsPath, *output}
	if flags.NArg() != 0 {
		return errors.New("handoff accepts flags only")
	}
	if strings.TrimSpace(*sellerP2PKXPub) == "" || strings.TrimSpace(*sellerP2PKXPub) != *sellerP2PKXPub {
		return errors.New("handoff requires canonical --seller-p2pk-xpub")
	}
	for _, path := range paths {
		if strings.TrimSpace(path) == "" {
			return errors.New("handoff requires --session, --auth-genesis, --evidence-1..4, --batches, --signed-events, --payment-approvals, --seller-p2pk-xpub, and --out")
		}
	}
	sessionRaw, authRaw, err := loadApproved(*sessionPath, *authGenesisPath)
	if err != nil {
		return err
	}
	evidences := make([]demo.AuthenticatedEvidence, 0, 4)
	for index, path := range paths[:4] {
		evidence, err := demo.LoadAuthenticatedEvidence(path)
		if err != nil {
			return fmt.Errorf("evidence %d: %w", index+1, err)
		}
		evidences = append(evidences, evidence)
	}
	batchesRaw, err := demo.ReadFileBounded(*batchesPath, demo.MaxAuthenticatedHandoffBytes)
	if err != nil {
		return fmt.Errorf("batches: %w", err)
	}
	batches, err := demo.DecodeAuthenticatedHandoffBatches(batchesRaw)
	if err != nil {
		return fmt.Errorf("batches: %w", err)
	}
	signedRaw, err := demo.ReadFileBounded(*signedEventsPath, demo.MaxAuthenticatedHandoffBytes)
	if err != nil {
		return fmt.Errorf("signed events: %w", err)
	}
	exported, err := demo.DecodeSignedEventExport(signedRaw)
	if err != nil {
		return fmt.Errorf("signed events: %w", err)
	}
	approvalsRaw, err := demo.ReadFileBounded(*approvalsPath, demo.MaxAuthenticatedHandoffBytes)
	if err != nil {
		return fmt.Errorf("payment approvals: %w", err)
	}
	approvals, err := demo.DecodePaymentApprovals(approvalsRaw)
	if err != nil {
		return fmt.Errorf("payment approvals: %w", err)
	}
	receipt, err := demo.VerifyAuthenticatedApplicationHandoff(sessionRaw, authRaw, evidences, batches, exported, *sellerP2PKXPub, approvals)
	if err != nil {
		return err
	}
	raw, err := json.MarshalIndent(receipt, "", "  ")
	if err != nil {
		return err
	}
	if err := writeExclusive(*output, append(raw, '\n'), 0o600); err != nil {
		return err
	}
	return printJSON(map[string]any{
		"schema": "OwnerLocalR4AuthenticatedApplicationHandoffReceiptV2", "ready": receipt.Ready,
		"closure_height": receipt.ClosureHeight, "closure_app_hash": receipt.ClosureAppHash,
		"claimed_slots": receipt.ClaimedSlots, "raw_signed_events_verified": receipt.RawSignedEventsVerified,
		"bidder_payment_approvals_verified": receipt.BidderPaymentApprovalsVerified,
		"canonical_batch_history_sha256":    receipt.CanonicalBatchHistorySHA256,
		"verified_approval_set_sha256":      receipt.VerifiedApprovalSetSHA256,
		"approval_lifetime_policy_verified": receipt.ApprovalLifetimePolicyVerified,
		"payment_execution_verified":        false, "settlement_verified": false, "handoff_sha256": fileSHA256(*output),
	})
}

func printJSON(value any) error {
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetEscapeHTML(false)
	return encoder.Encode(value)
}

func writeExclusive(path string, raw []byte, mode os.FileMode) error {
	if strings.TrimSpace(path) == "" {
		return errors.New("output path is required")
	}
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, mode)
	if err != nil {
		return err
	}
	written, writeErr := file.Write(raw)
	if writeErr == nil && written != len(raw) {
		writeErr = errors.New("short output write")
	}
	if syncErr := file.Sync(); writeErr == nil {
		writeErr = syncErr
	}
	if closeErr := file.Close(); writeErr == nil {
		writeErr = closeErr
	}
	return writeErr
}

func fileSHA256(path string) string {
	raw, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}
