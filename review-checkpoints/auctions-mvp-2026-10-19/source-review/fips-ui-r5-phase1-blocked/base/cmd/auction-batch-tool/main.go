package main

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/PlebeianApp/market/services/auction-consensus/internal/app"
	"golang.org/x/sys/unix"
)

const (
	summarySchema       = "AuctionBatchEvidenceSummaryV1"
	coverageContract    = "eventful-heights-only"
	pageLimit           = 16
	maxHTTPResponseSize = 8 << 20
	maxBatchFileSize    = 1 << 20
	maxExportBytes      = 64 << 20
	maxExportBatches    = 100000
)

var batchFilename = regexp.MustCompile(`^batch-([0-9]{20})\.json$`)

type options struct {
	baseURL         string
	directory       string
	authNetworkID   string
	chainID         string
	auctionID       string
	expectedClosure int64
	coverage        string
}

type batchSummary struct {
	Schema                    string   `json:"schema"`
	Command                   string   `json:"command"`
	CoverageContract          string   `json:"coverage_contract"`
	EmptyHeightsAvailable     bool     `json:"empty_heights_available"`
	ContinuousHeightsVerified bool     `json:"continuous_heights_verified"`
	AuthNetworkID             string   `json:"auth_network_id"`
	ChainID                   string   `json:"chain_id"`
	AuctionID                 string   `json:"auction_id"`
	BatchCount                int      `json:"batch_count"`
	FirstEventfulHeight       int64    `json:"first_eventful_height"`
	LastEventfulHeight        int64    `json:"last_eventful_height"`
	ClosureHeight             int64    `json:"closure_height"`
	ClosureAppHash            string   `json:"closure_app_hash"`
	EventIDs                  []string `json:"event_ids"`
	CanonicalBytesVerified    bool     `json:"canonical_bytes_verified"`
	CommittedBatchV2Validated bool     `json:"committed_batch_v2_validated"`
}

type batchPage struct {
	Batches []app.CommittedAuctionBatchV2 `json:"batches"`
}

type canonicalBatch struct {
	batch app.CommittedAuctionBatchV2
	raw   []byte
}

func main() {
	if err := run(os.Args[1:], os.Stdout); err != nil {
		fmt.Fprintf(os.Stderr, "auction-batch-tool: %v\n", err)
		os.Exit(1)
	}
}

func run(arguments []string, output io.Writer) error {
	if len(arguments) == 0 {
		return errors.New("expected export or validate command")
	}
	command := arguments[0]
	configuration, err := parseOptions(command, arguments[1:])
	if err != nil {
		return err
	}
	if err := validateOptions(configuration); err != nil {
		return err
	}

	var batches []canonicalBatch
	switch command {
	case "export":
		if err := requireAbsentPath(configuration.directory); err != nil {
			return err
		}
		base, err := validateLoopbackBaseURL(configuration.baseURL)
		if err != nil {
			return err
		}
		batches, err = fetchEventfulBatches(base, configuration)
		if err != nil {
			return err
		}
	case "validate":
		batches, err = readBatchDirectory(configuration.directory)
		if err != nil {
			return err
		}
	default:
		return fmt.Errorf("unknown command %q", command)
	}

	summary, selected, err := validateBatches(command, configuration, batches)
	if err != nil {
		return err
	}
	if command == "export" {
		if err := writeBatchDirectory(configuration.directory, selected); err != nil {
			return err
		}
	}
	encoder := json.NewEncoder(output)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(summary); err != nil {
		return fmt.Errorf("write summary: %w", err)
	}
	return nil
}

func requireAbsentPath(path string) error {
	_, err := os.Lstat(path)
	if err == nil {
		return errors.New("output directory already exists; export is no-clobber")
	}
	if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("inspect output directory: %w", err)
	}
	return nil
}

