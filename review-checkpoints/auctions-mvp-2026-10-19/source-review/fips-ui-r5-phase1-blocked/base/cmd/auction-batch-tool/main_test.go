package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/PlebeianApp/market/services/auction-consensus/internal/app"
	"github.com/PlebeianApp/market/services/auction-consensus/internal/auction"
)

const (
	testNetwork = "1111111111111111111111111111111111111111111111111111111111111111"
	testChain   = "batch-tool-chain"
	testAuction = "batch-tool-auction"
)

func TestExportAndValidateEventfulOnlyHistory(t *testing.T) {
	batches := []app.CommittedAuctionBatchV2{
		bidBatch(2, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
		closureBatch(5),
		otherAuctionBatch(8),
	}
	server := newBatchServer(t, batches)
	defer server.Close()

	directory := filepath.Join(t.TempDir(), "canonical-batches")
	var exportOutput bytes.Buffer
	if err := run(exportArguments(server.URL, directory), &exportOutput); err != nil {
		t.Fatalf("export eventful history: %v", err)
	}
	summary := decodeSummary(t, exportOutput.Bytes())
	if summary.CoverageContract != coverageContract || summary.EmptyHeightsAvailable || summary.ContinuousHeightsVerified {
		t.Fatalf("coverage was overstated: %+v", summary)
	}
	if summary.BatchCount != 2 || summary.FirstEventfulHeight != 2 || summary.LastEventfulHeight != 5 || summary.ClosureHeight != 5 {
		t.Fatalf("unexpected selected history: %+v", summary)
	}
	if len(summary.EventIDs) != 1 || summary.EventIDs[0] != strings.Repeat("b", 64) {
		t.Fatalf("unexpected target event IDs: %#v", summary.EventIDs)
	}
	entries, err := os.ReadDir(directory)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 || entries[0].Name() != "batch-00000000000000000002.json" || entries[1].Name() != "batch-00000000000000000005.json" {
		t.Fatalf("unexpected exported files: %#v", entries)
	}

	var validateOutput bytes.Buffer
	if err := run(validateArguments(directory), &validateOutput); err != nil {
		t.Fatalf("validate exported history: %v", err)
	}
	validated := decodeSummary(t, validateOutput.Bytes())
	if validated.Command != "validate" || validated.ClosureAppHash != strings.Repeat("5", 64) || !validated.CanonicalBytesVerified || !validated.CommittedBatchV2Validated {
		t.Fatalf("unexpected validation summary: %+v", validated)
	}
}

func TestValidateRejectsNonCanonicalAndMetadataTampering(t *testing.T) {
	directory := exportFixture(t)
	path := filepath.Join(directory, "batch-00000000000000000002.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var indented bytes.Buffer
	if err := json.Indent(&indented, raw, "", "  "); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, indented.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := run(validateArguments(directory), &bytes.Buffer{}); err == nil || !strings.Contains(err.Error(), "not exact") {
		t.Fatalf("expected canonical-byte rejection, got %v", err)
	}

	directory = exportFixture(t)
	path = filepath.Join(directory, "batch-00000000000000000002.json")
	if err := os.Chmod(path, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := run(validateArguments(directory), &bytes.Buffer{}); err == nil || !strings.Contains(err.Error(), "mode 0600") {
		t.Fatalf("expected metadata rejection, got %v", err)
	}
}

func TestStrictJSONDuplicateUnknownAndTrailingRejection(t *testing.T) {
	for name, raw := range map[string]string{
		"duplicate": `{"batches":[],"batches":[]}`,
		"unknown":   `{"batches":[],"extra":true}`,
		"trailing":  `{"batches":[]} {}`,
	} {
		t.Run(name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
				writer.Header().Set("Content-Type", "application/json")
				fmt.Fprint(writer, raw)
			}))
			defer server.Close()
			directory := filepath.Join(t.TempDir(), "canonical-batches")
			if err := run(exportArguments(server.URL, directory), &bytes.Buffer{}); err == nil {
				t.Fatal("expected strict JSON rejection")
			}
			if _, err := os.Lstat(directory); !os.IsNotExist(err) {
				t.Fatalf("failed fetch created output directory: %v", err)
			}
		})
	}
}

func TestExportRejectsIdentityClosureAndOrderingTampering(t *testing.T) {
	tests := []struct {
		name    string
		batches []app.CommittedAuctionBatchV2
	}{
		{name: "wrong network", batches: []app.CommittedAuctionBatchV2{func() app.CommittedAuctionBatchV2 {
			value := closureBatch(5)
			value.AuthNetworkID = strings.Repeat("9", 64)
			value.Closures[0].AuthNetworkID = value.AuthNetworkID
			return value
		}()}},
		{name: "no closure", batches: []app.CommittedAuctionBatchV2{bidBatch(2, strings.Repeat("a", 64))}},
		{name: "duplicate closure", batches: []app.CommittedAuctionBatchV2{closureBatch(5), closureBatch(6)}},
		{name: "repeated height", batches: []app.CommittedAuctionBatchV2{bidBatch(2, strings.Repeat("a", 64)), closureBatch(2)}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := newBatchServer(t, test.batches)
			defer server.Close()
			if err := run(exportArguments(server.URL, filepath.Join(t.TempDir(), "out")), &bytes.Buffer{}); err == nil {
				t.Fatal("expected export rejection")
			}
		})
	}
}

