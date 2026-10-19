// Command auction-signed-event-tool verifies the owner-local proxy's
// append-only successful-Bid journal and exports the full signed NIP-01
// events needed for later payment evidence. It performs no network I/O and
// has no signing or private-key capability.
package main

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/PlebeianApp/market/services/auction-consensus/internal/auction"
	"github.com/PlebeianApp/market/services/auction-consensus/internal/bidauth"
	"github.com/PlebeianApp/market/services/auction-consensus/internal/demo"
)

const (
	journalSchema = "OwnerLocalR4BidProxyJournalRecordV1"
	exportSchema  = "OwnerLocalR4SignedEventExportV1"
	maxRecords    = 5
	maxJournal    = 64 * 1024
	maxExport     = 64 * 1024
)

type identity struct {
	NetworkID string
	ChainID   string
	AuctionID string
	Expected  int
	profile   bidauth.Profile
}

type journalRecord struct {
	Index       int
	Response    journalResponse
	SignedEvent json.RawMessage
}

type journalResponse struct {
	EventID         string
	TransactionHash string
	Height          int64
	CheckTxCode     uint32
	FinalizeTxCode  uint32
}

type exportRecord struct {
	CommittedEventID string          `json:"committed_event_id"`
	SignedEvent      json.RawMessage `json:"signed_event"`
}

type signedEventExport struct {
	Schema        string         `json:"schema"`
	AuthNetworkID string         `json:"auth_network_id"`
	ChainID       string         `json:"chain_id"`
	AuctionID     string         `json:"auction_id"`
	Records       []exportRecord `json:"records"`
}

type verifiedRecord struct {
	EventID     string
	OperationID string
	BidID       string
	Canonical   json.RawMessage
}

type summary struct {
	Schema                    string   `json:"schema"`
	Mode                      string   `json:"mode"`
	AuthNetworkID             string   `json:"auth_network_id"`
	ChainID                   string   `json:"chain_id"`
	AuctionID                 string   `json:"auction_id"`
	RecordCount               int      `json:"record_count"`
	EventIDs                  []string `json:"event_ids"`
	EventIDsRecomputed        bool     `json:"event_ids_recomputed"`
	SignaturesVerified        bool     `json:"signatures_verified"`
	ProfileAndDomainVerified  bool     `json:"profile_and_domain_verified"`
	RequestResponseBound      bool     `json:"request_response_bound"`
	TransactionHashesVerified bool     `json:"transaction_hashes_verified"`
}

func main() {
	if err := run(os.Args[1:], os.Stdout); err != nil {
		fmt.Fprintf(os.Stderr, "auction-signed-event-tool: %v\n", err)
		os.Exit(1)
	}
}

func run(args []string, stdout io.Writer) error {
	if len(args) == 0 {
		return errors.New("usage: auction-signed-event-tool export|validate [options]")
	}
	switch args[0] {
	case "export":
		return runExport(args[1:], stdout)
	case "validate":
		return runValidate(args[1:], stdout)
	default:
		return fmt.Errorf("unknown mode %q", args[0])
	}
}

func commonFlags(name string, args []string) (*flag.FlagSet, *string, *string, *string, *int, error) {
	set := flag.NewFlagSet(name, flag.ContinueOnError)
	set.SetOutput(io.Discard)
	network := set.String("auth-network-id", "", "exact 32-byte lowercase hexadecimal authentication network ID")
	chain := set.String("chain-id", "", "exact chain ID")
	auctionID := set.String("auction-id", "", "exact auction ID")
	expected := set.Int("expected-count", 0, "exact expected successful Bid count (1..5)")
	return set, network, chain, auctionID, expected, nil
}