func parseOptions(command string, arguments []string) (options, error) {
	var configuration options
	flags := flag.NewFlagSet(command, flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	if command == "export" {
		flags.StringVar(&configuration.baseURL, "base-url", "", "explicit loopback HTTP base URL")
		flags.StringVar(&configuration.directory, "output-dir", "", "fresh output directory")
	} else if command == "validate" {
		flags.StringVar(&configuration.directory, "input-dir", "", "existing canonical batch directory")
	} else {
		return options{}, fmt.Errorf("unknown command %q", command)
	}
	flags.StringVar(&configuration.authNetworkID, "auth-network-id", "", "fixed authenticated network ID")
	flags.StringVar(&configuration.chainID, "chain-id", "", "fixed chain ID")
	flags.StringVar(&configuration.auctionID, "auction-id", "", "fixed auction ID")
	flags.Int64Var(&configuration.expectedClosure, "closure-height", 0, "optional expected closure height")
	flags.StringVar(&configuration.coverage, "coverage", "", "must be eventful-only")
	if err := flags.Parse(arguments); err != nil {
		return options{}, fmt.Errorf("parse %s options: %w", command, err)
	}
	if flags.NArg() != 0 {
		return options{}, errors.New("positional arguments are not accepted")
	}
	return configuration, nil
}

func validateOptions(configuration options) error {
	if configuration.directory == "" || !filepath.IsAbs(configuration.directory) || filepath.Clean(configuration.directory) != configuration.directory {
		return errors.New("batch directory must be an absolute clean path")
	}
	if configuration.coverage != "eventful-only" {
		return errors.New("--coverage eventful-only is required because the bridge omits empty heights")
	}
	if len(configuration.authNetworkID) != 64 || strings.ToLower(configuration.authNetworkID) != configuration.authNetworkID {
		return errors.New("auth network ID must be 64 lowercase hexadecimal characters")
	}
	if _, err := hex.DecodeString(configuration.authNetworkID); err != nil {
		return errors.New("auth network ID must be 64 lowercase hexadecimal characters")
	}
	if err := validateIdentifier("chain ID", configuration.chainID); err != nil {
		return err
	}
	if err := validateIdentifier("auction ID", configuration.auctionID); err != nil {
		return err
	}
	if configuration.expectedClosure < 0 {
		return errors.New("closure height cannot be negative")
	}
	return nil
}

func validateIdentifier(name, value string) error {
	if value == "" || len(value) > 256 || strings.TrimSpace(value) != value {
		return fmt.Errorf("%s is empty, overlong, or has surrounding whitespace", name)
	}
	for _, character := range value {
		if character < 0x21 || character > 0x7e {
			return fmt.Errorf("%s contains a non-printable or non-ASCII character", name)
		}
	}
	return nil
}

func validateLoopbackBaseURL(raw string) (*url.URL, error) {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "http" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, errors.New("base URL must be an uncredentialed HTTP URL without query or fragment")
	}
	if parsed.Path != "" && parsed.Path != "/" {
		return nil, errors.New("base URL must not contain a path")
	}
	host, port, err := net.SplitHostPort(parsed.Host)
	if err != nil || port == "" {
		return nil, errors.New("base URL must contain an explicit IP literal and port")
	}
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsLoopback() || ip.IsUnspecified() {
		return nil, errors.New("base URL host must be an explicit loopback IP literal")
	}
	portNumber, err := strconv.ParseUint(port, 10, 16)
	if err != nil || portNumber == 0 || strconv.FormatUint(portNumber, 10) != port {
		return nil, errors.New("base URL has an invalid port")
	}
	parsed.Path = ""
	return parsed, nil
}

