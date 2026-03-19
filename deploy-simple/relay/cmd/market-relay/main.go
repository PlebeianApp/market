package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"fiatjaf.com/nostr"
	"fiatjaf.com/nostr/eventstore"
	eventstorebleve "fiatjaf.com/nostr/eventstore/bleve"
	eventstoreboltdb "fiatjaf.com/nostr/eventstore/boltdb"
	"fiatjaf.com/nostr/khatru"
	"fiatjaf.com/nostr/khatru/policies"
	"fiatjaf.com/nostr/nip11"
)

var version = "dev"

type config struct {
	Name            string
	Description     string
	Contact         string
	Icon            string
	PubKey          string
	PublicURL       string
	ListenAddr      string
	DataDir         string
	SearchIndexDir  string
	RawEventStore   string
	MaxQueryLimit   int
	SupportedNIPs   []int
	ReadHeaderMs    time.Duration
	ShutdownTimeout time.Duration
}

func main() {
	cfg, err := loadConfig()
	if err != nil {
		log.Fatal(err)
	}

	store, cleanup, err := openStore(cfg)
	if err != nil {
		log.Fatal(err)
	}
	defer cleanup()

	relay := khatru.NewRelay()
	relay.ServiceURL = cfg.PublicURL
	relay.Info.Name = cfg.Name
	relay.Info.Description = cfg.Description
	relay.Info.Contact = cfg.Contact
	relay.Info.Icon = cfg.Icon
	relay.Info.Software = "https://github.com/PlebeianTech/market/tree/master/deploy-simple/relay"
	relay.Info.Version = version
	relay.Info.AddSupportedNIPs(cfg.SupportedNIPs)
	relay.Info.Limitation = &nip11.RelayLimitationDocument{
		MaxLimit: cfg.MaxQueryLimit,
	}

	if cfg.PubKey != "" {
		pubKey, err := nostr.PubKeyFromHex(cfg.PubKey)
		if err != nil {
			log.Fatalf("invalid RELAY_PUBKEY: %v", err)
		}
		relay.Info.PubKey = &pubKey
	}

	relay.OnEvent = policies.SeqEvent(
		policies.ValidateKind,
		policies.RejectEventsWithBase64Media,
		policies.RejectUnprefixedNostrReferences,
	)
	relay.OnRequest = policies.SeqRequest(policies.NoComplexFilters)
	relay.UseEventstore(store, cfg.MaxQueryLimit)

	router := relay.Router()
	router.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write([]byte("ok\n"))
	})

	server := &http.Server{
		Addr:              cfg.ListenAddr,
		Handler:           relay,
		ReadHeaderTimeout: cfg.ReadHeaderMs,
	}

	go func() {
		log.Printf("market-relay %s listening on %s (%s)", version, cfg.ListenAddr, cfg.PublicURL)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	}()

	sigCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	<-sigCtx.Done()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()

	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Printf("relay shutdown failed: %v", err)
	}
}

func loadConfig() (config, error) {
	cfg := config{
		Name:            envOr("RELAY_NAME", "Plebeian Market Relay"),
		Description:     envOr("RELAY_DESCRIPTION", "Plebeian Market application relay"),
		Contact:         os.Getenv("RELAY_CONTACT"),
		Icon:            os.Getenv("RELAY_ICON"),
		PubKey:          os.Getenv("RELAY_PUBKEY"),
		PublicURL:       envOr("RELAY_PUBLIC_URL", "ws://localhost:10547"),
		ListenAddr:      envOr("RELAY_LISTEN_ADDR", "127.0.0.1:10547"),
		DataDir:         envOr("RELAY_DATA_DIR", "/var/lib/market-relay"),
		SearchIndexDir:  envOr("RELAY_SEARCH_INDEX_DIR", "/var/lib/market-relay-search"),
		RawEventStore:   envOr("RELAY_RAW_DB_DIR", "/var/lib/market-relay-raw"),
		MaxQueryLimit:   envOrInt("RELAY_MAX_QUERY_LIMIT", 500),
		SupportedNIPs:   envOrInts("RELAY_SUPPORTED_NIPS", []int{1, 11, 50}),
		ReadHeaderMs:    time.Duration(envOrInt("RELAY_READ_HEADER_TIMEOUT_MS", 10000)) * time.Millisecond,
		ShutdownTimeout: time.Duration(envOrInt("RELAY_SHUTDOWN_TIMEOUT_MS", 10000)) * time.Millisecond,
	}

	for _, dir := range []string{cfg.DataDir, cfg.SearchIndexDir, cfg.RawEventStore} {
		if err := os.MkdirAll(filepath.Clean(dir), 0o755); err != nil {
			return config{}, fmt.Errorf("create relay dir %s: %w", dir, err)
		}
	}

	return cfg, nil
}

func openStore(cfg config) (eventstore.Store, func(), error) {
	rawStore := &eventstoreboltdb.BoltBackend{
		Path: filepath.Join(cfg.RawEventStore, "events.db"),
	}
	if err := rawStore.Init(); err != nil {
		return nil, nil, fmt.Errorf("init BoltDB raw store: %w", err)
	}

	searchStore := &eventstorebleve.BleveBackend{
		Path:          cfg.SearchIndexDir,
		RawEventStore: rawStore,
	}
	if err := searchStore.Init(); err != nil {
		return nil, nil, fmt.Errorf("init Bleve search store: %w", err)
	}

	cleanup := func() {
		closeMaybe(searchStore)
		closeMaybe(rawStore)
	}

	return searchStore, cleanup, nil
}

func closeMaybe(v any) {
	if closer, ok := v.(interface{ Close() error }); ok {
		if err := closer.Close(); err != nil {
			log.Printf("close failed: %v", err)
		}
	}
}

func envOr(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func envOrInt(key string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}

	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func envOrInts(key string, fallback []int) []int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}

	parts := strings.Split(value, ",")
	values := make([]int, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		parsed, err := strconv.Atoi(part)
		if err != nil {
			return fallback
		}
		values = append(values, parsed)
	}

	if len(values) == 0 {
		return fallback
	}
	return values
}