func runExport(args []string, stdout io.Writer) error {
	set, network, chain, auctionID, expected, _ := commonFlags("export", args)
	journal := set.String("journal", "", "newline-terminated proxy journal")
	output := set.String("output", "", "fresh signed-event export path")
	if err := set.Parse(args); err != nil || set.NArg() != 0 {
		return errors.New("usage: export --journal PATH --output FRESH_PATH --auth-network-id HEX --chain-id ID --auction-id ID --expected-count 1..5")
	}
	id, err := newIdentity(*network, *chain, *auctionID, *expected)
	if err != nil {
		return err
	}
	if *journal == "" || *output == "" || *journal == *output {
		return errors.New("distinct journal and output paths are required")
	}
	records, err := readJournal(*journal, id)
	if err != nil {
		return err
	}
	exported := signedEventExport{Schema: exportSchema, AuthNetworkID: id.NetworkID, ChainID: id.ChainID, AuctionID: id.AuctionID, Records: make([]exportRecord, len(records))}
	eventIDs := make([]string, len(records))
	for index, record := range records {
		exported.Records[index] = exportRecord{CommittedEventID: record.EventID, SignedEvent: record.Canonical}
		eventIDs[index] = record.EventID
	}
	raw, err := json.Marshal(exported)
	if err != nil || len(raw) > maxExport {
		return errors.New("export cannot be encoded within its size limit")
	}
	if err := writeExclusive(*output, raw); err != nil {
		return err
	}
	return writeSummary(stdout, summary{Schema: "OwnerLocalR4SignedEventToolReceiptV1", Mode: "export", AuthNetworkID: id.NetworkID, ChainID: id.ChainID, AuctionID: id.AuctionID, RecordCount: len(records), EventIDs: eventIDs, EventIDsRecomputed: true, SignaturesVerified: true, ProfileAndDomainVerified: true, RequestResponseBound: true, TransactionHashesVerified: true})
}

func runValidate(args []string, stdout io.Writer) error {
	set, network, chain, auctionID, expected, _ := commonFlags("validate", args)
	input := set.String("input", "", "signed-event export path")
	if err := set.Parse(args); err != nil || set.NArg() != 0 {
		return errors.New("usage: validate --input PATH --auth-network-id HEX --chain-id ID --auction-id ID --expected-count 1..5")
	}
	id, err := newIdentity(*network, *chain, *auctionID, *expected)
	if err != nil {
		return err
	}
	if *input == "" {
		return errors.New("input path is required")
	}
	records, err := readExport(*input, id)
	if err != nil {
		return err
	}
	eventIDs := make([]string, len(records))
	for index := range records {
		eventIDs[index] = records[index].EventID
	}
	return writeSummary(stdout, summary{Schema: "OwnerLocalR4SignedEventToolReceiptV1", Mode: "validate", AuthNetworkID: id.NetworkID, ChainID: id.ChainID, AuctionID: id.AuctionID, RecordCount: len(records), EventIDs: eventIDs, EventIDsRecomputed: true, SignaturesVerified: true, ProfileAndDomainVerified: true, RequestResponseBound: false, TransactionHashesVerified: false})
}

func newIdentity(network, chain, auctionID string, expected int) (identity, error) {
	if !lowerHex(network, 64) {
		return identity{}, errors.New("auth-network-id must be exactly 64 lowercase hexadecimal characters")
	}
	decoded, _ := hex.DecodeString(network)
	var networkID [32]byte
	copy(networkID[:], decoded)
	if chain == "" || len(chain) > 256 || !utf8.ValidString(chain) || strings.ContainsAny(chain, "\r\n\x00") {
		return identity{}, errors.New("chain-id is invalid")
	}
	if auctionID == "" || len(auctionID) > 64 || !utf8.ValidString(auctionID) || strings.ContainsAny(auctionID, "\r\n\x00") {
		return identity{}, errors.New("auction-id is invalid")
	}
	if expected < 1 || expected > maxRecords {
		return identity{}, errors.New("expected-count must be within 1..5")
	}
	profile := bidauth.Profile{NetworkID: networkID, ChainID: chain, ActivationHeight: bidauth.DemoActivationHeight}
	if err := profile.Validate(); err != nil {
		return identity{}, fmt.Errorf("profile: %w", err)
	}
	return identity{NetworkID: network, ChainID: chain, AuctionID: auctionID, Expected: expected, profile: profile}, nil
}