func TestLoopbackCoverageAndNoClobberGuards(t *testing.T) {
	directory := filepath.Join(t.TempDir(), "existing")
	if err := os.Mkdir(directory, 0o700); err != nil {
		t.Fatal(err)
	}
	arguments := exportArguments("http://127.0.0.1:1", directory)
	if err := run(arguments, &bytes.Buffer{}); err == nil || !strings.Contains(err.Error(), "no-clobber") {
		t.Fatalf("expected no-clobber refusal before HTTP, got %v", err)
	}
	arguments = exportArguments("http://192.0.2.10:8080", filepath.Join(t.TempDir(), "out"))
	if err := run(arguments, &bytes.Buffer{}); err == nil || !strings.Contains(err.Error(), "loopback") {
		t.Fatalf("expected non-loopback refusal, got %v", err)
	}
	arguments = exportArguments("http://127.0.0.1:8080", filepath.Join(t.TempDir(), "out"))
	for index := range arguments {
		if arguments[index] == "eventful-only" {
			arguments[index] = "continuous"
			break
		}
	}
	if err := run(arguments, &bytes.Buffer{}); err == nil || !strings.Contains(err.Error(), "omits empty heights") {
		t.Fatalf("expected coverage acknowledgement refusal, got %v", err)
	}
}

func TestExpectedClosureHeightPin(t *testing.T) {
	batches := []app.CommittedAuctionBatchV2{bidBatch(2, strings.Repeat("a", 64)), closureBatch(5)}
	server := newBatchServer(t, batches)
	defer server.Close()
	arguments := append(exportArguments(server.URL, filepath.Join(t.TempDir(), "out")), "--closure-height", "7")
	if err := run(arguments, &bytes.Buffer{}); err == nil || !strings.Contains(err.Error(), "does not match expected") {
		t.Fatalf("expected closure-height pin rejection, got %v", err)
	}
}

func exportFixture(t *testing.T) string {
	t.Helper()
	server := newBatchServer(t, []app.CommittedAuctionBatchV2{bidBatch(2, strings.Repeat("a", 64)), closureBatch(5)})
	defer server.Close()
	directory := filepath.Join(t.TempDir(), "canonical-batches")
	if err := run(exportArguments(server.URL, directory), &bytes.Buffer{}); err != nil {
		t.Fatalf("create export fixture: %v", err)
	}
	return directory
}

func exportArguments(baseURL, directory string) []string {
	return []string{"export", "--base-url", baseURL, "--output-dir", directory, "--auth-network-id", testNetwork, "--chain-id", testChain, "--auction-id", testAuction, "--coverage", "eventful-only"}
}

func validateArguments(directory string) []string {
	return []string{"validate", "--input-dir", directory, "--auth-network-id", testNetwork, "--chain-id", testChain, "--auction-id", testAuction, "--coverage", "eventful-only"}
}

func decodeSummary(t *testing.T, raw []byte) batchSummary {
	t.Helper()
	var summary batchSummary
	if err := decodeStrictJSON(raw, &summary); err != nil {
		t.Fatalf("decode summary: %v", err)
	}
	return summary
}

func newBatchServer(t *testing.T, batches []app.CommittedAuctionBatchV2) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v1/demo-auth/batches" || request.URL.Query().Get("limit") != "16" {
			http.Error(writer, "invalid request", http.StatusBadRequest)
			return
		}
		after, err := strconv.ParseInt(request.URL.Query().Get("after_height"), 10, 64)
		if err != nil {
			http.Error(writer, "invalid after height", http.StatusBadRequest)
			return
		}
		page := make([]app.CommittedAuctionBatchV2, 0, pageLimit)
		for _, batch := range batches {
			if batch.Height > after {
				page = append(page, batch)
				if len(page) == pageLimit {
					break
				}
			}
		}
		writer.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(writer).Encode(batchPage{Batches: page}); err != nil {
			t.Errorf("encode page: %v", err)
		}
	}))
}

func bidBatch(height int64, appHash string) app.CommittedAuctionBatchV2 {
	return app.CommittedAuctionBatchV2{
		Schema:        app.CommittedAuctionBatchSchema,
		AuthProfile:   "DEMO_AUTH_V1",
		AuthNetworkID: testNetwork,
		ChainID:       testChain,
		Height:        height,
		PBTSSeconds:   100,
		AppHash:       appHash,
		Bids: []app.CommittedBidEntry{{
			ActorID:     strings.Repeat("a", 64),
			OperationID: "operation-1",
			AuctionID:   testAuction,
			BidID:       "bid-1",
			EventID:     strings.Repeat("b", 64),
			Amount:      1,
		}},
		Closures: []app.CommittedAutomaticCloseEntry{},
	}
}

func closureBatch(height int64) app.CommittedAuctionBatchV2 {
	hashCharacter := byte('0' + byte(height%10))
	appHash := strings.Repeat(string(hashCharacter), 64)
	return app.CommittedAuctionBatchV2{
		Schema:        app.CommittedAuctionBatchSchema,
		AuthProfile:   "DEMO_AUTH_V1",
		AuthNetworkID: testNetwork,
		ChainID:       testChain,
		Height:        height,
		PBTSSeconds:   100,
		AppHash:       appHash,
		Bids:          []app.CommittedBidEntry{},
		Closures: []app.CommittedAutomaticCloseEntry{{
			AuthNetworkID: testNetwork,
			ChainID:       testChain,
			AuctionID:     testAuction,
			Height:        height,
			PBTSSeconds:   100,
			EffectiveEnd:  100,
			AppHash:       appHash,
			CloseOutcome:  auction.OutcomeNoBids,
		}},
	}
}

func otherAuctionBatch(height int64) app.CommittedAuctionBatchV2 {
	batch := bidBatch(height, strings.Repeat("8", 64))
	batch.Bids[0].AuctionID = "other-auction"
	batch.Bids[0].EventID = strings.Repeat("c", 64)
	return batch
}