func fetchEventfulBatches(base *url.URL, configuration options) ([]canonicalBatch, error) {
	transport := &http.Transport{
		Proxy:             nil,
		DisableKeepAlives: true,
		DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
			host, _, err := net.SplitHostPort(address)
			if err != nil {
				return nil, errors.New("HTTP dial address is malformed")
			}
			ip := net.ParseIP(host)
			if ip == nil || !ip.IsLoopback() || ip.IsUnspecified() {
				return nil, errors.New("refusing non-loopback HTTP dial")
			}
			var dialer net.Dialer
			return dialer.DialContext(ctx, network, address)
		},
	}
	client := &http.Client{
		Transport: transport,
		Timeout:   15 * time.Second,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return errors.New("HTTP redirects are forbidden")
		},
	}
	defer transport.CloseIdleConnections()

	after := int64(0)
	result := make([]canonicalBatch, 0)
	totalBytes := 0
	for {
		target := *base
		target.Path = "/v1/demo-auth/batches"
		target.RawQuery = "after_height=" + strconv.FormatInt(after, 10) + "&limit=" + strconv.Itoa(pageLimit)
		request, err := http.NewRequest(http.MethodGet, target.String(), nil)
		if err != nil {
			return nil, fmt.Errorf("create batch request: %w", err)
		}
		request.Header.Set("Accept", "application/json")
		response, err := client.Do(request)
		if err != nil {
			return nil, fmt.Errorf("fetch batch page after height %d: %w", after, err)
		}
		raw, readErr := io.ReadAll(io.LimitReader(response.Body, maxHTTPResponseSize+1))
		closeErr := response.Body.Close()
		if readErr != nil || closeErr != nil {
			return nil, fmt.Errorf("read batch page after height %d", after)
		}
		if len(raw) > maxHTTPResponseSize {
			return nil, errors.New("batch page exceeds response limit")
		}
		mediaType, _, mediaErr := mime.ParseMediaType(response.Header.Get("Content-Type"))
		if response.StatusCode != http.StatusOK || mediaErr != nil || mediaType != "application/json" {
			return nil, fmt.Errorf("batch endpoint returned status %d or non-JSON content", response.StatusCode)
		}
		var page batchPage
		if err := decodeStrictJSON(raw, &page); err != nil {
			return nil, fmt.Errorf("decode batch page after height %d: %w", after, err)
		}
		if page.Batches == nil || len(page.Batches) > pageLimit {
			return nil, errors.New("batch endpoint returned a null or oversized page")
		}
		if len(page.Batches) == 0 {
			break
		}
		for _, batch := range page.Batches {
			if batch.Height <= after {
				return nil, errors.New("batch endpoint returned non-increasing or repeated heights")
			}
			if err := validateOneBatch(batch, configuration); err != nil {
				return nil, err
			}
			if len(batch.Bids) == 0 && len(batch.Closures) == 0 {
				return nil, fmt.Errorf("endpoint returned empty height %d despite eventful-only contract", batch.Height)
			}
			canonical, err := batch.CanonicalBytes()
			if err != nil {
				return nil, fmt.Errorf("canonicalize height %d: %w", batch.Height, err)
			}
			totalBytes += len(canonical)
			if len(result) == maxExportBatches || totalBytes > maxExportBytes {
				return nil, errors.New("batch export exceeds bounded history limits")
			}
			result = append(result, canonicalBatch{batch: batch, raw: canonical})
			after = batch.Height
		}
	}
	if len(result) == 0 {
		return nil, errors.New("batch endpoint returned no eventful batches")
	}
	return result, nil
}

func validateOneBatch(batch app.CommittedAuctionBatchV2, configuration options) error {
	if err := batch.Validate(); err != nil {
		return fmt.Errorf("invalid committed batch at height %d: %w", batch.Height, err)
	}
	if batch.AuthNetworkID != configuration.authNetworkID || batch.ChainID != configuration.chainID {
		return fmt.Errorf("batch identity mismatch at height %d", batch.Height)
	}
	return nil
}

func validateBatches(command string, configuration options, batches []canonicalBatch) (batchSummary, []canonicalBatch, error) {
	if len(batches) == 0 {
		return batchSummary{}, nil, errors.New("no committed batches supplied")
	}
	closureCount := 0
	closureHeight := int64(0)
	closureHash := ""
	previousHeight := int64(0)

	for _, item := range batches {
		batch := item.batch
		if err := validateOneBatch(batch, configuration); err != nil {
			return batchSummary{}, nil, err
		}
		if batch.Height <= previousHeight {
			return batchSummary{}, nil, errors.New("committed batch heights are not strictly increasing")
		}
		previousHeight = batch.Height
		canonical, err := batch.CanonicalBytes()
		if err != nil {
			return batchSummary{}, nil, fmt.Errorf("canonicalize height %d: %w", batch.Height, err)
		}
		if !bytes.Equal(canonical, item.raw) {
			return batchSummary{}, nil, fmt.Errorf("height %d is not exact CommittedAuctionBatchV2 canonical bytes", batch.Height)
		}
		for _, closure := range batch.Closures {
			if closure.AuctionID != configuration.auctionID {
				continue
			}
			closureCount++
			closureHeight = batch.Height
			closureHash = batch.AppHash
		}
	}
	if closureCount != 1 {
		return batchSummary{}, nil, fmt.Errorf("target auction has %d closures; exactly one is required", closureCount)
	}
	if configuration.expectedClosure != 0 && closureHeight != configuration.expectedClosure {
		return batchSummary{}, nil, fmt.Errorf("closure height %d does not match expected height %d", closureHeight, configuration.expectedClosure)
	}
	selected := make([]canonicalBatch, 0, len(batches))
	for _, item := range batches {
		if item.batch.Height <= closureHeight {
			selected = append(selected, item)
		}
	}
	if len(selected) == 0 || selected[len(selected)-1].batch.Height != closureHeight {
		return batchSummary{}, nil, errors.New("closure batch is not the last selected eventful batch")
	}
	if command == "validate" && len(selected) != len(batches) {
		return batchSummary{}, nil, errors.New("canonical batch directory contains batches after the target closure")
	}
	eventIDs := make([]string, 0)
	eventSet := make(map[string]struct{})
	for _, item := range selected {
		for _, bid := range item.batch.Bids {
			if bid.AuctionID != configuration.auctionID {
				continue
			}
			if _, exists := eventSet[bid.EventID]; exists {
				return batchSummary{}, nil, fmt.Errorf("duplicate target-auction event ID %s", bid.EventID)
			}
			eventSet[bid.EventID] = struct{}{}
			eventIDs = append(eventIDs, bid.EventID)
		}
	}
	summary := batchSummary{
		Schema:                    summarySchema,
		Command:                   command,
		CoverageContract:          coverageContract,
		EmptyHeightsAvailable:     false,
		ContinuousHeightsVerified: false,
		AuthNetworkID:             configuration.authNetworkID,
		ChainID:                   configuration.chainID,
		AuctionID:                 configuration.auctionID,
		BatchCount:                len(selected),
		FirstEventfulHeight:       selected[0].batch.Height,
		LastEventfulHeight:        selected[len(selected)-1].batch.Height,
		ClosureHeight:             closureHeight,
		ClosureAppHash:            closureHash,
		EventIDs:                  eventIDs,
		CanonicalBytesVerified:    true,
		CommittedBatchV2Validated: true,
	}
	return summary, selected, nil
}