func readJournal(path string, id identity) ([]verifiedRecord, error) {
	raw, err := readBounded(path, maxJournal)
	if err != nil {
		return nil, fmt.Errorf("read journal: %w", err)
	}
	if len(raw) == 0 || raw[len(raw)-1] != '\n' {
		return nil, errors.New("journal is empty or truncated: final newline is required")
	}
	lines := bytes.Split(raw[:len(raw)-1], []byte{'\n'})
	if len(lines) != id.Expected || len(lines) > maxRecords {
		return nil, fmt.Errorf("journal record count %d does not equal expected-count %d", len(lines), id.Expected)
	}
	records := make([]verifiedRecord, len(lines))
	seenEvents := make(map[string]struct{}, len(lines))
	seenOperations := make(map[string]struct{}, len(lines))
	seenBids := make(map[string]struct{}, len(lines))
	for index, line := range lines {
		if len(line) == 0 {
			return nil, fmt.Errorf("journal record %d is empty", index+1)
		}
		journalRecord, err := decodeJournalRecord(line)
		if err != nil {
			return nil, fmt.Errorf("journal record %d: %w", index+1, err)
		}
		if journalRecord.Index != index+1 {
			return nil, fmt.Errorf("journal record %d has non-sequential record_index", index+1)
		}
		verified, signed, err := verifySignedEvent(journalRecord.SignedEvent, id)
		if err != nil {
			return nil, fmt.Errorf("journal record %d: %w", index+1, err)
		}
		if journalRecord.Response.EventID != verified.EventID {
			return nil, fmt.Errorf("journal record %d request/response event ID mismatch", index+1)
		}
		wire, err := bidauth.EncodeWire(signed, id.profile)
		if err != nil {
			return nil, fmt.Errorf("journal record %d wire encoding: %w", index+1, err)
		}
		transactionHash := sha256.Sum256(wire)
		if journalRecord.Response.TransactionHash != hex.EncodeToString(transactionHash[:]) {
			return nil, fmt.Errorf("journal record %d request/response transaction hash mismatch", index+1)
		}
		if err := recordUnique(verified, seenEvents, seenOperations, seenBids); err != nil {
			return nil, fmt.Errorf("journal record %d: %w", index+1, err)
		}
		records[index] = verified
	}
	return records, nil
}

func readExport(path string, id identity) ([]verifiedRecord, error) {
	raw, err := readBounded(path, maxExport)
	if err != nil {
		return nil, fmt.Errorf("read export: %w", err)
	}
	members, err := exactObject(raw, "schema", "auth_network_id", "chain_id", "auction_id", "records")
	if err != nil {
		return nil, fmt.Errorf("export: %w", err)
	}
	var schema, network, chain, auctionID string
	if err := decodeExact(members["schema"], &schema); err != nil || schema != exportSchema {
		return nil, errors.New("export schema is invalid")
	}
	if err := decodeExact(members["auth_network_id"], &network); err != nil || network != id.NetworkID {
		return nil, errors.New("export auth_network_id mismatch")
	}
	if err := decodeExact(members["chain_id"], &chain); err != nil || chain != id.ChainID {
		return nil, errors.New("export chain_id mismatch")
	}
	if err := decodeExact(members["auction_id"], &auctionID); err != nil || auctionID != id.AuctionID {
		return nil, errors.New("export auction_id mismatch")
	}
	var rawRecords []json.RawMessage
	if err := decodeExact(members["records"], &rawRecords); err != nil || len(rawRecords) != id.Expected || len(rawRecords) > maxRecords {
		return nil, errors.New("export records do not match expected-count")
	}
	records := make([]verifiedRecord, len(rawRecords))
	seenEvents := make(map[string]struct{}, len(rawRecords))
	seenOperations := make(map[string]struct{}, len(rawRecords))
	seenBids := make(map[string]struct{}, len(rawRecords))
	for index, rawRecord := range rawRecords {
		recordMembers, err := exactObject(rawRecord, "committed_event_id", "signed_event")
		if err != nil {
			return nil, fmt.Errorf("export record %d: %w", index+1, err)
		}
		var committedID string
		if err := decodeExact(recordMembers["committed_event_id"], &committedID); err != nil || !lowerHex(committedID, 64) {
			return nil, fmt.Errorf("export record %d committed_event_id is invalid", index+1)
		}
		verified, _, err := verifySignedEvent(recordMembers["signed_event"], id)
		if err != nil {
			return nil, fmt.Errorf("export record %d: %w", index+1, err)
		}
		if verified.EventID != committedID {
			return nil, fmt.Errorf("export record %d committed event ID mismatch", index+1)
		}
		if err := recordUnique(verified, seenEvents, seenOperations, seenBids); err != nil {
			return nil, fmt.Errorf("export record %d: %w", index+1, err)
		}
		records[index] = verified
	}
	return records, nil
}

