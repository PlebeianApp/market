package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/PlebeianApp/market/services/auction-consensus/internal/auction"
	"github.com/PlebeianApp/market/services/auction-consensus/internal/bidauth"
	"github.com/PlebeianApp/market/services/auction-consensus/internal/demo"
	"github.com/btcsuite/btcd/btcec/v2"
	"github.com/btcsuite/btcd/btcec/v2/schnorr"
)

const (
	testNetwork = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20"
	testChain   = "owner-local-test-chain"
	testAuction = "owner-local-test-auction"
)

type testJournalResponse struct {
	EventID         string `json:"event_id"`
	TransactionHash string `json:"transaction_sha256"`
	Height          int64  `json:"height"`
	CheckTxCode     uint32 `json:"check_tx_code"`
	FinalizeTxCode  uint32 `json:"finalize_tx_code"`
}

type testJournalRecord struct {
	Schema      string              `json:"schema"`
	RecordIndex int                 `json:"record_index"`
	Method      string              `json:"method"`
	Path        string              `json:"path"`
	Status      int                 `json:"status"`
	Response    testJournalResponse `json:"response"`
	SignedEvent json.RawMessage     `json:"signed_event"`
}

func TestExportAndValidatePositive(t *testing.T) {
	journal := makeJournal(t, 2)
	directory := t.TempDir()
	journalPath := filepath.Join(directory, "proxy.jsonl")
	outputPath := filepath.Join(directory, "owner-signed-events.json")
	if err := os.WriteFile(journalPath, journal, 0o600); err != nil {
		t.Fatal(err)
	}
	var receipt bytes.Buffer
	if err := run(exportArgs(journalPath, outputPath, 2), &receipt); err != nil {
		t.Fatalf("export: %v", err)
	}
	assertReceipt(t, receipt.Bytes(), "export", 2, true, true)
	info, err := os.Stat(outputPath)
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("output metadata: info=%v err=%v", info, err)
	}
	raw, err := os.ReadFile(outputPath)
	if err != nil || bytes.HasSuffix(raw, []byte{'\n'}) {
		t.Fatalf("output is not compact newline-free JSON: err=%v", err)
	}
	receipt.Reset()
	if err := run(validateArgs(outputPath, 2), &receipt); err != nil {
		t.Fatalf("validate: %v", err)
	}
	assertReceipt(t, receipt.Bytes(), "validate", 2, false, false)
	if err := run(exportArgs(journalPath, outputPath, 2), &bytes.Buffer{}); err == nil || !strings.Contains(err.Error(), "fresh output") {
		t.Fatalf("no-clobber export error = %v", err)
	}
}

func TestJournalTamperRejection(t *testing.T) {
	valid := makeJournal(t, 1)
	tests := []struct {
		name   string
		mutate func(t *testing.T, record map[string]any) []byte
		want   string
	}{
		{
			name: "changed ID",
			mutate: func(t *testing.T, record map[string]any) []byte {
				event := record["signed_event"].(map[string]any)
				event["id"] = strings.Repeat("0", 64)
				record["response"].(map[string]any)["event_id"] = strings.Repeat("0", 64)
				return marshalJournalMap(t, record)
			},
			want: "event ID",
		},
		{
			name: "changed signature",
			mutate: func(t *testing.T, record map[string]any) []byte {
				event := record["signed_event"].(map[string]any)
				event["sig"] = flipHex(event["sig"].(string))
				return marshalJournalMap(t, record)
			},
			want: "signature",
		},
		{
			name: "changed content",
			mutate: func(t *testing.T, record map[string]any) []byte {
				event := record["signed_event"].(map[string]any)
				event["content"] = strings.Replace(event["content"].(string), "bid-1", "bid-x", 1)
				return marshalJournalMap(t, record)
			},
			want: "event ID",
		},
		{
			name: "changed domain",
			mutate: func(t *testing.T, record map[string]any) []byte {
				event := record["signed_event"].(map[string]any)
				tags := event["tags"].([]any)
				environment := tags[2].([]any)
				environment[1] = strings.Repeat("f", 64)
				return marshalJournalMap(t, record)
			},
			want: "profile tag",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var record map[string]any
			if err := json.Unmarshal(bytes.TrimSuffix(valid, []byte{'\n'}), &record); err != nil {
				t.Fatal(err)
			}
			assertJournalRejected(t, test.mutate(t, record), 1, test.want)
		})
	}
}