func writeBatchDirectory(path string, batches []canonicalBatch) error {
	if err := os.Mkdir(path, 0o700); err != nil {
		return fmt.Errorf("create fresh batch directory: %w", err)
	}
	directory, err := openVerifiedDirectory(path, true)
	if err != nil {
		return err
	}
	defer directory.Close()
	for _, item := range batches {
		name := fmt.Sprintf("batch-%020d.json", item.batch.Height)
		fd, err := unix.Openat(int(directory.Fd()), name, unix.O_WRONLY|unix.O_CREAT|unix.O_EXCL|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0o600)
		if err != nil {
			return fmt.Errorf("create canonical batch %s: %w", name, err)
		}
		file := os.NewFile(uintptr(fd), name)
		if err := writeAndSealFile(file, item.raw); err != nil {
			file.Close()
			return fmt.Errorf("write canonical batch %s: %w", name, err)
		}
		if err := file.Close(); err != nil {
			return fmt.Errorf("close canonical batch %s: %w", name, err)
		}
	}
	if err := directory.Sync(); err != nil {
		return fmt.Errorf("sync canonical batch directory: %w", err)
	}
	return nil
}

func writeAndSealFile(file *os.File, raw []byte) error {
	if len(raw) == 0 || len(raw) > maxBatchFileSize {
		return errors.New("canonical batch has invalid size")
	}
	written := 0
	for written < len(raw) {
		count, err := file.Write(raw[written:])
		if err != nil {
			return err
		}
		if count == 0 {
			return io.ErrShortWrite
		}
		written += count
	}
	if err := file.Sync(); err != nil {
		return err
	}
	information, err := file.Stat()
	if err != nil {
		return err
	}
	return verifyBatchFileMetadata(information)
}