func verifySignedEvent(raw []byte, id identity) (verifiedRecord, bidauth.SignedEvent, error) {
	signed, err := bidauth.DecodeBridgeJSON(raw, id.profile)
	if err != nil {
		return verifiedRecord{}, bidauth.SignedEvent{}, fmt.Errorf("decode signed event: %w", err)
	}
	verified, err := bidauth.VerifyEvent(signed, bidauth.EventLimitsForProfile(), bidauth.BTCECBIP340Verifier{})
	if err != nil {
		return verifiedRecord{}, bidauth.SignedEvent{}, fmt.Errorf("verify event ID/signature: %w", err)
	}
	// Using the signed creation second as the observation point proves the
	// exact profile domain and that the signed lifetime is canonical and
	// nonempty. Actual commit-time window acceptance remains consensus evidence.
	if _, err := bidauth.ValidateProfileEvent(verified, id.profile, signed.Event.CreatedAt); err != nil {
		return verifiedRecord{}, bidauth.SignedEvent{}, fmt.Errorf("validate profile/domain: %w", err)
	}
	command, err := auction.DecodeCommand([]byte(signed.Event.Content), demo.Policy())
	if err != nil || command.Kind != auction.CommandBid || command.AuctionID != id.AuctionID {
		return verifiedRecord{}, bidauth.SignedEvent{}, errors.New("signed content is not a valid Bid for the fixed auction")
	}
	canonicalCommand, err := auction.EncodeCommand(command, demo.Policy())
	if err != nil || !bytes.Equal(canonicalCommand, []byte(signed.Event.Content)) {
		return verifiedRecord{}, bidauth.SignedEvent{}, errors.New("signed Bid content is not canonical")
	}
	canonicalEvent, err := bidauth.EncodeBridgeJSON(signed, id.profile)
	if err != nil {
		return verifiedRecord{}, bidauth.SignedEvent{}, fmt.Errorf("canonical event encoding: %w", err)
	}
	eventID := hex.EncodeToString(signed.ID[:])
	return verifiedRecord{EventID: eventID, OperationID: command.OperationID, BidID: command.BidID, Canonical: canonicalEvent}, signed, nil
}

func recordUnique(record verifiedRecord, events, operations, bids map[string]struct{}) error {
	if _, exists := events[record.EventID]; exists {
		return errors.New("duplicate signed event ID")
	}
	if _, exists := operations[record.OperationID]; exists {
		return errors.New("duplicate Bid operation ID")
	}
	if _, exists := bids[record.BidID]; exists {
		return errors.New("duplicate Bid ID")
	}
	events[record.EventID] = struct{}{}
	operations[record.OperationID] = struct{}{}
	bids[record.BidID] = struct{}{}
	return nil
}

func decodeJournalRecord(raw []byte) (journalRecord, error) {
	members, err := exactObject(raw, "schema", "record_index", "method", "path", "status", "response", "signed_event")
	if err != nil {
		return journalRecord{}, err
	}
	var schema, method, path string
	if err := decodeExact(members["schema"], &schema); err != nil || schema != journalSchema {
		return journalRecord{}, errors.New("invalid journal schema")
	}
	if err := decodeExact(members["method"], &method); err != nil || method != "POST" {
		return journalRecord{}, errors.New("journal method is not POST")
	}
	if err := decodeExact(members["path"], &path); err != nil || path != "/v1/demo-auth/bids" {
		return journalRecord{}, errors.New("journal path is invalid")
	}
	index64, err := canonicalInt(members["record_index"], 1, maxRecords)
	if err != nil {
		return journalRecord{}, fmt.Errorf("record_index: %w", err)
	}
	status, err := canonicalInt(members["status"], 200, 200)
	if err != nil || status != 200 {
		return journalRecord{}, errors.New("journal status is not successful HTTP 200")
	}
	response, err := decodeJournalResponse(members["response"])
	if err != nil {
		return journalRecord{}, err
	}
	return journalRecord{Index: int(index64), Response: response, SignedEvent: append(json.RawMessage(nil), members["signed_event"]...)}, nil
}