func TestDuplicateAndTruncatedJournalRejection(t *testing.T) {
	first := bytes.TrimSuffix(makeJournal(t, 1), []byte{'\n'})
	var second map[string]any
	if err := json.Unmarshal(first, &second); err != nil {
		t.Fatal(err)
	}
	second["record_index"] = float64(2)
	duplicate := append(append(append([]byte(nil), first...), '\n'), marshalJournalMap(t, second)...)
	assertJournalRejected(t, duplicate, 2, "duplicate signed event ID")

	truncated := bytes.TrimSuffix(makeJournal(t, 1), []byte{'\n'})
	assertJournalRejected(t, truncated, 1, "truncated")

	completePrefix := makeJournal(t, 1)
	assertJournalRejected(t, completePrefix, 2, "does not equal expected-count")
}

func TestValidateRejectsCryptographicAndEnvelopeTampering(t *testing.T) {
	directory := t.TempDir()
	journalPath := filepath.Join(directory, "proxy.jsonl")
	outputPath := filepath.Join(directory, "export.json")
	if err := os.WriteFile(journalPath, makeJournal(t, 1), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := run(exportArgs(journalPath, outputPath, 1), &bytes.Buffer{}); err != nil {
		t.Fatal(err)
	}
	original, err := os.ReadFile(outputPath)
	if err != nil {
		t.Fatal(err)
	}
	var envelope map[string]any
	if err := json.Unmarshal(original, &envelope); err != nil {
		t.Fatal(err)
	}
	envelope["auth_network_id"] = strings.Repeat("f", 64)
	tampered := filepath.Join(directory, "tampered-domain.json")
	writeJSON(t, tampered, envelope)
	if err := run(validateArgs(tampered, 1), &bytes.Buffer{}); err == nil || !strings.Contains(err.Error(), "auth_network_id") {
		t.Fatalf("domain tamper error = %v", err)
	}

	if err := json.Unmarshal(original, &envelope); err != nil {
		t.Fatal(err)
	}
	records := envelope["records"].([]any)
	event := records[0].(map[string]any)["signed_event"].(map[string]any)
	event["sig"] = flipHex(event["sig"].(string))
	tampered = filepath.Join(directory, "tampered-signature.json")
	writeJSON(t, tampered, envelope)
	if err := run(validateArgs(tampered, 1), &bytes.Buffer{}); err == nil || !strings.Contains(err.Error(), "signature") {
		t.Fatalf("signature tamper error = %v", err)
	}
}

func makeJournal(t *testing.T, count int) []byte {
	t.Helper()
	profile := testProfile(t, testNetwork)
	privateKey, _ := btcec.PrivKeyFromBytes(bytes.Repeat([]byte{0x31}, 32))
	var result []byte
	for index := 1; index <= count; index++ {
		command := auction.Command{
			Version:      auction.CommandVersion,
			Kind:         auction.CommandBid,
			OperationID:  "operation-" + strconv.Itoa(index),
			AuctionID:    testAuction,
			BidID:        "bid-" + strconv.Itoa(index),
			Amount:       int64(100 + index),
			Reservations: []auction.ReservationInput{{ReservationID: "reservation-" + strconv.Itoa(index), Amount: int64(100 + index)}},
		}
		content, err := auction.EncodeCommand(command, demo.Policy())
		if err != nil {
			t.Fatal(err)
		}
		created := int64(1_700_000_000 + index)
		tags, err := bidauth.ExpectedTags(profile, created+100)
		if err != nil {
			t.Fatal(err)
		}
		var publicKey [32]byte
		copy(publicKey[:], schnorr.SerializePubKey(privateKey.PubKey()))
		signed := bidauth.SignedEvent{Event: bidauth.UnsignedEvent{PublicKey: publicKey, CreatedAt: created, Kind: bidauth.DemoBidKind, Tags: tags, Content: string(content)}}
		signed.ID, err = bidauth.ComputeEventID(signed.Event, bidauth.EventLimitsForProfile())
		if err != nil {
			t.Fatal(err)
		}
		signature, err := schnorr.Sign(privateKey, signed.ID[:])
		if err != nil {
			t.Fatal(err)
		}
		copy(signed.Signature[:], signature.Serialize())
		eventJSON, err := bidauth.EncodeBridgeJSON(signed, profile)
		if err != nil {
			t.Fatal(err)
		}
		wire, err := bidauth.EncodeWire(signed, profile)
		if err != nil {
			t.Fatal(err)
		}
		wireHash := sha256.Sum256(wire)
		record := testJournalRecord{
			Schema: journalSchema, RecordIndex: index, Method: "POST", Path: "/v1/demo-auth/bids", Status: 200,
			Response:    testJournalResponse{EventID: hex.EncodeToString(signed.ID[:]), TransactionHash: hex.EncodeToString(wireHash[:]), Height: int64(index), CheckTxCode: 0, FinalizeTxCode: 0},
			SignedEvent: eventJSON,
		}
		raw, err := json.Marshal(record)
		if err != nil {
			t.Fatal(err)
		}
		result = append(result, raw...)
		result = append(result, '\n')
	}
	return result
}

func testProfile(t *testing.T, network string) bidauth.Profile {
	t.Helper()
	raw, err := hex.DecodeString(network)
	if err != nil {
		t.Fatal(err)
	}
	var networkID [32]byte
	copy(networkID[:], raw)
	return bidauth.Profile{NetworkID: networkID, ChainID: testChain, ActivationHeight: bidauth.DemoActivationHeight}
}

func exportArgs(journal, output string, count int) []string {
	return []string{"export", "--journal", journal, "--output", output, "--auth-network-id", testNetwork, "--chain-id", testChain, "--auction-id", testAuction, "--expected-count", strconv.Itoa(count)}
}

func validateArgs(input string, count int) []string {
	return []string{"validate", "--input", input, "--auth-network-id", testNetwork, "--chain-id", testChain, "--auction-id", testAuction, "--expected-count", strconv.Itoa(count)}
}

func assertReceipt(t *testing.T, raw []byte, mode string, count int, responseBound, transactionBound bool) {
	t.Helper()
	var value summary
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatal(err)
	}
	if value.Mode != mode || value.RecordCount != count || len(value.EventIDs) != count || !value.EventIDsRecomputed || !value.SignaturesVerified || !value.ProfileAndDomainVerified || value.RequestResponseBound != responseBound || value.TransactionHashesVerified != transactionBound {
		t.Fatalf("receipt = %+v", value)
	}
}

func assertJournalRejected(t *testing.T, raw []byte, expected int, want string) {
	t.Helper()
	directory := t.TempDir()
	journal := filepath.Join(directory, "proxy.jsonl")
	output := filepath.Join(directory, "export.json")
	if err := os.WriteFile(journal, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	err := run(exportArgs(journal, output, expected), &bytes.Buffer{})
	if err == nil || !strings.Contains(err.Error(), want) {
		t.Fatalf("error = %v, want substring %q", err, want)
	}
	if _, statErr := os.Stat(output); !os.IsNotExist(statErr) {
		t.Fatalf("failed validation created output: %v", statErr)
	}
}

func marshalJournalMap(t *testing.T, value map[string]any) []byte {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return append(raw, '\n')
}

func writeJSON(t *testing.T, path string, value any) {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
}

func flipHex(value string) string {
	if value[0] == '0' {
		return "1" + value[1:]
	}
	return "0" + value[1:]
}