func readBatchDirectory(path string) ([]canonicalBatch, error) {
	directory, err := openVerifiedDirectory(path, true)
	if err != nil {
		return nil, err
	}
	defer directory.Close()
	entries, err := directory.Readdir(-1)
	if err != nil {
		return nil, fmt.Errorf("read canonical batch directory: %w", err)
	}
	if len(entries) == 0 || len(entries) > maxExportBatches {
		return nil, errors.New("canonical batch directory is empty or exceeds file-count limit")
	}
	sort.Slice(entries, func(left, right int) bool { return entries[left].Name() < entries[right].Name() })
	result := make([]canonicalBatch, 0, len(entries))
	totalBytes := 0
	for _, entry := range entries {
		match := batchFilename.FindStringSubmatch(entry.Name())
		if match == nil {
			return nil, fmt.Errorf("unexpected canonical batch directory entry %q", entry.Name())
		}
		fd, err := unix.Openat(int(directory.Fd()), entry.Name(), unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
		if err != nil {
			return nil, fmt.Errorf("open canonical batch %s: %w", entry.Name(), err)
		}
		file := os.NewFile(uintptr(fd), entry.Name())
		information, statErr := file.Stat()
		if statErr != nil {
			file.Close()
			return nil, fmt.Errorf("stat canonical batch %s: %w", entry.Name(), statErr)
		}
		if err := verifyBatchFileMetadata(information); err != nil {
			file.Close()
			return nil, fmt.Errorf("canonical batch %s: %w", entry.Name(), err)
		}
		raw, readErr := io.ReadAll(io.LimitReader(file, maxBatchFileSize+1))
		closeErr := file.Close()
		if readErr != nil || closeErr != nil || len(raw) == 0 || len(raw) > maxBatchFileSize {
			return nil, fmt.Errorf("read canonical batch %s within bounds", entry.Name())
		}
		totalBytes += len(raw)
		if totalBytes > maxExportBytes {
			return nil, errors.New("canonical batch directory exceeds aggregate byte limit")
		}
		var batch app.CommittedAuctionBatchV2
		if err := decodeStrictJSON(raw, &batch); err != nil {
			return nil, fmt.Errorf("decode canonical batch %s: %w", entry.Name(), err)
		}
		height, _ := strconv.ParseInt(match[1], 10, 64)
		if height < 1 || batch.Height != height || entry.Name() != fmt.Sprintf("batch-%020d.json", batch.Height) {
			return nil, fmt.Errorf("canonical batch filename %s does not match height", entry.Name())
		}
		result = append(result, canonicalBatch{batch: batch, raw: raw})
	}
	return result, nil
}

func openVerifiedDirectory(path string, exactMode bool) (*os.File, error) {
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, fmt.Errorf("open batch directory without following links: %w", err)
	}
	directory := os.NewFile(uintptr(fd), path)
	information, err := directory.Stat()
	if err != nil {
		directory.Close()
		return nil, fmt.Errorf("stat batch directory: %w", err)
	}
	stat, ok := information.Sys().(*syscall.Stat_t)
	if !ok || !information.IsDir() || stat.Uid != uint32(os.Geteuid()) || (exactMode && information.Mode().Perm() != 0o700) {
		directory.Close()
		return nil, errors.New("batch directory must be an owner-owned mode-0700 non-symlink directory")
	}
	return directory, nil
}

func verifyBatchFileMetadata(information os.FileInfo) error {
	stat, ok := information.Sys().(*syscall.Stat_t)
	if !ok || !information.Mode().IsRegular() || information.Mode().Perm() != 0o600 || stat.Uid != uint32(os.Geteuid()) || stat.Nlink != 1 {
		return errors.New("file must be owner-owned, regular, mode 0600, and single-linked")
	}
	if information.Size() < 1 || information.Size() > maxBatchFileSize {
		return errors.New("file size is outside the canonical batch bound")
	}
	return nil
}

func decodeStrictJSON(raw []byte, destination any) error {
	if err := rejectDuplicateJSONKeys(raw); err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	decoder.UseNumber()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	if err := requireJSONEOF(decoder); err != nil {
		return err
	}
	return nil
}

func rejectDuplicateJSONKeys(raw []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := consumeJSONValue(decoder); err != nil {
		return err
	}
	return requireJSONEOF(decoder)
}

func consumeJSONValue(decoder *json.Decoder) error {
	token, err := decoder.Token()
	if err != nil {
		return err
	}
	delimiter, ok := token.(json.Delim)
	if !ok {
		return nil
	}
	switch delimiter {
	case '{':
		seen := make(map[string]struct{})
		for decoder.More() {
			keyToken, err := decoder.Token()
			if err != nil {
				return err
			}
			key, ok := keyToken.(string)
			if !ok {
				return errors.New("JSON object key is not a string")
			}
			if _, exists := seen[key]; exists {
				return fmt.Errorf("duplicate JSON key %q", key)
			}
			seen[key] = struct{}{}
			if err := consumeJSONValue(decoder); err != nil {
				return err
			}
		}
		closing, err := decoder.Token()
		if err != nil || closing != json.Delim('}') {
			return errors.New("invalid JSON object terminator")
		}
	case '[':
		for decoder.More() {
			if err := consumeJSONValue(decoder); err != nil {
				return err
			}
		}
		closing, err := decoder.Token()
		if err != nil || closing != json.Delim(']') {
			return errors.New("invalid JSON array terminator")
		}
	default:
		return errors.New("invalid JSON delimiter")
	}
	return nil
}

func requireJSONEOF(decoder *json.Decoder) error {
	if _, err := decoder.Token(); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("multiple JSON values are forbidden")
		}
		return err
	}
	return nil
}