func decodeJournalResponse(raw []byte) (journalResponse, error) {
	members, err := exactObject(raw, "event_id", "transaction_sha256", "height", "check_tx_code", "finalize_tx_code")
	if err != nil {
		return journalResponse{}, fmt.Errorf("response: %w", err)
	}
	var eventID, transactionHash string
	if err := decodeExact(members["event_id"], &eventID); err != nil || !lowerHex(eventID, 64) {
		return journalResponse{}, errors.New("response event_id is invalid")
	}
	if err := decodeExact(members["transaction_sha256"], &transactionHash); err != nil || !lowerHex(transactionHash, 64) {
		return journalResponse{}, errors.New("response transaction_sha256 is invalid")
	}
	height, err := canonicalInt(members["height"], 1, bidauth.DemoMaxInteger)
	if err != nil {
		return journalResponse{}, fmt.Errorf("response height: %w", err)
	}
	check, err := canonicalInt(members["check_tx_code"], 0, 0)
	if err != nil {
		return journalResponse{}, errors.New("response check_tx_code is not zero")
	}
	finalize, err := canonicalInt(members["finalize_tx_code"], 0, 0)
	if err != nil {
		return journalResponse{}, errors.New("response finalize_tx_code is not zero")
	}
	return journalResponse{EventID: eventID, TransactionHash: transactionHash, Height: height, CheckTxCode: uint32(check), FinalizeTxCode: uint32(finalize)}, nil
}

func exactObject(raw []byte, names ...string) (map[string]json.RawMessage, error) {
	if len(raw) == 0 || !utf8.Valid(raw) {
		return nil, errors.New("object is empty or invalid UTF-8")
	}
	allowed := make(map[string]struct{}, len(names))
	for _, name := range names {
		allowed[name] = struct{}{}
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	start, err := decoder.Token()
	if err != nil || start != json.Delim('{') {
		return nil, errors.New("value is not an object")
	}
	members := make(map[string]json.RawMessage, len(names))
	for decoder.More() {
		token, err := decoder.Token()
		name, ok := token.(string)
		if err != nil || !ok {
			return nil, errors.New("object member name is invalid")
		}
		if _, ok := allowed[name]; !ok {
			return nil, fmt.Errorf("unknown object member %q", name)
		}
		if _, duplicate := members[name]; duplicate {
			return nil, fmt.Errorf("duplicate object member %q", name)
		}
		var value json.RawMessage
		if err := decoder.Decode(&value); err != nil {
			return nil, fmt.Errorf("object member %q is invalid", name)
		}
		members[name] = value
	}
	end, err := decoder.Token()
	if err != nil || end != json.Delim('}') || len(members) != len(names) {
		return nil, errors.New("object does not have the exact required members")
	}
	if err := ensureEOF(decoder); err != nil {
		return nil, err
	}
	return members, nil
}

func decodeExact(raw []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	return ensureEOF(decoder)
}

func ensureEOF(decoder *json.Decoder) error {
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return errors.New("value has trailing content")
	}
	return nil
}

func canonicalInt(raw []byte, minimum, maximum int64) (int64, error) {
	value, err := strconv.ParseInt(string(raw), 10, 64)
	if err != nil || value < minimum || value > maximum || strconv.FormatInt(value, 10) != string(raw) {
		return 0, errors.New("integer is not canonical or is outside its allowed range")
	}
	return value, nil
}

func readBounded(path string, limit int64) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		return nil, errors.New("path is not a regular file")
	}
	reader := bufio.NewReader(io.LimitReader(file, limit+1))
	raw, err := io.ReadAll(reader)
	if err != nil || int64(len(raw)) > limit {
		return nil, errors.New("file is unreadable or exceeds its size limit")
	}
	return raw, nil
}

func writeExclusive(path string, raw []byte) error {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return fmt.Errorf("create fresh output: %w", err)
	}
	ok := false
	defer func() {
		_ = file.Close()
		if !ok {
			// Preserve any partial evidence for diagnosis. Never unlink or replace.
		}
	}()
	written, err := file.Write(raw)
	if err != nil || written != len(raw) {
		return errors.New("write output failed; partial no-clobber file is preserved")
	}
	if err := file.Sync(); err != nil {
		return errors.New("sync output failed; written no-clobber file is preserved")
	}
	if err := file.Close(); err != nil {
		return errors.New("close output failed; written no-clobber file is preserved")
	}
	ok = true
	return nil
}

func writeSummary(writer io.Writer, value summary) error {
	encoder := json.NewEncoder(writer)
	encoder.SetEscapeHTML(false)
	return encoder.Encode(value)
}

func lowerHex(value string, length int) bool {
	if len(value) != length {
		return false
	}
	for index := range value {
		if !((value[index] >= '0' && value[index] <= '9') || (value[index] >= 'a' && value[index] <= 'f')) {
			return false
		}
	}
	return true
}
